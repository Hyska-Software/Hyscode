# Database Architecture

## Overview

HysCode uses **SQLite** as its local database, accessed from the Tauri Rust backend via **sqlx**. The database stores conversations, project metadata, settings, SDD sessions, and telemetry data.

---

## Database Location

```
~/.hyscode/data/hyscode.db          # Main database
~/.hyscode/data/hyscode.db-wal      # WAL file (auto-managed)
~/.hyscode/data/hyscode.db-shm      # Shared memory (auto-managed)
```

**WAL mode** is enabled for concurrent read access during writes, ensuring the UI stays responsive while the agent writes conversation data.

---

## Schema

### Projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,                    -- ULID
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,              -- absolute path to project root
  last_opened_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}'       -- JSON: project-level settings
);

CREATE INDEX idx_projects_last_opened ON projects(last_opened_at DESC);
```

### Conversations

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,                    -- ULID
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,                             -- auto-generated or user-set
  mode TEXT NOT NULL DEFAULT 'chat',      -- 'chat' | 'build' | 'review'
  model TEXT NOT NULL,                    -- model ID used
  provider TEXT NOT NULL,                 -- provider ID used
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_conversations_project ON conversations(project_id, updated_at DESC);
```

### Messages

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,                    -- ULID
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                     -- 'user' | 'assistant' | 'tool' | 'system'
  content TEXT NOT NULL,                  -- JSON: MessageContent[]
  tool_calls TEXT,                        -- JSON: ToolCall[] (for assistant messages)
  blocks TEXT,                            -- JSON: provider-native transcript blocks
  turn_summary TEXT,                      -- JSON: deterministic UI-only completion summary
  tool_call_id TEXT,                      -- for tool result messages
  token_count INTEGER,                    -- estimated token count
  created_at TEXT NOT NULL
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at ASC);
```

`turn_summary` is restored only into the desktop timeline and edit-session state. It is not
included when conversation history is reconstructed for an AI provider.

### Context Files

```sql
CREATE TABLE context_files (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,             -- SHA-256 of file content at attachment time
  line_start INTEGER,                     -- optional: specific line range
  line_end INTEGER,
  attached_at TEXT NOT NULL
);

CREATE INDEX idx_context_files_conversation ON context_files(conversation_id);
```

### Settings

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,                   -- dotted key: "editor.fontSize", "agent.autoApprove"
  value TEXT NOT NULL,                    -- JSON-encoded value
  updated_at TEXT NOT NULL
);
```

### Skills

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,                    -- 'builtin' | 'global' | 'workspace'
  file_path TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  trigger_condition TEXT,                 -- optional trigger expression
  loaded_at TEXT NOT NULL
);
```

### MCP Servers

```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,                -- 'stdio' | 'sse' | 'websocket'
  config TEXT NOT NULL,                   -- JSON: connection config
  capabilities TEXT NOT NULL DEFAULT '[]', -- JSON: granted capabilities
  is_enabled INTEGER NOT NULL DEFAULT 1,
  last_connected_at TEXT,
  created_at TEXT NOT NULL
);
```

### SDD Sessions & Tasks

```sql
CREATE TABLE sdd_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id),
  description TEXT NOT NULL,
  spec TEXT,
  spec_approved INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'describing',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sdd_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sdd_sessions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  agent_output TEXT,
  tool_calls TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sdd_tasks_session ON sdd_tasks(session_id, ordinal ASC);
```

### Telemetry (Local Only)

```sql
CREATE TABLE telemetry (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,               -- 'api_call' | 'tool_exec' | 'error'
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  cost_usd REAL,
  metadata TEXT,                          -- JSON: additional data
  created_at TEXT NOT NULL
);

CREATE INDEX idx_telemetry_type_date ON telemetry(event_type, created_at DESC);
CREATE INDEX idx_telemetry_provider ON telemetry(provider, created_at DESC);
```

---

## Migration Strategy

### Embedded Migrations

Migrations are SQL files embedded in the Rust binary at compile time:

```
src-tauri/src/db/migrations/
├── 001_initial.sql
├── 002_add_sdd_tables.sql
├── 003_add_telemetry.sql
└── ...
```

```rust
// Run migrations on app startup
async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    sqlx::migrate!("./src/db/migrations")
        .run(pool)
        .await?;
    Ok(())
}
```

### Migration Rules

1. Migrations are **append-only** — never modify existing migration files
2. Each migration is wrapped in a transaction
3. Destructive changes (DROP TABLE, DROP COLUMN) require a 2-step migration:
   - Step 1: create new table, copy data
   - Step 2: drop old table (in next release)
4. Version tracked in `_sqlx_migrations` table (auto-managed by sqlx)

---

## Access Patterns

### From Frontend (via Tauri IPC)

Frontend code **never** accesses SQLite directly. All database operations go through Tauri commands:

```typescript
// Frontend
const conversations = await invoke<Conversation[]>('db_query', {
  query: 'SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?',
  params: [projectId, 20],
});
```

### From Rust Backend

```rust
// Direct sqlx queries in command handlers
#[tauri::command]
async fn get_conversations(state: State<'_, AppState>, project_id: String) -> Result<Vec<Conversation>, Error> {
    let conversations = sqlx::query_as!(
        Conversation,
        "SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 20",
        project_id
    )
    .fetch_all(&state.db)
    .await?;
    Ok(conversations)
}
```

---

## Performance Considerations

1. **WAL mode**: `PRAGMA journal_mode = WAL` — enables concurrent reads during writes
2. **Synchronous mode**: `PRAGMA synchronous = NORMAL` — balanced durability/performance
3. **Cache size**: `PRAGMA cache_size = -64000` — 64MB page cache
4. **Foreign keys**: `PRAGMA foreign_keys = ON` — enforce referential integrity
5. **Indexes**: created for all common query patterns (see CREATE INDEX statements above)
6. **JSON columns**: used for flexible nested data (tool_calls, config), queried via `json_extract()` when needed
7. **Bulk inserts**: batch message inserts during conversation replay

---

## Backup & Recovery

- **Automatic backups**: daily snapshot of `hyscode.db` to `~/.hyscode/backups/`
- **Retention**: keep last 7 daily backups
- **Export**: user can export conversations as JSON from settings
- **Recovery**: on corruption, fall back to latest backup + WAL replay

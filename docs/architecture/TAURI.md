# Tauri v2 Shell Architecture

## Overview

The Tauri Rust backend is the secure bridge between the frontend WebView and the operating system. All privileged operations (filesystem, process execution, git, database) are exposed as **typed IPC commands** that the frontend calls via `invoke()`.

---

## IPC Command Registry

### File System Commands

```rust
#[tauri::command]
async fn fs_read_file(path: String, start_line: Option<u32>, end_line: Option<u32>) -> Result<FileContent, Error>;

#[tauri::command]
async fn fs_write_file(path: String, content: String) -> Result<(), Error>;

#[tauri::command]
async fn fs_create_file(path: String, content: String) -> Result<(), Error>;

#[tauri::command]
async fn fs_delete_file(path: String) -> Result<(), Error>;

#[tauri::command]
async fn fs_rename(old_path: String, new_path: String) -> Result<(), Error>;

#[tauri::command]
async fn fs_list_dir(path: String) -> Result<Vec<DirEntry>, Error>;

#[tauri::command]
async fn fs_search(root: String, pattern: String, include: Option<String>) -> Result<Vec<SearchMatch>, Error>;

#[tauri::command]
async fn fs_watch(path: String) -> Result<WatchId, Error>;  // emits "fs:changed" events

#[tauri::command]
async fn fs_unwatch(watch_id: WatchId) -> Result<(), Error>;

#[tauri::command]
async fn fs_stat(path: String) -> Result<FileStat, Error>;

#[tauri::command]
async fn fs_patch_file(path: String, old_text: String, new_text: String) -> Result<PatchResult, Error>;
```

### Terminal / PTY Commands

```rust
#[tauri::command]
async fn pty_spawn(shell: Option<String>, cwd: Option<String>, env: Option<HashMap<String, String>>) -> Result<PtyId, Error>;

#[tauri::command]
async fn pty_write(pty_id: PtyId, data: String) -> Result<(), Error>;

#[tauri::command]
async fn pty_resize(pty_id: PtyId, cols: u16, rows: u16) -> Result<(), Error>;

#[tauri::command]
async fn pty_kill(pty_id: PtyId) -> Result<(), Error>;
async fn pty_interrupt(pty_id: PtyId) -> Result<(), Error>;
async fn pty_snapshot(pty_id: PtyId, after_sequence: Option<u64>) -> Result<PtySnapshot, Error>;

// PTY output is ordered and replayable: emit("pty:data", { pty_id, sequence, data })
```

### Git Commands

```rust
#[tauri::command]
async fn git_status(repo_path: String) -> Result<GitStatus, Error>;

#[tauri::command]
async fn git_diff(repo_path: String, staged: bool) -> Result<String, Error>;

#[tauri::command]
async fn git_log(repo_path: String, limit: u32) -> Result<Vec<GitCommit>, Error>;

#[tauri::command]
async fn git_commit(repo_path: String, message: String, paths: Vec<String>) -> Result<String, Error>;

#[tauri::command]
async fn git_add(repo_path: String, paths: Vec<String>) -> Result<(), Error>;

#[tauri::command]
async fn git_checkout(repo_path: String, branch: String) -> Result<(), Error>;

#[tauri::command]
async fn git_branch_list(repo_path: String) -> Result<Vec<GitBranch>, Error>;
```

### Database Commands

```rust
#[tauri::command]
async fn db_execute(query: String, params: Vec<SqlValue>) -> Result<u64, Error>;  // returns affected rows

#[tauri::command]
async fn db_query(query: String, params: Vec<SqlValue>) -> Result<Vec<SqlRow>, Error>;

#[tauri::command]
async fn db_migrate() -> Result<MigrationReport, Error>;
```

### Process Sandbox Commands

```rust
#[tauri::command]
async fn sandbox_run(code: String, language: String, timeout_ms: u64) -> Result<SandboxResult, Error>;

#[tauri::command]
async fn sandbox_kill(sandbox_id: SandboxId) -> Result<(), Error>;
```

### Secure Storage Commands

```rust
#[tauri::command]
async fn keychain_set(key: String, value: String) -> Result<(), Error>;

#[tauri::command]
async fn keychain_get(key: String) -> Result<Option<String>, Error>;

#[tauri::command]
async fn keychain_delete(key: String) -> Result<(), Error>;
```

---

## Tauri Plugins

| Plugin                      | Purpose                    | Version |
| --------------------------- | -------------------------- | ------- |
| `tauri-plugin-fs`           | Extended FS operations     | v2      |
| `tauri-plugin-shell`        | PTY spawn, process exec    | v2      |
| `tauri-plugin-sql`          | SQLite driver (sqlx)       | v2      |
| `tauri-plugin-http`         | HTTP client (AI API calls) | v2      |
| `tauri-plugin-os`           | OS info, paths             | v2      |
| `tauri-plugin-dialog`       | Native file/folder dialogs | v2      |
| `tauri-plugin-clipboard`    | Clipboard R/W              | v2      |
| `tauri-plugin-notification` | Native notifications       | v2      |
| `tauri-plugin-store`        | JSON key-value store       | v2      |

---

## Capability Configuration

Tauri v2 uses **capabilities** to restrict what IPC commands each window/webview can access.

```json
// src-tauri/capabilities/main.json
{
  "identifier": "main-window",
  "description": "Capabilities for the main IDE window",
  "windows": ["main"],
  "permissions": [
    "fs:default",
    "fs:allow-read",
    "fs:allow-write",
    "shell:default",
    "shell:allow-spawn",
    "sql:default",
    "http:default",
    "dialog:default",
    "clipboard-manager:default",
    "notification:default",
    "store:default"
  ]
}
```

### Scope Restrictions

```json
// Restrict FS access to workspace directory only
{
  "identifier": "fs-workspace-scope",
  "permissions": [
    {
      "identifier": "fs:allow-read",
      "allow": [{ "path": "$APPDATA/hyscode/**" }, { "path": "$DOCUMENT/**" }]
    },
    {
      "identifier": "fs:allow-write",
      "allow": [{ "path": "$APPDATA/hyscode/**" }, { "path": "$DOCUMENT/**" }]
    }
  ]
}
```

---

## Event System

Tauri events for real-time communication between Rust and frontend:

| Event            | Direction | Payload                                            |
| ---------------- | --------- | -------------------------------------------------- |
| `fs:changed`     | Rust → TS | `{ path, kind: "create" \| "modify" \| "delete" }` |
| `pty:data`       | Rust → TS | `{ pty_id, sequence, data: string }`               |
| `pty:exit`       | Rust → TS | `{ pty_id, sequence, code: number }`               |
| `sandbox:output` | Rust → TS | `{ sandbox_id, stdout, stderr }`                   |
| `sandbox:exit`   | Rust → TS | `{ sandbox_id, code, duration_ms }`                |
| `db:migrated`    | Rust → TS | `{ version, applied: string[] }`                   |

---

## Rust Project Structure

```
src-tauri/
├── src/
│   ├── main.rs              # Tauri app builder, plugin registration
│   ├── commands/
│   │   ├── mod.rs
│   │   ├── fs.rs             # File system commands
│   │   ├── pty.rs            # Terminal/PTY commands
│   │   ├── git.rs            # Git operations (via git2 crate)
│   │   ├── db.rs             # SQLite commands
│   │   ├── sandbox.rs        # Process sandbox
│   │   └── keychain.rs       # Secure storage
│   ├── state/
│   │   ├── mod.rs
│   │   ├── app_state.rs      # Shared application state
│   │   ├── pty_manager.rs    # PTY instance registry
│   │   └── watcher.rs        # FS watcher registry
│   ├── db/
│   │   ├── mod.rs
│   │   ├── migrations/       # SQL migration files
│   │   └── models.rs         # SQLite row types
│   └── error.rs              # Unified error types
├── Cargo.toml
├── tauri.conf.json
├── capabilities/
│   └── main.json
└── icons/
```

---

## Security Model

1. **No `unsafe-eval`**: CSP blocks dynamic code execution in WebView
2. **No remote scripts**: all JavaScript is bundled locally
3. **Capability-gated IPC**: each command requires explicit permission grant
4. **Scoped FS access**: Rust validates paths are within allowed workspace directories
5. **PTY isolation**: each terminal session runs in its own process with user's shell
6. **Sandbox limits**: `sandbox_run` enforces CPU timeout, memory limit, no network access
7. **API keys in keychain**: OS-level secure storage, never persisted in app data files

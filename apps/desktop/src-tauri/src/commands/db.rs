use git2;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

// ─── Managed state ──────────────────────────────────────────────────────────

pub struct DbState(pub Mutex<Connection>);

pub fn open_database(app_dir: &std::path::Path) -> Connection {
    std::fs::create_dir_all(app_dir).ok();
    let db_path = app_dir.join("hyscode.db");
    let conn = Connection::open(&db_path).expect("failed to open database");
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
        .expect("failed to set pragmas");
    conn.execute_batch(include_str!("../../migrations/001_initial.sql"))
        .expect("failed to run migration 001");
    conn.execute_batch(include_str!("../../migrations/002_extensions.sql"))
        .expect("failed to run migration 002");
    conn.execute_batch(include_str!("../../migrations/003_fix_mode_constraint.sql"))
        .expect("failed to run migration 003");
    conn.execute_batch(include_str!("../../migrations/004_traces_and_policies.sql"))
        .expect("failed to run migration 004");
    conn.execute_batch(include_str!("../../migrations/005_open_tabs.sql"))
        .expect("failed to run migration 005");
    conn.execute_batch(include_str!("../../migrations/006_file_history.sql"))
        .expect("failed to run migration 006");
    conn.execute_batch(include_str!("../../migrations/007_diagrams.sql"))
        .expect("failed to run migration 007");
    conn.execute_batch(include_str!("../../migrations/008_memories.sql"))
        .expect("failed to run migration 008");
    conn.execute_batch(include_str!("../../migrations/009_agent_sdd.sql"))
        .expect("failed to run migration 009");
    apply_migration_010(&conn);
    conn
}

/// Migration 010: token usage + cache columns. Idempotent — checks
/// `pragma_table_info` for each column before adding it. Safe to run on
/// fresh DBs, on DBs already partially migrated, and on DBs that have the
/// full schema.
fn apply_migration_010(conn: &Connection) {
    let additions: &[(&str, &str, &str)] = &[
        ("turn_records", "token_total", "ALTER TABLE turn_records ADD COLUMN token_total INTEGER NOT NULL DEFAULT 0"),
        ("turn_records", "token_cache_read", "ALTER TABLE turn_records ADD COLUMN token_cache_read INTEGER NOT NULL DEFAULT 0"),
        ("turn_records", "token_cache_write", "ALTER TABLE turn_records ADD COLUMN token_cache_write INTEGER NOT NULL DEFAULT 0"),
        ("traces", "token_total", "ALTER TABLE traces ADD COLUMN token_total INTEGER NOT NULL DEFAULT 0"),
        ("traces", "token_cache_read", "ALTER TABLE traces ADD COLUMN token_cache_read INTEGER NOT NULL DEFAULT 0"),
        ("traces", "token_cache_write", "ALTER TABLE traces ADD COLUMN token_cache_write INTEGER NOT NULL DEFAULT 0"),
    ];
    for (table, column, ddl) in additions {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info(?1) WHERE name = ?2",
                params![table, column],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !exists {
            conn.execute_batch(ddl)
                .unwrap_or_else(|e| panic!("failed to add column {table}.{column}: {e}"));
        }
    }
}

// ─── Row types ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ConversationRow {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub model_id: Option<String>,
    pub provider_id: Option<String>,
    pub message_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct ConversationDetail {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub model_id: Option<String>,
    pub provider_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct MessageRow {
    pub id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<String>,
    pub token_input: i64,
    pub token_output: i64,
    pub created_at: String,
}

// ─── Conversation commands ──────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_conversations(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<ConversationRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.title, c.mode, c.model_id, c.provider_id,
                    COALESCE((SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id), 0),
                    c.created_at, c.updated_at
             FROM conversations c
             WHERE c.project_id = ?1
             ORDER BY c.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(ConversationRow {
                id: row.get(0)?,
                title: row.get(1)?,
                mode: row.get(2)?,
                model_id: row.get(3)?,
                provider_id: row.get(4)?,
                message_count: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn db_get_conversation(
    state: State<'_, DbState>,
    conversation_id: String,
) -> Result<Option<ConversationDetail>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, mode, model_id, provider_id, created_at, updated_at
             FROM conversations WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let row = stmt
        .query_row(params![conversation_id], |row| {
            Ok(ConversationDetail {
                id: row.get(0)?,
                title: row.get(1)?,
                mode: row.get(2)?,
                model_id: row.get(3)?,
                provider_id: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .ok();
    Ok(row)
}

#[tauri::command]
pub fn db_ensure_project(
    state: State<'_, DbState>,
    id: String,
    path: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // Derive a display name from the last path segment
    let name = path
        .trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&path)
        .to_string();
    conn.execute(
        "INSERT OR IGNORE INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
        params![id, name, path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_create_conversation(
    state: State<'_, DbState>,
    id: String,
    project_id: String,
    title: String,
    mode: String,
    model_id: Option<String>,
    provider_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO conversations (id, project_id, title, mode, model_id, provider_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, project_id, title, mode, model_id, provider_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_update_conversation(
    state: State<'_, DbState>,
    conversation_id: String,
    title: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(t) = title {
        conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![t, conversation_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn db_delete_conversation(
    state: State<'_, DbState>,
    conversation_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM conversations WHERE id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Message commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_messages(
    state: State<'_, DbState>,
    conversation_id: String,
) -> Result<Vec<MessageRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, role, content, tool_calls, token_input, token_output, created_at
             FROM messages
             WHERE conversation_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(MessageRow {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                tool_calls: row.get(3)?,
                token_input: row.get(4)?,
                token_output: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn db_create_message(
    state: State<'_, DbState>,
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    tool_calls: Option<String>,
    token_input: Option<i64>,
    token_output: Option<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, tool_calls, token_input, token_output)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            conversation_id,
            role,
            content,
            tool_calls,
            token_input.unwrap_or(0),
            token_output.unwrap_or(0)
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Turn Record commands ────────────────────────────────────────────────────

#[tauri::command]
pub fn db_create_turn_record(
    state: State<'_, DbState>,
    id: String,
    conversation_id: String,
    mode: String,
    iterations: i64,
    tool_calls: Option<String>,
    token_input: i64,
    token_output: i64,
    token_total: i64,
    token_cache_read: i64,
    token_cache_write: i64,
    stop_reason: String,
    verification_performed: bool,
    verification_forced: bool,
    files_modified: Option<String>,
    duration_ms: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO turn_records (id, conversation_id, mode, iterations, tool_calls, token_input, token_output, token_total, token_cache_read, token_cache_write, stop_reason, verification_performed, verification_forced, files_modified, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            id,
            conversation_id,
            mode,
            iterations,
            tool_calls,
            token_input,
            token_output,
            token_total,
            token_cache_read,
            token_cache_write,
            stop_reason,
            verification_performed as i64,
            verification_forced as i64,
            files_modified,
            duration_ms,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct TokenUsageRow {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
}

/// Sum token usage across all turn records in a conversation.
/// Returns zeros when the conversation has no turn records yet.
#[tauri::command]
pub fn db_get_conversation_token_usage(
    state: State<'_, DbState>,
    conversation_id: String,
) -> Result<TokenUsageRow, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let row = conn
        .query_row(
            "SELECT
                COALESCE(SUM(token_input), 0),
                COALESCE(SUM(token_output), 0),
                COALESCE(SUM(token_total), 0),
                COALESCE(SUM(token_cache_read), 0),
                COALESCE(SUM(token_cache_write), 0)
             FROM turn_records
             WHERE conversation_id = ?1",
            params![conversation_id],
            |row| {
                Ok(TokenUsageRow {
                    input_tokens: row.get(0)?,
                    output_tokens: row.get(1)?,
                    total_tokens: row.get(2)?,
                    cache_read_tokens: row.get(3)?,
                    cache_write_tokens: row.get(4)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(row)
}

// ─── Trace commands ─────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct TraceRow {
    pub id: String,
    pub conversation_id: String,
    pub mode: String,
    pub provider: String,
    pub model: String,
    pub system_prompt_hash: Option<String>,
    pub iterations: String,
    pub token_input: i64,
    pub token_output: i64,
    pub stop_reason: String,
    pub verification_performed: bool,
    pub verification_forced: bool,
    pub files_modified: Option<String>,
    pub errors: Option<String>,
    pub loop_warnings: Option<String>,
    pub duration_ms: i64,
    pub created_at: String,
}

#[tauri::command]
pub fn db_create_trace(
    state: State<'_, DbState>,
    id: String,
    conversation_id: String,
    mode: String,
    provider: String,
    model: String,
    system_prompt_hash: Option<String>,
    system_prompt_preview: Option<String>,
    system_prompt_tokens: Option<i64>,
    tool_count: Option<i64>,
    iterations: String,
    token_input: i64,
    token_output: i64,
    token_total: i64,
    token_cache_read: i64,
    token_cache_write: i64,
    stop_reason: String,
    verification_performed: bool,
    verification_forced: bool,
    files_modified: Option<String>,
    errors: Option<String>,
    loop_warnings: Option<String>,
    duration_ms: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO traces (id, conversation_id, mode, provider, model, system_prompt_hash, system_prompt_preview, system_prompt_tokens, tool_count, iterations, token_input, token_output, token_total, token_cache_read, token_cache_write, stop_reason, verification_performed, verification_forced, files_modified, errors, loop_warnings, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
        params![
            id,
            conversation_id,
            mode,
            provider,
            model,
            system_prompt_hash,
            system_prompt_preview,
            system_prompt_tokens.unwrap_or(0),
            tool_count.unwrap_or(0),
            iterations,
            token_input,
            token_output,
            token_total,
            token_cache_read,
            token_cache_write,
            stop_reason,
            verification_performed,
            verification_forced,
            files_modified,
            errors,
            loop_warnings,
            duration_ms,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_list_traces(
    state: State<'_, DbState>,
    conversation_id: String,
) -> Result<Vec<TraceRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, mode, provider, model, system_prompt_hash, iterations,
                    token_input, token_output, stop_reason, verification_performed, verification_forced,
                    files_modified, errors, loop_warnings, duration_ms, created_at
             FROM traces
             WHERE conversation_id = ?1
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(TraceRow {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                mode: row.get(2)?,
                provider: row.get(3)?,
                model: row.get(4)?,
                system_prompt_hash: row.get(5)?,
                iterations: row.get(6)?,
                token_input: row.get(7)?,
                token_output: row.get(8)?,
                stop_reason: row.get(9)?,
                verification_performed: row.get(10)?,
                verification_forced: row.get(11)?,
                files_modified: row.get(12)?,
                errors: row.get(13)?,
                loop_warnings: row.get(14)?,
                duration_ms: row.get(15)?,
                created_at: row.get(16)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

// ─── Mode policy commands ───────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ModePolicyRow {
    pub mode: String,
    pub max_iterations: i64,
    pub max_input_tokens: i64,
    pub max_output_tokens: i64,
    pub turn_timeout_ms: i64,
    pub approval_mode: String,
    pub verification_required: bool,
    pub allowed_tool_categories: String,
    pub tool_overrides: Option<String>,
    pub skill_triggers: Option<String>,
}

#[tauri::command]
pub fn db_list_mode_policies(state: State<'_, DbState>) -> Result<Vec<ModePolicyRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT mode, max_iterations, max_input_tokens, max_output_tokens, turn_timeout_ms,
                    approval_mode, verification_required, allowed_tool_categories, tool_overrides, skill_triggers
             FROM mode_policies
             ORDER BY mode",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ModePolicyRow {
                mode: row.get(0)?,
                max_iterations: row.get(1)?,
                max_input_tokens: row.get(2)?,
                max_output_tokens: row.get(3)?,
                turn_timeout_ms: row.get(4)?,
                approval_mode: row.get(5)?,
                verification_required: row.get(6)?,
                allowed_tool_categories: row.get(7)?,
                tool_overrides: row.get(8)?,
                skill_triggers: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn db_update_mode_policy(
    state: State<'_, DbState>,
    mode: String,
    max_iterations: Option<i64>,
    max_input_tokens: Option<i64>,
    max_output_tokens: Option<i64>,
    turn_timeout_ms: Option<i64>,
    approval_mode: Option<String>,
    verification_required: Option<bool>,
    allowed_tool_categories: Option<String>,
    tool_overrides: Option<String>,
    skill_triggers: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // Build dynamic SET clause for non-null fields
    let mut sets = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(v) = max_iterations {
        sets.push("max_iterations = ?");
        values.push(Box::new(v));
    }
    if let Some(v) = max_input_tokens {
        sets.push("max_input_tokens = ?");
        values.push(Box::new(v));
    }
    if let Some(v) = max_output_tokens {
        sets.push("max_output_tokens = ?");
        values.push(Box::new(v));
    }
    if let Some(v) = turn_timeout_ms {
        sets.push("turn_timeout_ms = ?");
        values.push(Box::new(v));
    }
    if let Some(ref v) = approval_mode {
        sets.push("approval_mode = ?");
        values.push(Box::new(v.clone()));
    }
    if let Some(v) = verification_required {
        sets.push("verification_required = ?");
        values.push(Box::new(v));
    }
    if let Some(ref v) = allowed_tool_categories {
        sets.push("allowed_tool_categories = ?");
        values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = tool_overrides {
        sets.push("tool_overrides = ?");
        values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = skill_triggers {
        sets.push("skill_triggers = ?");
        values.push(Box::new(v.clone()));
    }
    if sets.is_empty() {
        return Ok(());
    }
    sets.push("updated_at = datetime('now')");
    values.push(Box::new(mode));
    let sql = format!(
        "UPDATE mode_policies SET {} WHERE mode = ?",
        sets.join(", ")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|b| b.as_ref()).collect();
    conn.execute(&sql, params.as_slice())
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Open Tabs commands ──────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct OpenTabRow {
    pub id: String,
    pub project_id: String,
    pub conversation_id: Option<String>,
    pub title: String,
    pub mode: String,
    pub tab_index: i64,
    pub last_focused_at: String,
}

#[tauri::command]
pub fn db_get_open_tabs(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<OpenTabRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, conversation_id, title, mode, tab_index, last_focused_at
             FROM open_tabs
             WHERE project_id = ?1
             ORDER BY tab_index ASC, last_focused_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(OpenTabRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                conversation_id: row.get(2)?,
                title: row.get(3)?,
                mode: row.get(4)?,
                tab_index: row.get(5)?,
                last_focused_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn db_upsert_open_tab(
    state: State<'_, DbState>,
    id: String,
    project_id: String,
    conversation_id: Option<String>,
    title: String,
    mode: String,
    tab_index: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO open_tabs (id, project_id, conversation_id, title, mode, tab_index, last_focused_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             title = excluded.title,
             mode = excluded.mode,
             tab_index = excluded.tab_index,
             last_focused_at = datetime('now')",
        params![id, project_id, conversation_id, title, mode, tab_index],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_remove_open_tab(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM open_tabs WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── File history commands ──────────────────────────────────────────────────

const FILE_HISTORY_MAX: i64 = 50;

#[derive(Serialize)]
pub struct FileHistoryEntry {
    pub id: String,
    pub file_path: String,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct FileHistorySnapshot {
    pub id: String,
    pub file_path: String,
    pub content: String,
    pub created_at: String,
}

#[tauri::command]
pub fn file_history_save(
    state: State<'_, DbState>,
    file_path: String,
    content: String,
) -> Result<String, String> {
    // Skip files ignored by git (respects .gitignore, global ignores, etc.)
    let path = std::path::Path::new(&file_path);
    if let Ok(repo) = git2::Repository::discover(path) {
        if repo.is_path_ignored(path).unwrap_or(false) {
            return Ok(String::new());
        }
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO file_history (id, file_path, content) VALUES (?1, ?2, ?3)",
        params![id, file_path, content],
    )
    .map_err(|e| e.to_string())?;

    // Prune oldest entries beyond the max limit
    conn.execute(
        "DELETE FROM file_history
         WHERE file_path = ?1
           AND id NOT IN (
               SELECT id FROM file_history
               WHERE file_path = ?1
               ORDER BY created_at DESC
               LIMIT ?2
           )",
        params![file_path, FILE_HISTORY_MAX],
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub fn file_history_list(
    state: State<'_, DbState>,
    file_path: String,
) -> Result<Vec<FileHistoryEntry>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, file_path, created_at
             FROM file_history
             WHERE file_path = ?1
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![file_path], |row| {
            Ok(FileHistoryEntry {
                id: row.get(0)?,
                file_path: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn file_history_get(
    state: State<'_, DbState>,
    id: String,
) -> Result<FileHistorySnapshot, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let row = conn
        .query_row(
            "SELECT id, file_path, content, created_at FROM file_history WHERE id = ?1",
            params![id],
            |row| {
                Ok(FileHistorySnapshot {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(row)
}

#[tauri::command]
pub fn file_history_clear(state: State<'_, DbState>, file_path: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM file_history WHERE file_path = ?1",
        params![file_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Diagram CRUD commands ──────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DiagramRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub content: String,
    pub source_file: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn db_list_diagrams(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<DiagramRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, name, content, source_file, created_at, updated_at
             FROM diagrams WHERE project_id = ?1 ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(DiagramRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                content: row.get(3)?,
                source_file: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn db_get_diagram(state: State<'_, DbState>, id: String) -> Result<DiagramRow, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, project_id, name, content, source_file, created_at, updated_at
         FROM diagrams WHERE id = ?1",
        params![id],
        |row| {
            Ok(DiagramRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                content: row.get(3)?,
                source_file: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_diagram(
    state: State<'_, DbState>,
    id: String,
    project_id: String,
    name: String,
    content: String,
    source_file: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO diagrams (id, project_id, name, content, source_file, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             content = excluded.content,
             source_file = excluded.source_file,
             updated_at = datetime('now')",
        params![id, project_id, name, content, source_file],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_diagram(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM diagrams WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Memory commands ────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct MemoryRow {
    pub id: String,
    pub project_id: Option<String>,
    pub memory_type: String,
    pub title: String,
    pub content: String,
    pub summary: String,
    pub tags: String,
    pub source_conversation_id: Option<String>,
    pub relevance_score: f64,
    pub access_count: i64,
    pub last_accessed_at: Option<String>,
    pub created_by: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn db_create_memory(
    state: State<'_, DbState>,
    id: String,
    project_id: Option<String>,
    memory_type: String,
    title: String,
    content: String,
    summary: String,
    tags: String,
    source_conversation_id: Option<String>,
    source_message_ids: Option<String>,
    relevance_score: Option<f64>,
    created_by: Option<String>,
) -> Result<MemoryRow, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let score = relevance_score.unwrap_or(0.7);
    let by = created_by.unwrap_or_else(|| "agent".to_string());

    // Ensure project row exists (FK requirement) — derive name from last path segment
    if let Some(ref pid) = project_id {
        let proj_name = pid
            .trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(pid.as_str())
            .to_string();
        conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
            params![pid, proj_name, pid],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "INSERT INTO memories (id, project_id, type, title, content, summary, tags,
                               source_conversation_id, source_message_ids, relevance_score, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id, project_id, memory_type, title, content, summary, tags,
            source_conversation_id, source_message_ids, score, by,
        ],
    ).map_err(|e| e.to_string())?;
    let row = conn
        .query_row(
            "SELECT id, project_id, type, title, content, summary, tags,
                source_conversation_id, relevance_score, access_count, last_accessed_at,
                created_by, status, created_at, updated_at
         FROM memories WHERE id = ?1",
            params![id],
            |row| {
                Ok(MemoryRow {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    memory_type: row.get(2)?,
                    title: row.get(3)?,
                    content: row.get(4)?,
                    summary: row.get(5)?,
                    tags: row.get(6)?,
                    source_conversation_id: row.get(7)?,
                    relevance_score: row.get(8)?,
                    access_count: row.get(9)?,
                    last_accessed_at: row.get(10)?,
                    created_by: row.get(11)?,
                    status: row.get(12)?,
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(row)
}

#[tauri::command]
pub fn db_list_memories(
    state: State<'_, DbState>,
    project_id: Option<String>,
    memory_type: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<MemoryRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(50);
    let off = offset.unwrap_or(0);
    let st = status.as_deref().unwrap_or("active");

    // Build dynamic WHERE conditions
    let mut conditions = vec!["m.status = ?1".to_string()];
    let mut param_idx = 2i32;

    if project_id.is_some() {
        conditions.push(format!("m.project_id = ?{}", param_idx));
        param_idx += 1;
    }
    if memory_type.is_some() {
        conditions.push(format!("m.type = ?{}", param_idx));
        param_idx += 1;
    }

    let where_clause = conditions.join(" AND ");
    let lim_idx = param_idx;
    let off_idx = param_idx + 1;
    let sql = format!(
        "SELECT m.id, m.project_id, m.type, m.title, m.content, m.summary, m.tags,
                m.source_conversation_id, m.relevance_score, m.access_count, m.last_accessed_at,
                m.created_by, m.status, m.created_at, m.updated_at
         FROM memories m
         WHERE {}
         ORDER BY m.relevance_score DESC, m.updated_at DESC
         LIMIT ?{} OFFSET ?{}",
        where_clause, lim_idx, off_idx
    );

    // Build params dynamically
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(st.to_string())];
    if let Some(ref p) = project_id {
        param_values.push(Box::new(p.clone()));
    }
    if let Some(ref t) = memory_type {
        param_values.push(Box::new(t.clone()));
    }
    param_values.push(Box::new(lim));
    param_values.push(Box::new(off));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();
    let rows = stmt
        .query_map(params_ref.as_slice(), |row| {
            Ok(MemoryRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                memory_type: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                summary: row.get(5)?,
                tags: row.get(6)?,
                source_conversation_id: row.get(7)?,
                relevance_score: row.get(8)?,
                access_count: row.get(9)?,
                last_accessed_at: row.get(10)?,
                created_by: row.get(11)?,
                status: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn db_search_memories(
    state: State<'_, DbState>,
    project_id: Option<String>,
    query: String,
    memory_types: Option<String>,
    min_relevance: Option<f64>,
    limit: Option<i64>,
) -> Result<Vec<MemoryRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(20);
    let min_rel = min_relevance.unwrap_or(0.0);

    // Use FTS5 for text search, join back to memories for full data + filters
    let mut conditions = vec!["m.status = 'active'".to_string()];
    if project_id.is_some() {
        conditions.push("m.project_id = ?3".to_string());
    }
    if min_rel > 0.0 {
        conditions.push(format!("m.relevance_score >= {}", min_rel));
    }
    // Filter by types if provided
    if let Some(ref types) = memory_types {
        let type_list: Vec<String> = serde_json::from_str(types).unwrap_or_default();
        if !type_list.is_empty() {
            let placeholders: Vec<String> = type_list
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 10)) // Use high-numbered params
                .collect();
            conditions.push(format!("m.type IN ({})", placeholders.join(",")));
        }
    }

    let where_clause = conditions.join(" AND ");
    let sql = format!(
        "SELECT m.id, m.project_id, m.type, m.title, m.content, m.summary, m.tags,
                m.source_conversation_id, m.relevance_score, m.access_count, m.last_accessed_at,
                m.created_by, m.status, m.created_at, m.updated_at,
                rank
         FROM memories_fts
         JOIN memories m ON memories_fts.id = m.id
         WHERE memories_fts MATCH ?1
           AND {}
         ORDER BY rank, m.relevance_score DESC
         LIMIT ?2",
        where_clause
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> =
        vec![Box::new(query.clone()), Box::new(lim)];
    if let Some(ref p) = project_id {
        param_values.push(Box::new(p.clone()));
    }

    // Add type params if needed
    if let Some(ref types) = memory_types {
        let type_list: Vec<String> = serde_json::from_str(types).unwrap_or_default();
        for t in type_list {
            param_values.push(Box::new(t));
        }
    }

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();
    let rows = stmt
        .query_map(params_ref.as_slice(), |row| {
            Ok(MemoryRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                memory_type: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                summary: row.get(5)?,
                tags: row.get(6)?,
                source_conversation_id: row.get(7)?,
                relevance_score: row.get(8)?,
                access_count: row.get(9)?,
                last_accessed_at: row.get(10)?,
                created_by: row.get(11)?,
                status: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn db_update_memory(
    state: State<'_, DbState>,
    id: String,
    title: Option<String>,
    content: Option<String>,
    summary: Option<String>,
    tags: Option<String>,
    relevance_score: Option<f64>,
    status: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(ref v) = title {
        sets.push("title = ?".to_string());
        values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = content {
        sets.push("content = ?".to_string());
        values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = summary {
        sets.push("summary = ?".to_string());
        values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = tags {
        sets.push("tags = ?".to_string());
        values.push(Box::new(v.clone()));
    }
    if let Some(v) = relevance_score {
        sets.push("relevance_score = ?".to_string());
        values.push(Box::new(v));
    }
    if let Some(ref v) = status {
        sets.push("status = ?".to_string());
        values.push(Box::new(v.clone()));
    }
    if sets.is_empty() {
        return Ok(());
    }
    sets.push("updated_at = datetime('now')".to_string());
    values.push(Box::new(id));
    let sql = format!("UPDATE memories SET {} WHERE id = ?", sets.join(", "));
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|b| b.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_memory(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_track_memory_access(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE memories SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_decay_memories(
    state: State<'_, DbState>,
    project_id: Option<String>,
    decay_factor: f64,
    inactive_days: i64,
    archive_threshold: f64,
) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let project_filter = if project_id.is_some() {
        "AND project_id = ?4"
    } else {
        ""
    };

    // Decay relevance_score for memories not accessed recently
    let decay_sql = format!(
        "UPDATE memories
         SET relevance_score = MAX(0.01, relevance_score * ?1),
             updated_at = datetime('now')
         WHERE status = 'active'
           AND created_by = 'agent'
           AND (last_accessed_at IS NULL OR last_accessed_at < datetime('now', '-' || ?2 || ' days'))
           {}",
        project_filter
    );

    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
        Box::new(decay_factor),
        Box::new(inactive_days),
        Box::new(""), // placeholder for sqlite days concat
    ];
    if let Some(ref p) = project_id {
        params_vec.push(Box::new(p.clone()));
    }
    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        params_vec.iter().map(|b| b.as_ref()).collect();
    conn.execute(&decay_sql, params_ref.as_slice())
        .map_err(|e| e.to_string())?;

    // Archive memories below threshold
    let archive_filter = if project_id.is_some() {
        "AND project_id = ?2"
    } else {
        ""
    };
    let archive_sql = format!(
        "UPDATE memories SET status = 'archived', updated_at = datetime('now')
         WHERE status = 'active' AND relevance_score < ?1 AND created_by = 'agent' {}",
        archive_filter
    );
    let mut arch_params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(archive_threshold)];
    if let Some(ref p) = project_id {
        arch_params.push(Box::new(p.clone()));
    }
    let arch_ref: Vec<&dyn rusqlite::types::ToSql> =
        arch_params.iter().map(|b| b.as_ref()).collect();
    let archived = conn
        .execute(&archive_sql, arch_ref.as_slice())
        .map_err(|e| e.to_string())? as i64;
    Ok(archived)
}

#[derive(Serialize)]
pub struct MemoryStats {
    pub total: i64,
    pub by_type: String, // JSON object {type: count}
    pub archived: i64,
}

#[tauri::command]
pub fn db_get_memory_stats(
    state: State<'_, DbState>,
    project_id: Option<String>,
) -> Result<MemoryStats, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let project_filter = if project_id.is_some() {
        "WHERE project_id = ?1 AND status = 'active'"
    } else {
        "WHERE status = 'active'"
    };
    let archive_filter = if project_id.is_some() {
        "WHERE project_id = ?1 AND status = 'archived'"
    } else {
        "WHERE status = 'archived'"
    };

    let mut p: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(ref pid) = project_id {
        p.push(Box::new(pid.clone()));
    }
    let p_ref: Vec<&dyn rusqlite::types::ToSql> = p.iter().map(|b| b.as_ref()).collect();

    let total: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM memories {}", project_filter),
            p_ref.as_slice(),
            |r| r.get(0),
        )
        .unwrap_or(0);

    let archived: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM memories {}", archive_filter),
            p_ref.as_slice(),
            |r| r.get(0),
        )
        .unwrap_or(0);

    // Group by type
    let type_sql = format!(
        "SELECT type, COUNT(*) FROM memories {} GROUP BY type",
        project_filter
    );
    let mut stmt = conn.prepare(&type_sql).map_err(|e| e.to_string())?;
    let type_rows: Vec<(String, i64)> = stmt
        .query_map(p_ref.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut map = serde_json::Map::new();
    for (t, c) in type_rows {
        map.insert(t, serde_json::Value::Number(serde_json::Number::from(c)));
    }
    let by_type = serde_json::to_string(&map).unwrap_or_else(|_| "{}".to_string());

    Ok(MemoryStats {
        total,
        by_type,
        archived,
    })
}

// ─── Schema extraction from SQLite ─────────────────────────────────────────

#[derive(Serialize)]
pub struct ExtractedColumn {
    pub cid: i64,
    pub name: String,
    pub col_type: String,
    pub not_null: bool,
    pub default_value: Option<String>,
    pub is_pk: bool,
}

#[derive(Serialize)]
pub struct ExtractedForeignKey {
    pub id: i64,
    pub seq: i64,
    pub to_table: String,
    pub from_col: String,
    pub to_col: String,
}

#[derive(Serialize)]
pub struct ExtractedTable {
    pub name: String,
    pub columns: Vec<ExtractedColumn>,
    pub foreign_keys: Vec<ExtractedForeignKey>,
}

#[tauri::command]
pub fn db_extract_schema(db_path: String) -> Result<Vec<ExtractedTable>, String> {
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // Get list of user tables (exclude sqlite_ internals)
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| e.to_string())?;
    let table_names: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut tables: Vec<ExtractedTable> = Vec::new();

    for tbl in &table_names {
        // PRAGMA table_info
        let mut ci_stmt = conn
            .prepare(&format!("PRAGMA table_info(\"{}\")", tbl))
            .map_err(|e| e.to_string())?;
        let columns: Vec<ExtractedColumn> = ci_stmt
            .query_map([], |row| {
                Ok(ExtractedColumn {
                    cid: row.get(0)?,
                    name: row.get(1)?,
                    col_type: row.get(2)?,
                    not_null: row.get::<_, i64>(3)? != 0,
                    default_value: row.get(4)?,
                    is_pk: row.get::<_, i64>(5)? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        // PRAGMA foreign_key_list
        let mut fk_stmt = conn
            .prepare(&format!("PRAGMA foreign_key_list(\"{}\")", tbl))
            .map_err(|e| e.to_string())?;
        let foreign_keys: Vec<ExtractedForeignKey> = fk_stmt
            .query_map([], |row| {
                Ok(ExtractedForeignKey {
                    id: row.get(0)?,
                    seq: row.get(1)?,
                    to_table: row.get(2)?,
                    from_col: row.get(3)?,
                    to_col: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        tables.push(ExtractedTable {
            name: tbl.clone(),
            columns,
            foreign_keys,
        });
    }

    Ok(tables)
}

// ─── Agent SDD persistence ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSddSessionRow {
    pub id: String,
    pub project_id: String,
    pub conversation_id: String,
    pub description: String,
    pub spec: Option<String>,
    pub spec_approved: bool,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSddTaskRow {
    pub id: String,
    pub session_id: String,
    pub ordinal: i64,
    pub title: String,
    pub description: String,
    pub files: Vec<String>,
    pub dependencies: Vec<String>,
    pub status: String,
    pub agent_output: Option<String>,
    pub tool_calls: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn db_sdd_upsert_session(
    state: State<'_, DbState>,
    session_json: String,
) -> Result<(), String> {
    let session: AgentSddSessionRow =
        serde_json::from_str(&session_json).map_err(|e| e.to_string())?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO agent_sdd_sessions
         (id, project_id, conversation_id, description, spec, spec_approved, status, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,
           conversation_id=excluded.conversation_id, description=excluded.description,
           spec=excluded.spec, spec_approved=excluded.spec_approved,
           status=excluded.status, updated_at=excluded.updated_at",
        params![session.id, session.project_id, session.conversation_id, session.description,
            session.spec, session.spec_approved, session.status, session.created_at, session.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_sdd_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSddSessionRow> {
    Ok(AgentSddSessionRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        conversation_id: row.get(2)?,
        description: row.get(3)?,
        spec: row.get(4)?,
        spec_approved: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[tauri::command]
pub fn db_sdd_get_session(state: State<'_, DbState>, id: String) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let row = conn.query_row(
        "SELECT id,project_id,conversation_id,description,spec,spec_approved,status,created_at,updated_at
         FROM agent_sdd_sessions WHERE id=?1",
        params![id], read_sdd_session,
    ).optional().map_err(|e| e.to_string())?;
    row.map(|value| serde_json::to_string(&value).map_err(|e| e.to_string()))
        .transpose()
}

#[tauri::command]
pub fn db_sdd_list_sessions(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id,project_id,conversation_id,description,spec,spec_approved,status,created_at,updated_at
         FROM agent_sdd_sessions WHERE project_id=?1 ORDER BY updated_at DESC",
    ).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(params![project_id], read_sdd_session)
        .map_err(|e| e.to_string())?;
    mapped
        .map(|row| {
            row.map_err(|e| e.to_string())
                .and_then(|value| serde_json::to_string(&value).map_err(|e| e.to_string()))
        })
        .collect()
}

#[tauri::command]
pub fn db_sdd_upsert_task(state: State<'_, DbState>, task_json: String) -> Result<(), String> {
    let task: AgentSddTaskRow = serde_json::from_str(&task_json).map_err(|e| e.to_string())?;
    let files = serde_json::to_string(&task.files).map_err(|e| e.to_string())?;
    let dependencies = serde_json::to_string(&task.dependencies).map_err(|e| e.to_string())?;
    let tool_calls = serde_json::to_string(&task.tool_calls).map_err(|e| e.to_string())?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO agent_sdd_tasks
         (id,session_id,ordinal,title,description,files,dependencies,status,agent_output,tool_calls,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(id) DO UPDATE SET ordinal=excluded.ordinal,title=excluded.title,
           description=excluded.description,files=excluded.files,dependencies=excluded.dependencies,
           status=excluded.status,agent_output=excluded.agent_output,tool_calls=excluded.tool_calls,
           updated_at=excluded.updated_at",
        params![task.id, task.session_id, task.ordinal, task.title, task.description, files,
            dependencies, task.status, task.agent_output, tool_calls, task.created_at, task.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_sdd_get_tasks(
    state: State<'_, DbState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id,session_id,ordinal,title,description,files,dependencies,status,agent_output,tool_calls,created_at,updated_at
         FROM agent_sdd_tasks WHERE session_id=?1 ORDER BY ordinal",
    ).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(params![session_id], |row| {
            let files: String = row.get(5)?;
            let dependencies: String = row.get(6)?;
            let tool_calls: String = row.get(9)?;
            Ok(AgentSddTaskRow {
                id: row.get(0)?,
                session_id: row.get(1)?,
                ordinal: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                files: serde_json::from_str(&files).unwrap_or_default(),
                dependencies: serde_json::from_str(&dependencies).unwrap_or_default(),
                status: row.get(7)?,
                agent_output: row.get(8)?,
                tool_calls: serde_json::from_str(&tool_calls)
                    .unwrap_or_else(|_| serde_json::json!([])),
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    mapped
        .map(|row| {
            row.map_err(|e| e.to_string())
                .and_then(|value| serde_json::to_string(&value).map_err(|e| e.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod sdd_migration_tests {
    use super::open_database;
    use std::error::Error;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn migrates_legacy_sdd_rows() -> Result<(), Box<dyn Error>> {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let directory = std::env::temp_dir().join(format!("hyscode-sdd-migration-{suffix}"));
        let connection = open_database(&directory);
        connection.execute_batch(
            "INSERT INTO projects (id,name,path) VALUES ('project','Project','/project');
             INSERT INTO conversations (id,project_id,title,mode) VALUES ('conversation','project','Test','chat');
             INSERT INTO sdd_sessions (id,conversation_id,description,spec,phase,status)
               VALUES ('session','conversation','Feature','# Spec','execute','active');
             INSERT INTO sdd_tasks (id,session_id,title,description,status,sort_order,files,output)
               VALUES ('task','session','Implement','Do it','running',1,'[\"a.ts\"]','working');",
        )?;
        connection.execute_batch(include_str!("../../migrations/009_agent_sdd.sql"))?;

        let session_status: String = connection.query_row(
            "SELECT status FROM agent_sdd_sessions WHERE id='session'",
            [],
            |row| row.get(0),
        )?;
        let task_status: String = connection.query_row(
            "SELECT status FROM agent_sdd_tasks WHERE id='task'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(session_status, "executing");
        assert_eq!(task_status, "in_progress");

        drop(connection);
        std::fs::remove_dir_all(directory)?;
        Ok(())
    }
}

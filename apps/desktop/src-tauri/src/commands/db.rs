use rusqlite::{params, Connection};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;
use git2;

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
    conn
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
    stop_reason: String,
    verification_performed: bool,
    verification_forced: bool,
    files_modified: Option<String>,
    duration_ms: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO turn_records (id, conversation_id, mode, iterations, tool_calls, token_input, token_output, stop_reason, verification_performed, verification_forced, files_modified, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            conversation_id,
            mode,
            iterations,
            tool_calls,
            token_input,
            token_output,
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
        "INSERT INTO traces (id, conversation_id, mode, provider, model, system_prompt_hash, system_prompt_preview, system_prompt_tokens, tool_count, iterations, token_input, token_output, stop_reason, verification_performed, verification_forced, files_modified, errors, loop_warnings, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
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
pub fn db_list_mode_policies(
    state: State<'_, DbState>,
) -> Result<Vec<ModePolicyRow>, String> {
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
    if let Some(v) = max_iterations { sets.push("max_iterations = ?"); values.push(Box::new(v)); }
    if let Some(v) = max_input_tokens { sets.push("max_input_tokens = ?"); values.push(Box::new(v)); }
    if let Some(v) = max_output_tokens { sets.push("max_output_tokens = ?"); values.push(Box::new(v)); }
    if let Some(v) = turn_timeout_ms { sets.push("turn_timeout_ms = ?"); values.push(Box::new(v)); }
    if let Some(ref v) = approval_mode { sets.push("approval_mode = ?"); values.push(Box::new(v.clone())); }
    if let Some(v) = verification_required { sets.push("verification_required = ?"); values.push(Box::new(v)); }
    if let Some(ref v) = allowed_tool_categories { sets.push("allowed_tool_categories = ?"); values.push(Box::new(v.clone())); }
    if let Some(ref v) = tool_overrides { sets.push("tool_overrides = ?"); values.push(Box::new(v.clone())); }
    if let Some(ref v) = skill_triggers { sets.push("skill_triggers = ?"); values.push(Box::new(v.clone())); }
    if sets.is_empty() {
        return Ok(());
    }
    sets.push("updated_at = datetime('now')");
    values.push(Box::new(mode));
    let sql = format!("UPDATE mode_policies SET {} WHERE mode = ?", sets.join(", "));
    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|b| b.as_ref()).collect();
    conn.execute(&sql, params.as_slice()).map_err(|e| e.to_string())?;
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
pub fn db_remove_open_tab(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
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
pub fn file_history_clear(
    state: State<'_, DbState>,
    file_path: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM file_history WHERE file_path = ?1", params![file_path])
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
pub fn db_get_diagram(
    state: State<'_, DbState>,
    id: String,
) -> Result<DiagramRow, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, project_id, name, content, source_file, created_at, updated_at
         FROM diagrams WHERE id = ?1",
        params![id],
        |row| Ok(DiagramRow {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
            content: row.get(3)?,
            source_file: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        }),
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
pub fn db_delete_diagram(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM diagrams WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
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


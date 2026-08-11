use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use super::db::DbState;

const DEFAULT_COLUMNS: [(&str, &str); 5] = [
    ("backlog", "Backlog"),
    ("todo", "To do"),
    ("in_progress", "In progress"),
    ("blocked", "Blocked"),
    ("done", "Done"),
];

const MAX_TITLE_CHARS: usize = 500;
const MAX_DESCRIPTION_CHARS: usize = 20_000;
const MAX_COMMENT_CHARS: usize = 10_000;
const MAX_INSTRUCTIONS_CHARS: usize = 50_000;
const MAX_SUMMARY_CHARS: usize = 10_000;
const MAX_LABELS: usize = 20;
const MAX_LABEL_CHARS: usize = 80;

#[derive(Clone, Serialize)]
pub struct KanbanTaskRunRow {
    pub id: String,
    pub state: String,
    pub mode: String,
    pub conversation_id: Option<String>,
    pub turn_id: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub instructions: String,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize)]
pub struct KanbanTaskRow {
    pub id: String,
    pub project_id: String,
    pub board_id: String,
    pub column_id: String,
    pub column_key: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    pub position: i64,
    pub due_date: Option<String>,
    pub auto_transition: bool,
    pub archived_at: Option<String>,
    pub labels: Vec<String>,
    pub version: i64,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
    pub active_run: Option<KanbanTaskRunRow>,
    pub latest_run: Option<KanbanTaskRunRow>,
}

#[derive(Serialize)]
pub struct KanbanBoardSnapshot {
    pub board_id: String,
    pub board_revision: i64,
    pub tasks: Vec<KanbanTaskRow>,
}

#[derive(Serialize)]
pub struct KanbanTaskLookup {
    pub board_id: String,
    pub board_revision: i64,
    pub task: Option<KanbanTaskRow>,
}

#[derive(Serialize)]
pub struct KanbanTaskMutation {
    pub board_id: String,
    pub board_revision: i64,
    pub task: KanbanTaskRow,
}

#[derive(Clone, Serialize)]
pub struct KanbanTaskActivityRow {
    pub id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub actor: String,
    pub event_kind: String,
    pub body: String,
    pub payload: String,
    pub mutation_id: String,
    pub created_at: String,
}

#[derive(Clone, Serialize)]
struct KanbanChangedEvent {
    project_id: String,
    board_id: String,
    board_revision: i64,
    mutation_id: String,
    entity_kind: String,
    entity_id: String,
    snapshot: Value,
    actor: String,
    created_at: String,
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4())
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn validate_project(conn: &Connection, project_id: &str) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if exists {
        Ok(())
    } else {
        Err(format!("Project '{project_id}' does not exist."))
    }
}

fn normalize_actor(actor: Option<String>) -> Result<String, String> {
    let value = actor.unwrap_or_else(|| "user".to_string());
    match value.as_str() {
        "user" | "agent" | "system" => Ok(value),
        _ => Err("actor must be user, agent, or system".to_string()),
    }
}

fn validate_priority(priority: &str) -> Result<(), String> {
    match priority {
        "none" | "low" | "medium" | "high" | "urgent" => Ok(()),
        _ => Err("priority must be none, low, medium, high, or urgent".to_string()),
    }
}

fn validate_text(value: &str, field: &str, max_chars: usize) -> Result<(), String> {
    if value.chars().count() > max_chars {
        return Err(format!("{field} must be at most {max_chars} characters."));
    }
    Ok(())
}

fn validate_labels(labels: &[String]) -> Result<(), String> {
    if labels.len() > MAX_LABELS {
        return Err(format!("labels must contain at most {MAX_LABELS} items."));
    }
    for label in labels {
        validate_text(label.trim(), "label", MAX_LABEL_CHARS)?;
    }
    Ok(())
}

fn validate_column_key(column_key: &str) -> Result<(), String> {
    if DEFAULT_COLUMNS.iter().any(|(key, _)| *key == column_key) {
        Ok(())
    } else {
        Err("column_key must be backlog, todo, in_progress, blocked, or done".to_string())
    }
}

fn validate_run_mode(mode: &str) -> Result<(), String> {
    match mode {
        "current_chat" | "dedicated_session" => Ok(()),
        _ => Err("mode must be current_chat or dedicated_session".to_string()),
    }
}

fn validate_run_state(state: &str) -> Result<(), String> {
    match state {
        "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" => Ok(()),
        _ => Err("state is not a valid Kanban task run state".to_string()),
    }
}

fn can_transition_run_state(from: &str, to: &str) -> bool {
    if from == to {
        return true;
    }
    match from {
        "queued" => matches!(to, "running" | "cancelled" | "failed"),
        "running" => matches!(to, "waiting" | "completed" | "failed" | "cancelled"),
        "waiting" => matches!(to, "running" | "cancelled" | "failed"),
        "completed" | "failed" | "cancelled" => false,
        _ => false,
    }
}

fn ensure_default_board(conn: &mut Connection, project_id: &str) -> Result<String, String> {
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    validate_project(&tx, project_id)?;
    let board_id = tx
        .query_row(
            "SELECT id FROM kanban_boards WHERE project_id = ?1 AND is_default = 1",
            params![project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_else(|| format!("{project_id}::kanban-default"));

    tx.execute(
        "INSERT OR IGNORE INTO kanban_boards (id, project_id, name, is_default)
         VALUES (?1, ?2, 'Tasks', 1)",
        params![board_id, project_id],
    )
    .map_err(|error| error.to_string())?;

    for (position, (system_key, name)) in DEFAULT_COLUMNS.iter().enumerate() {
        let column_id = format!("{board_id}::column::{system_key}");
        tx.execute(
            "INSERT OR IGNORE INTO kanban_columns
               (id, board_id, name, system_key, position)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![column_id, board_id, name, system_key, position as i64],
        )
        .map_err(|error| error.to_string())?;
    }

    tx.commit().map_err(|error| error.to_string())?;
    Ok(board_id)
}

fn resolve_board(
    conn: &mut Connection,
    project_id: &str,
    board_id: Option<&str>,
) -> Result<String, String> {
    validate_project(conn, project_id)?;
    if let Some(board_id) = board_id {
        let belongs: bool = conn
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM kanban_boards WHERE id = ?1 AND project_id = ?2
                 )",
                params![board_id, project_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !belongs {
            return Err("The Kanban board does not belong to the current project.".to_string());
        }
        Ok(board_id.to_string())
    } else {
        ensure_default_board(conn, project_id)
    }
}

fn board_revision(conn: &Connection, board_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT revision FROM kanban_boards WHERE id = ?1",
        params![board_id],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

fn column_id(conn: &Connection, board_id: &str, column_key: &str) -> Result<String, String> {
    validate_column_key(column_key)?;
    conn.query_row(
        "SELECT id FROM kanban_columns
         WHERE board_id = ?1 AND system_key = ?2 AND is_archived = 0",
        params![board_id, column_key],
        |row| row.get(0),
    )
    .map_err(|error| format!("Kanban column '{column_key}' is unavailable: {error}"))
}

fn resequence_column(tx: &Transaction<'_>, column_id: &str) -> Result<(), String> {
    let task_ids = {
        let mut statement = tx
            .prepare(
                "SELECT id FROM kanban_tasks
                 WHERE column_id = ?1
                   AND is_archived = 0
                 ORDER BY position, updated_at, id",
            )
            .map_err(|error| error.to_string())?;
        let task_ids = statement
            .query_map(params![column_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|error| error.to_string())?;
        task_ids
    };

    for (position, task_id) in task_ids.iter().enumerate() {
        tx.execute(
            "UPDATE kanban_tasks SET position = ?2 WHERE id = ?1",
            params![task_id, position as i64],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn load_labels(conn: &Connection, task_id: &str) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT l.name
             FROM kanban_labels l
             JOIN kanban_task_labels tl ON tl.label_id = l.id
             WHERE tl.task_id = ?1
             ORDER BY lower(l.name), l.id",
        )
        .map_err(|error| error.to_string())?;
    let labels = statement
        .query_map(params![task_id], |row| row.get(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|error| error.to_string());
    labels
}

fn map_task_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<KanbanTaskRunRow> {
    Ok(KanbanTaskRunRow {
        id: row.get(0)?,
        state: row.get(1)?,
        mode: row.get(2)?,
        conversation_id: row.get(3)?,
        turn_id: row.get(4)?,
        provider_id: row.get(5)?,
        model_id: row.get(6)?,
        error: row.get(7)?,
        started_at: row.get(8)?,
        completed_at: row.get(9)?,
        instructions: row.get(10)?,
        summary: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn load_active_run(conn: &Connection, task_id: &str) -> Result<Option<KanbanTaskRunRow>, String> {
    conn.query_row(
        "SELECT id, state, mode, conversation_id, turn_id, provider_id, model_id,
                error, started_at, completed_at, instructions, summary, created_at, updated_at
         FROM kanban_task_runs
         WHERE task_id = ?1 AND state IN ('queued', 'running', 'waiting')
         ORDER BY created_at DESC, id DESC LIMIT 1",
        params![task_id],
        map_task_run,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn load_latest_run(conn: &Connection, task_id: &str) -> Result<Option<KanbanTaskRunRow>, String> {
    conn.query_row(
        "SELECT id, state, mode, conversation_id, turn_id, provider_id, model_id,
                error, started_at, completed_at, instructions, summary, created_at, updated_at
         FROM kanban_task_runs
         WHERE task_id = ?1
         ORDER BY created_at DESC, id DESC LIMIT 1",
        params![task_id],
        map_task_run,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn load_task(
    conn: &Connection,
    project_id: &str,
    task_id: &str,
) -> Result<Option<KanbanTaskRow>, String> {
    let base = conn
        .query_row(
            "SELECT t.id, b.project_id, t.board_id, t.column_id,
                    COALESCE(c.system_key, 'backlog'), t.title, t.description, t.priority,
                    t.position, t.due_date, t.archived_at, t.auto_transition, t.version, t.created_by,
                    t.created_at, t.updated_at
             FROM kanban_tasks t
             JOIN kanban_boards b ON b.id = t.board_id
             JOIN kanban_columns c ON c.id = t.column_id
             WHERE t.id = ?1 AND b.project_id = ?2",
            params![task_id, project_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, bool>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, String>(14)?,
                    row.get::<_, String>(15)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let Some((
        id,
        project_id,
        board_id,
        column_id,
        column_key,
        title,
        description,
        priority,
        position,
        due_date,
        archived_at,
        auto_transition,
        version,
        created_by,
        created_at,
        updated_at,
    )) = base
    else {
        return Ok(None);
    };

    Ok(Some(KanbanTaskRow {
        labels: load_labels(conn, &id)?,
        active_run: load_active_run(conn, &id)?,
        latest_run: load_latest_run(conn, &id)?,
        id,
        project_id,
        board_id,
        column_id,
        column_key,
        title,
        description,
        priority,
        position,
        due_date,
        auto_transition,
        archived_at,
        version,
        created_by,
        created_at,
        updated_at,
    }))
}

fn require_task(
    conn: &Connection,
    project_id: &str,
    task_id: &str,
) -> Result<KanbanTaskRow, String> {
    load_task(conn, project_id, task_id)?.ok_or_else(|| "Kanban task was not found.".to_string())
}

fn require_active_task(
    conn: &Connection,
    project_id: &str,
    task_id: &str,
) -> Result<KanbanTaskRow, String> {
    let task = require_task(conn, project_id, task_id)?;
    if task.archived_at.is_some() {
        return Err("The Kanban task is archived and cannot be changed.".to_string());
    }
    Ok(task)
}

fn set_labels(
    tx: &Transaction<'_>,
    board_id: &str,
    task_id: &str,
    labels: Option<Vec<String>>,
) -> Result<(), String> {
    let Some(labels) = labels else { return Ok(()) };
    validate_labels(&labels)?;
    tx.execute(
        "DELETE FROM kanban_task_labels WHERE task_id = ?1",
        params![task_id],
    )
    .map_err(|error| error.to_string())?;

    let mut seen = std::collections::HashSet::new();
    for label in labels {
        let name = label.trim();
        if name.is_empty() || !seen.insert(name.to_lowercase()) {
            continue;
        }
        let label_id = new_id("label");
        tx.execute(
            "INSERT OR IGNORE INTO kanban_labels (id, board_id, name)
             VALUES (?1, ?2, ?3)",
            params![label_id, board_id, name],
        )
        .map_err(|error| error.to_string())?;
        let actual_label_id: String = tx
            .query_row(
                "SELECT id FROM kanban_labels WHERE board_id = ?1 AND name = ?2",
                params![board_id, name],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO kanban_task_labels (task_id, label_id)
             VALUES (?1, ?2)",
            params![task_id, actual_label_id],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn bump_revision(tx: &Transaction<'_>, board_id: &str) -> Result<i64, String> {
    tx.execute(
        "UPDATE kanban_boards SET revision = revision + 1, updated_at = datetime('now')
         WHERE id = ?1",
        params![board_id],
    )
    .map_err(|error| error.to_string())?;
    tx.query_row(
        "SELECT revision FROM kanban_boards WHERE id = ?1",
        params![board_id],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

fn add_activity(
    tx: &Transaction<'_>,
    task_id: &str,
    run_id: Option<&str>,
    actor: &str,
    event_kind: &str,
    body: &str,
    payload: &Value,
    mutation_id: &str,
) -> Result<(), String> {
    let payload = serde_json::to_string(payload).map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO kanban_task_activity
           (id, task_id, run_id, actor, event_kind, body, payload, mutation_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            new_id("activity"),
            task_id,
            run_id,
            actor,
            event_kind,
            body,
            payload,
            mutation_id
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn emit_change(
    app: &AppHandle,
    project_id: &str,
    board_id: &str,
    board_revision: i64,
    mutation_id: &str,
    entity_kind: &str,
    entity_id: &str,
    snapshot: &impl Serialize,
    actor: &str,
) {
    let snapshot = match serde_json::to_value(snapshot) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            eprintln!("[kanban] failed to serialize change event: {error}");
            return;
        }
    };
    if let Err(error) = app.emit(
        "kanban:changed",
        KanbanChangedEvent {
            project_id: project_id.to_string(),
            board_id: board_id.to_string(),
            board_revision,
            mutation_id: mutation_id.to_string(),
            entity_kind: entity_kind.to_string(),
            entity_id: entity_id.to_string(),
            snapshot,
            actor: actor.to_string(),
            created_at: now(),
        },
    ) {
        eprintln!("[kanban] failed to emit change event: {error}");
    }
}

#[tauri::command]
pub fn kanban_list_tasks(
    state: State<'_, DbState>,
    project_id: String,
    board_id: Option<String>,
    column_key: Option<String>,
    search: Option<String>,
    limit: Option<i64>,
) -> Result<KanbanBoardSnapshot, String> {
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let board_id = resolve_board(&mut conn, &project_id, board_id.as_deref())?;
    let limit = limit.unwrap_or(200).clamp(1, 200);
    if let Some(column_key) = column_key.as_deref() {
        validate_column_key(column_key)?;
    }
    let search = search.filter(|value| !value.trim().is_empty());

    let ids = {
        let mut statement = conn
            .prepare(
                "SELECT t.id
                 FROM kanban_tasks t
                 JOIN kanban_boards b ON b.id = t.board_id
                 JOIN kanban_columns c ON c.id = t.column_id
                 WHERE b.project_id = ?1
                   AND b.id = ?2
                   AND t.is_archived = 0
                   AND (?3 IS NULL OR c.system_key = ?3)
                   AND (?4 IS NULL OR lower(t.title || ' ' || t.description) LIKE '%' || lower(?4) || '%')
                 ORDER BY c.position, t.position, t.updated_at DESC, t.id
                 LIMIT ?5",
            )
            .map_err(|error| error.to_string())?;
        let ids = statement
            .query_map(
                params![project_id, board_id, column_key, search, limit],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|error| error.to_string())?;
        ids
    };
    let tasks = ids
        .iter()
        .map(|id| require_task(&conn, &project_id, id))
        .collect::<Result<Vec<_>, _>>()?;
    let revision = board_revision(&conn, &board_id)?;
    Ok(KanbanBoardSnapshot {
        board_id,
        board_revision: revision,
        tasks,
    })
}

#[tauri::command]
pub fn kanban_get_task(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
) -> Result<KanbanTaskLookup, String> {
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let task = load_task(&conn, &project_id, &task_id)?;
    let board_id = match task.as_ref() {
        Some(value) => value.board_id.clone(),
        None => ensure_default_board(&mut conn, &project_id)?,
    };
    let board_revision = board_revision(&conn, &board_id)?;
    Ok(KanbanTaskLookup {
        board_id,
        board_revision,
        task,
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn kanban_create_task(
    app: AppHandle,
    state: State<'_, DbState>,
    project_id: String,
    board_id: Option<String>,
    title: String,
    description: Option<String>,
    priority: Option<String>,
    column_key: Option<String>,
    due_date: Option<String>,
    labels: Option<Vec<String>>,
    auto_transition: Option<bool>,
    actor: Option<String>,
) -> Result<KanbanTaskMutation, String> {
    let actor = normalize_actor(actor)?;
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("title must be a non-empty string".to_string());
    }
    let description = description.unwrap_or_default();
    validate_text(&title, "title", MAX_TITLE_CHARS)?;
    validate_text(&description, "description", MAX_DESCRIPTION_CHARS)?;
    if let Some(due_date) = due_date.as_deref() {
        validate_text(due_date, "due_date", 64)?;
    }
    if let Some(labels) = labels.as_deref() {
        validate_labels(labels)?;
    }
    let priority = priority.unwrap_or_else(|| "none".to_string());
    validate_priority(&priority)?;
    let column_key = column_key.unwrap_or_else(|| "backlog".to_string());
    validate_column_key(&column_key)?;
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let board_id = resolve_board(&mut conn, &project_id, board_id.as_deref())?;
    let target_column_id = column_id(&conn, &board_id, &column_key)?;
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM kanban_tasks
             WHERE column_id = ?1 AND is_archived = 0",
            params![target_column_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let task_id = new_id("task");
    let mutation_id = new_id("mutation");
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO kanban_tasks
           (id, board_id, column_id, title, description, priority, position, due_date,
            auto_transition, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            task_id,
            board_id,
            target_column_id,
            title,
            description,
            priority,
            position,
            due_date,
            auto_transition.unwrap_or(true),
            actor
        ],
    )
    .map_err(|error| error.to_string())?;
    set_labels(&tx, &board_id, &task_id, labels)?;
    let revision = bump_revision(&tx, &board_id)?;
    add_activity(
        &tx,
        &task_id,
        None,
        &actor,
        "task_created",
        "",
        &json!({ "title": title }),
        &mutation_id,
    )?;
    tx.commit().map_err(|error| error.to_string())?;
    let task = require_task(&conn, &project_id, &task_id)?;
    emit_change(
        &app,
        &project_id,
        &board_id,
        revision,
        &mutation_id,
        "task",
        &task_id,
        &task,
        &actor,
    );
    Ok(KanbanTaskMutation {
        board_id,
        board_revision: revision,
        task,
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn kanban_update_task(
    app: AppHandle,
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    title: Option<String>,
    description: Option<String>,
    priority: Option<String>,
    due_date: Option<String>,
    clear_due_date: Option<bool>,
    labels: Option<Vec<String>>,
    auto_transition: Option<bool>,
    expected_version: Option<i64>,
    actor: Option<String>,
) -> Result<KanbanTaskMutation, String> {
    let actor = normalize_actor(actor)?;
    let title = title.map(|value| value.trim().to_string());
    if let Some(title) = title.as_deref() {
        if title.is_empty() {
            return Err("title must be a non-empty string".to_string());
        }
        validate_text(title, "title", MAX_TITLE_CHARS)?;
    }
    if let Some(description) = description.as_deref() {
        validate_text(description, "description", MAX_DESCRIPTION_CHARS)?;
    }
    if let Some(due_date) = due_date.as_deref() {
        validate_text(due_date, "due_date", 64)?;
    }
    if let Some(labels) = labels.as_deref() {
        validate_labels(labels)?;
    }
    let has_update = title.is_some()
        || description.is_some()
        || priority.is_some()
        || due_date.is_some()
        || clear_due_date.unwrap_or(false)
        || labels.is_some()
        || auto_transition.is_some();
    if !has_update {
        return Err("At least one task field must be provided.".to_string());
    }
    if let Some(priority) = priority.as_deref() {
        validate_priority(priority)?;
    }
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let current = require_active_task(&conn, &project_id, &task_id)?;
    let mutation_id = new_id("mutation");
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let changed = tx
        .execute(
            "UPDATE kanban_tasks
             SET title = CASE WHEN ?2 IS NULL THEN title ELSE ?2 END,
                 description = CASE WHEN ?3 IS NULL THEN description ELSE ?3 END,
                 priority = CASE WHEN ?4 IS NULL THEN priority ELSE ?4 END,
                 due_date = CASE
                   WHEN ?6 = 1 THEN NULL
                   WHEN ?5 IS NULL THEN due_date
                   ELSE ?5
                 END,
                 auto_transition = CASE WHEN ?7 IS NULL THEN auto_transition ELSE ?7 END,
                 version = version + 1,
                 updated_at = datetime('now')
             WHERE id = ?1 AND version = COALESCE(?8, version)",
            params![
                task_id,
                title,
                description,
                priority,
                due_date,
                clear_due_date.unwrap_or(false),
                auto_transition,
                expected_version
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err(if expected_version.is_some() {
            "Kanban task changed elsewhere; reload it before updating.".to_string()
        } else {
            "Kanban task was not found.".to_string()
        });
    }
    set_labels(&tx, &current.board_id, &task_id, labels)?;
    let revision = bump_revision(&tx, &current.board_id)?;
    add_activity(
        &tx,
        &task_id,
        None,
        &actor,
        "task_updated",
        "",
        &json!({ "title": title, "description": description, "priority": priority }),
        &mutation_id,
    )?;
    tx.commit().map_err(|error| error.to_string())?;
    let task = require_task(&conn, &project_id, &task_id)?;
    emit_change(
        &app,
        &project_id,
        &current.board_id,
        revision,
        &mutation_id,
        "task",
        &task_id,
        &task,
        &actor,
    );
    Ok(KanbanTaskMutation {
        board_id: current.board_id,
        board_revision: revision,
        task,
    })
}

#[tauri::command]
pub fn kanban_move_task(
    app: AppHandle,
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    column_key: String,
    position: Option<i64>,
    expected_version: Option<i64>,
    actor: Option<String>,
) -> Result<KanbanTaskMutation, String> {
    let actor = normalize_actor(actor)?;
    validate_column_key(&column_key)?;
    if position.is_some_and(|value| value < 0) {
        return Err("position must be greater than or equal to zero".to_string());
    }
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let current = require_active_task(&conn, &project_id, &task_id)?;
    let target_column_id = column_id(&conn, &current.board_id, &column_key)?;
    let target_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM kanban_tasks
             WHERE column_id = ?1 AND is_archived = 0",
            params![target_column_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let max_target_position = if current.column_id == target_column_id {
        target_count.saturating_sub(1)
    } else {
        target_count
    };
    let target_position = position
        .unwrap_or(max_target_position)
        .min(max_target_position);
    let mutation_id = new_id("mutation");
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let changed = tx
        .execute(
            "UPDATE kanban_tasks
             SET column_id = ?2, position = ?3, version = version + 1, updated_at = datetime('now')
             WHERE id = ?1 AND version = COALESCE(?4, version)",
            params![task_id, target_column_id, target_position, expected_version],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err(if expected_version.is_some() {
            "Kanban task changed elsewhere; reload it before moving.".to_string()
        } else {
            "Kanban task was not found.".to_string()
        });
    }
    if current.column_id == target_column_id {
        if target_position > current.position {
            tx.execute(
                "UPDATE kanban_tasks
                 SET position = position - 1
                 WHERE column_id = ?1 AND is_archived = 0 AND id <> ?2
                   AND position > ?3 AND position <= ?4",
                params![target_column_id, task_id, current.position, target_position],
            )
            .map_err(|error| error.to_string())?;
        } else if target_position < current.position {
            tx.execute(
                "UPDATE kanban_tasks
                 SET position = position + 1
                 WHERE column_id = ?1 AND is_archived = 0 AND id <> ?2
                   AND position >= ?3 AND position < ?4",
                params![target_column_id, task_id, target_position, current.position],
            )
            .map_err(|error| error.to_string())?;
        }
    } else {
        tx.execute(
            "UPDATE kanban_tasks
             SET position = position - 1
             WHERE column_id = ?1 AND is_archived = 0 AND position > ?2",
            params![current.column_id, current.position],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE kanban_tasks
             SET position = position + 1
             WHERE column_id = ?1 AND is_archived = 0 AND id <> ?2 AND position >= ?3",
            params![target_column_id, task_id, target_position],
        )
        .map_err(|error| error.to_string())?;
    }
    resequence_column(&tx, &current.column_id)?;
    if current.column_id != target_column_id {
        resequence_column(&tx, &target_column_id)?;
    }
    let revision = bump_revision(&tx, &current.board_id)?;
    add_activity(
        &tx,
        &task_id,
        None,
        &actor,
        "task_moved",
        "",
        &json!({ "column_key": column_key, "position": target_position }),
        &mutation_id,
    )?;
    tx.commit().map_err(|error| error.to_string())?;
    let task = require_task(&conn, &project_id, &task_id)?;
    emit_change(
        &app,
        &project_id,
        &current.board_id,
        revision,
        &mutation_id,
        "task",
        &task_id,
        &task,
        &actor,
    );
    Ok(KanbanTaskMutation {
        board_id: current.board_id,
        board_revision: revision,
        task,
    })
}

#[tauri::command]
pub fn kanban_archive_task(
    app: AppHandle,
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    expected_version: Option<i64>,
    actor: Option<String>,
) -> Result<KanbanTaskMutation, String> {
    let actor = normalize_actor(actor)?;
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let current = require_task(&conn, &project_id, &task_id)?;
    let board_id = current.board_id.clone();
    if current.archived_at.is_some() {
        return Err("The Kanban task is already archived.".to_string());
    }
    if current.active_run.is_some() {
        return Err("Stop the active task run before archiving the task.".to_string());
    }
    let mutation_id = new_id("mutation");
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let changed = tx
        .execute(
            "UPDATE kanban_tasks
             SET is_archived = 1,
                 archived_at = datetime('now'),
                 version = version + 1,
                 updated_at = datetime('now')
             WHERE id = ?1 AND version = COALESCE(?2, version)",
            params![task_id, expected_version],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err(if expected_version.is_some() {
            "Kanban task changed elsewhere; reload it before archiving.".to_string()
        } else {
            "Kanban task was not found.".to_string()
        });
    }
    resequence_column(&tx, &current.column_id)?;
    let revision = bump_revision(&tx, &board_id)?;
    add_activity(
        &tx,
        &task_id,
        None,
        &actor,
        "task_archived",
        "",
        &json!({ "task_id": task_id }),
        &mutation_id,
    )?;
    tx.commit().map_err(|error| error.to_string())?;
    let task = require_task(&conn, &project_id, &task_id)?;
    emit_change(
        &app,
        &project_id,
        &board_id,
        revision,
        &mutation_id,
        "task",
        &task_id,
        &task,
        &actor,
    );
    Ok(KanbanTaskMutation {
        board_id,
        board_revision: revision,
        task,
    })
}

#[tauri::command]
pub fn kanban_delete_task(
    app: AppHandle,
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    expected_version: Option<i64>,
    actor: Option<String>,
) -> Result<KanbanTaskMutation, String> {
    let actor = normalize_actor(actor)?;
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let current = require_task(&conn, &project_id, &task_id)?;
    let board_id = current.board_id.clone();
    if current.active_run.is_some() {
        return Err("Stop the active task run before deleting the task.".to_string());
    }
    let mutation_id = new_id("mutation");
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let changed = tx
        .execute(
            "DELETE FROM kanban_tasks
             WHERE id = ?1 AND version = COALESCE(?2, version)",
            params![task_id, expected_version],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err(if expected_version.is_some() {
            "Kanban task changed elsewhere; reload it before deleting.".to_string()
        } else {
            "Kanban task was not found.".to_string()
        });
    }
    resequence_column(&tx, &current.column_id)?;
    let revision = bump_revision(&tx, &board_id)?;
    tx.commit().map_err(|error| error.to_string())?;
    emit_change(
        &app,
        &project_id,
        &board_id,
        revision,
        &mutation_id,
        "task_deleted",
        &task_id,
        &current,
        &actor,
    );
    Ok(KanbanTaskMutation {
        board_id,
        board_revision: revision,
        task: current,
    })
}

#[tauri::command]
pub fn kanban_add_comment(
    app: AppHandle,
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    body: String,
    actor: Option<String>,
) -> Result<KanbanTaskActivityRow, String> {
    let actor = normalize_actor(actor)?;
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("body must be a non-empty string".to_string());
    }
    validate_text(&body, "body", MAX_COMMENT_CHARS)?;
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let task = require_active_task(&conn, &project_id, &task_id)?;
    let mutation_id = new_id("mutation");
    let activity_id = new_id("activity");
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let payload =
        serde_json::to_string(&json!({ "body": body })).map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO kanban_task_activity
           (id, task_id, actor, event_kind, body, payload, mutation_id)
         VALUES (?1, ?2, ?3, 'comment', ?4, ?5, ?6)",
        params![activity_id, task_id, actor, body, payload, mutation_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE kanban_tasks SET updated_at = datetime('now') WHERE id = ?1",
        params![task_id],
    )
    .map_err(|error| error.to_string())?;
    let revision = bump_revision(&tx, &task.board_id)?;
    tx.commit().map_err(|error| error.to_string())?;

    let activity = conn
        .query_row(
            "SELECT id, task_id, run_id, actor, event_kind, body, payload, mutation_id, created_at
             FROM kanban_task_activity WHERE id = ?1",
            params![activity_id],
            |row| {
                Ok(KanbanTaskActivityRow {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    run_id: row.get(2)?,
                    actor: row.get(3)?,
                    event_kind: row.get(4)?,
                    body: row.get(5)?,
                    payload: row.get(6)?,
                    mutation_id: row.get(7)?,
                    created_at: row.get(8)?,
                })
            },
        )
        .map_err(|error| error.to_string())?;
    emit_change(
        &app,
        &project_id,
        &task.board_id,
        revision,
        &mutation_id,
        "activity",
        &activity_id,
        &activity,
        &actor,
    );
    Ok(activity)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn kanban_create_task_run(
    app: AppHandle,
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    mode: Option<String>,
    instructions: Option<String>,
    provider_id: Option<String>,
    model_id: Option<String>,
    actor: Option<String>,
) -> Result<KanbanTaskRunRow, String> {
    let actor = normalize_actor(actor)?;
    let mode = mode.unwrap_or_else(|| "dedicated_session".to_string());
    validate_run_mode(&mode)?;
    let instructions = instructions.unwrap_or_default();
    validate_text(&instructions, "instructions", MAX_INSTRUCTIONS_CHARS)?;
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let task = require_active_task(&conn, &project_id, &task_id)?;
    let run_id = new_id("task-run");
    let mutation_id = new_id("mutation");
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO kanban_task_runs
           (id, task_id, mode, state, provider_id, model_id, instructions)
         VALUES (?1, ?2, ?3, 'queued', ?4, ?5, ?6)",
        params![run_id, task_id, mode, provider_id, model_id, instructions],
    )
    .map_err(|error| error.to_string())?;
    let revision = bump_revision(&tx, &task.board_id)?;
    add_activity(
        &tx,
        &task_id,
        Some(&run_id),
        &actor,
        "run_queued",
        "",
        &json!({ "run_id": run_id }),
        &mutation_id,
    )?;
    tx.commit().map_err(|error| error.to_string())?;
    let run = load_run(&conn, &run_id)?.ok_or_else(|| "Task run was not created.".to_string())?;
    emit_change(
        &app,
        &project_id,
        &task.board_id,
        revision,
        &mutation_id,
        "task_run",
        &run_id,
        &run,
        &actor,
    );
    Ok(run)
}

fn load_run(conn: &Connection, run_id: &str) -> Result<Option<KanbanTaskRunRow>, String> {
    conn.query_row(
        "SELECT id, state, mode, conversation_id, turn_id, provider_id, model_id,
                error, started_at, completed_at, instructions, summary, created_at, updated_at
         FROM kanban_task_runs WHERE id = ?1",
        params![run_id],
        |row| {
            Ok(KanbanTaskRunRow {
                id: row.get(0)?,
                state: row.get(1)?,
                mode: row.get(2)?,
                conversation_id: row.get(3)?,
                turn_id: row.get(4)?,
                provider_id: row.get(5)?,
                model_id: row.get(6)?,
                error: row.get(7)?,
                started_at: row.get(8)?,
                completed_at: row.get(9)?,
                instructions: row.get(10)?,
                summary: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn kanban_update_task_run(
    app: AppHandle,
    state: State<'_, DbState>,
    project_id: String,
    run_id: String,
    state_name: String,
    conversation_id: Option<String>,
    turn_id: Option<String>,
    summary: Option<String>,
    error: Option<String>,
    actor: Option<String>,
) -> Result<KanbanTaskRunRow, String> {
    let actor = normalize_actor(actor)?;
    validate_run_state(&state_name)?;
    if let Some(summary) = summary.as_deref() {
        validate_text(summary, "summary", MAX_SUMMARY_CHARS)?;
    }
    if let Some(error) = error.as_deref() {
        validate_text(error, "error", MAX_SUMMARY_CHARS)?;
    }
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let (task_id, board_id, current_column_id, current_version, current_state, auto_transition): (
        String,
        String,
        String,
        i64,
        String,
        bool,
    ) = conn
        .query_row(
            "SELECT r.task_id, t.board_id, t.column_id, t.version, r.state, t.auto_transition
             FROM kanban_task_runs r
             JOIN kanban_tasks t ON t.id = r.task_id
             JOIN kanban_boards b ON b.id = t.board_id
             WHERE r.id = ?1 AND b.project_id = ?2",
            params![run_id, project_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    if !can_transition_run_state(&current_state, &state_name) {
        return Err(format!(
            "Task run cannot transition from {current_state} to {state_name}."
        ));
    }
    let mutation_id = new_id("mutation");
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE kanban_task_runs
         SET state = ?2,
             conversation_id = COALESCE(?3, conversation_id),
             turn_id = COALESCE(?4, turn_id),
             summary = COALESCE(?5, summary),
             error = COALESCE(?6, error),
             started_at = CASE
               WHEN ?2 = 'running' AND started_at IS NULL THEN datetime('now')
               ELSE started_at END,
             completed_at = CASE
               WHEN ?2 IN ('completed', 'failed', 'cancelled') THEN COALESCE(completed_at, datetime('now'))
               ELSE completed_at END,
             updated_at = datetime('now')
         WHERE id = ?1",
        params![run_id, state_name, conversation_id, turn_id, summary, error],
    )
    .map_err(|db_error| db_error.to_string())?;

    if auto_transition {
        let target_column = match state_name.as_str() {
            "running" => Some("in_progress"),
            "completed" => Some("done"),
            "failed" => Some("blocked"),
            _ => None,
        };
        if let Some(target_column) = target_column {
            let target_id = column_id(&tx, &board_id, target_column)?;
            let changed = tx
                .execute(
                    "UPDATE kanban_tasks
                 SET column_id = ?2, version = version + 1, updated_at = datetime('now')
                 WHERE id = ?1 AND version = ?3 AND column_id <> ?2",
                    params![task_id, target_id, current_version],
                )
                .map_err(|db_error| db_error.to_string())?;
            if changed > 0 {
                resequence_column(&tx, &current_column_id)?;
                if current_column_id != target_id {
                    resequence_column(&tx, &target_id)?;
                }
            }
        }
    }
    let revision = bump_revision(&tx, &board_id)?;
    add_activity(
        &tx,
        &task_id,
        Some(&run_id),
        &actor,
        "run_state_changed",
        summary.as_deref().unwrap_or(""),
        &json!({ "run_id": run_id, "state": state_name, "error": error }),
        &mutation_id,
    )?;
    tx.commit().map_err(|db_error| db_error.to_string())?;
    let run = load_run(&conn, &run_id)?.ok_or_else(|| "Task run was not found.".to_string())?;
    emit_change(
        &app,
        &project_id,
        &board_id,
        revision,
        &mutation_id,
        "task_run",
        &run_id,
        &run,
        &actor,
    );
    Ok(run)
}

#[tauri::command]
pub fn kanban_list_task_activity(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    limit: Option<i64>,
) -> Result<Vec<KanbanTaskActivityRow>, String> {
    let conn = state.0.lock().map_err(|error| error.to_string())?;
    require_task(&conn, &project_id, &task_id)?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let mut statement = conn
        .prepare(
            "SELECT a.id, a.task_id, a.run_id, a.actor, a.event_kind, a.body,
                    a.payload, a.mutation_id, a.created_at
             FROM kanban_task_activity a
             WHERE a.task_id = ?1
             ORDER BY a.created_at DESC, a.id DESC LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let activities = statement
        .query_map(params![task_id, limit], |row| {
            Ok(KanbanTaskActivityRow {
                id: row.get(0)?,
                task_id: row.get(1)?,
                run_id: row.get(2)?,
                actor: row.get(3)?,
                event_kind: row.get(4)?,
                body: row.get(5)?,
                payload: row.get(6)?,
                mutation_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string());
    activities
}

#[cfg(test)]
mod tests {
    use super::{can_transition_run_state, ensure_default_board};
    use rusqlite::params;

    #[test]
    fn creates_a_default_board_and_ordered_columns_for_a_project() -> Result<(), String> {
        let directory =
            std::env::temp_dir().join(format!("hyscode-kanban-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let mut connection = super::super::db::open_database(&directory);
        connection
            .execute(
                "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
                params!["project", "Project", "C:/project"],
            )
            .map_err(|error| error.to_string())?;

        let board_id = ensure_default_board(&mut connection, "project")?;
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM kanban_columns WHERE board_id = ?1",
                params![board_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        assert_eq!(count, 5);
        assert!(can_transition_run_state("queued", "running"));
        assert!(!can_transition_run_state("completed", "running"));
        drop(connection);
        std::fs::remove_dir_all(directory).map_err(|error| error.to_string())?;
        Ok(())
    }
}

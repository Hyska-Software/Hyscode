-- Persistent Desktop-only Kanban state.
-- The board is intentionally separate from agent_sdd_* and from the
-- turn-local manage_tasks tool.

CREATE TABLE IF NOT EXISTS kanban_boards (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    revision    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_default_board
    ON kanban_boards(project_id) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_kanban_boards_project
    ON kanban_boards(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS kanban_columns (
    id           TEXT PRIMARY KEY,
    board_id     TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    system_key   TEXT,
    color        TEXT,
    position     INTEGER NOT NULL DEFAULT 0,
    wip_limit    INTEGER,
    is_archived  INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_system_column
    ON kanban_columns(board_id, system_key) WHERE system_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kanban_columns_board
    ON kanban_columns(board_id, position);

CREATE TABLE IF NOT EXISTS kanban_tasks (
    id               TEXT PRIMARY KEY,
    board_id         TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
    column_id        TEXT NOT NULL REFERENCES kanban_columns(id) ON DELETE RESTRICT,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    priority         TEXT NOT NULL DEFAULT 'none' CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')),
    position         INTEGER NOT NULL DEFAULT 0,
    due_date         TEXT,
    auto_transition  INTEGER NOT NULL DEFAULT 1 CHECK (auto_transition IN (0, 1)),
    is_archived      INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    archived_at      TEXT,
    version          INTEGER NOT NULL DEFAULT 1,
    created_by       TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'agent', 'system')),
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kanban_tasks_board_column
    ON kanban_tasks(board_id, column_id, position, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_updated
    ON kanban_tasks(board_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_archived
    ON kanban_tasks(board_id, is_archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS kanban_labels (
    id         TEXT PRIMARY KEY,
    board_id   TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (board_id, name)
);

CREATE TABLE IF NOT EXISTS kanban_task_labels (
    task_id  TEXT NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES kanban_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
);

CREATE TABLE IF NOT EXISTS kanban_task_runs (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    turn_id         TEXT,
    mode            TEXT NOT NULL CHECK (mode IN ('current_chat', 'dedicated_session')),
    state           TEXT NOT NULL CHECK (state IN ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
    provider_id     TEXT,
    model_id        TEXT,
    instructions    TEXT NOT NULL DEFAULT '',
    summary         TEXT,
    error           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    started_at      TEXT,
    completed_at    TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kanban_task_runs_task
    ON kanban_task_runs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_task_runs_active
    ON kanban_task_runs(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS kanban_task_activity (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
    run_id      TEXT REFERENCES kanban_task_runs(id) ON DELETE SET NULL,
    actor       TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'system')),
    event_kind  TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    payload     TEXT NOT NULL DEFAULT '{}',
    mutation_id TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kanban_activity_task
    ON kanban_task_activity(task_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_activity_mutation
    ON kanban_task_activity(mutation_id);

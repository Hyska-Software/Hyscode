-- Migration 005: open_tabs — persist open conversation tabs across sessions
-- Safe to run multiple times (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS open_tabs (
    id          TEXT NOT NULL PRIMARY KEY,
    project_id  TEXT NOT NULL,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    title       TEXT NOT NULL DEFAULT 'New Chat',
    mode        TEXT NOT NULL DEFAULT 'chat',
    tab_index   INTEGER NOT NULL DEFAULT 0,
    last_focused_at TEXT NOT NULL DEFAULT (datetime('now'))
);

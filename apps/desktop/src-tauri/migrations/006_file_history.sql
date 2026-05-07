-- Migration 006: file_history — per-file snapshot history recorded on every save.
-- Safe to run multiple times (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS file_history (
    id          TEXT NOT NULL PRIMARY KEY,
    file_path   TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fh_path_date
    ON file_history (file_path, created_at DESC);

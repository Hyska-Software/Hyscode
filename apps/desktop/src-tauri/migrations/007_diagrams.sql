CREATE TABLE IF NOT EXISTS diagrams (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT 'Untitled Diagram',
    content     TEXT NOT NULL DEFAULT '{}',
    source_file TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_diagrams_project ON diagrams(project_id);

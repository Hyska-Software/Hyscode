-- HysCode Migration 008: Persistent Agent Memory
-- Per-project memory store for cross-session knowledge retention.
-- FTS5 full-text search for efficient semantic queries.

-- ─── Project Memories ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memories (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT REFERENCES projects(id) ON DELETE CASCADE,
    type                    TEXT NOT NULL DEFAULT 'fact' CHECK (type IN (
                                'fact', 'decision', 'preference', 'pattern',
                                'workflow', 'error_solution', 'convention',
                                'user_preference', 'architecture_knowledge'
                            )),
    title                   TEXT NOT NULL,
    content                 TEXT NOT NULL,
    summary                 TEXT NOT NULL DEFAULT '',   -- <=300 chars, cheap injection
    tags                    TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
    source_conversation_id  TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    source_message_ids      TEXT,                       -- JSON array of message IDs
    relevance_score         REAL NOT NULL DEFAULT 0.7,  -- 0.0–1.0, decays over time
    access_count            INTEGER NOT NULL DEFAULT 0,
    last_accessed_at        TEXT,
    created_by              TEXT NOT NULL DEFAULT 'agent' CHECK (created_by IN ('agent', 'user', 'system')),
    status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_project_type ON memories(project_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_project_relevance ON memories(project_id, relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_memories_project_accessed ON memories(project_id, last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_project_status ON memories(project_id, status);
CREATE INDEX IF NOT EXISTS idx_memories_source_conv ON memories(source_conversation_id);

-- ─── FTS5 Full-Text Search Index ────────────────────────────────────────────
-- Linked to the memories table for content-based retrieval.

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    id UNINDEXED,
    project_id UNINDEXED,
    title,
    content,
    summary,
    tags,
    type UNINDEXED,
    relevance_score UNINDEXED,
    tokenize = 'porter unicode61'
);

-- ─── Triggers: Keep FTS5 in Sync ────────────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS memories_after_insert
AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(id, project_id, title, content, summary, tags, type, relevance_score)
    VALUES (new.id, new.project_id, new.title, new.content, new.summary, new.tags, new.type, new.relevance_score);
END;

CREATE TRIGGER IF NOT EXISTS memories_after_update
AFTER UPDATE ON memories BEGIN
    UPDATE memories_fts
    SET title = new.title,
        content = new.content,
        summary = new.summary,
        tags = new.tags,
        relevance_score = new.relevance_score
    WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS memories_after_delete
AFTER DELETE ON memories BEGIN
    DELETE FROM memories_fts WHERE id = old.id;
END;

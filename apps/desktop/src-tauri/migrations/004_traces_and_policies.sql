-- HysCode Migration 004: Trace Records
-- Structured tracing for agent harness observability.

-- ─── Turn Records ───────────────────────────────────────────────────────────
-- One row per agent turn. Lightweight summary for quick queries.

CREATE TABLE IF NOT EXISTS turn_records (
    id                      TEXT PRIMARY KEY,
    conversation_id         TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    mode                    TEXT NOT NULL,
    iterations              INTEGER NOT NULL DEFAULT 1,
    tool_calls              TEXT,           -- JSON array of ToolCallRecord[]
    token_input             INTEGER NOT NULL DEFAULT 0,
    token_output            INTEGER NOT NULL DEFAULT 0,
    stop_reason             TEXT NOT NULL CHECK (stop_reason IN ('complete', 'max_iterations', 'cancelled', 'error')),
    verification_performed  INTEGER NOT NULL DEFAULT 0,
    verification_forced     INTEGER NOT NULL DEFAULT 0,
    files_modified          TEXT,           -- JSON array of file paths
    duration_ms             INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_turn_records_conversation ON turn_records(conversation_id);
CREATE INDEX IF NOT EXISTS idx_turn_records_mode ON turn_records(mode);
CREATE INDEX IF NOT EXISTS idx_turn_records_stop_reason ON turn_records(stop_reason);

-- ─── Traces ─────────────────────────────────────────────────────────────────
-- Full trace with per-iteration detail. One row per agent turn.

CREATE TABLE IF NOT EXISTS traces (
    id                      TEXT PRIMARY KEY,
    conversation_id         TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    mode                    TEXT NOT NULL,
    provider                TEXT NOT NULL DEFAULT '',
    model                   TEXT NOT NULL DEFAULT '',
    system_prompt_hash      TEXT,
    system_prompt_preview   TEXT,
    system_prompt_tokens    INTEGER NOT NULL DEFAULT 0,
    tool_count              INTEGER NOT NULL DEFAULT 0,
    iterations              TEXT NOT NULL DEFAULT '[]',  -- JSON array of TraceIteration[]
    token_input             INTEGER NOT NULL DEFAULT 0,
    token_output            INTEGER NOT NULL DEFAULT 0,
    stop_reason             TEXT NOT NULL CHECK (stop_reason IN ('complete', 'max_iterations', 'cancelled', 'error')),
    verification_performed  INTEGER NOT NULL DEFAULT 0,
    verification_forced     INTEGER NOT NULL DEFAULT 0,
    files_modified          TEXT,           -- JSON array of file paths
    errors                  TEXT,           -- JSON array of {iteration, message, toolName?}
    loop_warnings           TEXT,           -- JSON array of {iteration, filePath, editCount}
    duration_ms             INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_traces_conversation ON traces(conversation_id);
CREATE INDEX IF NOT EXISTS idx_traces_mode ON traces(mode);
CREATE INDEX IF NOT EXISTS idx_traces_stop_reason ON traces(stop_reason);
CREATE INDEX IF NOT EXISTS idx_traces_created_at ON traces(created_at);

-- ─── Mode Policies ──────────────────────────────────────────────────────────
-- Per-mode execution profiles. Overridable by user settings.

CREATE TABLE IF NOT EXISTS mode_policies (
    mode                TEXT PRIMARY KEY,
    max_iterations      INTEGER NOT NULL DEFAULT 25,
    max_input_tokens    INTEGER NOT NULL DEFAULT 200000,
    max_output_tokens   INTEGER NOT NULL DEFAULT 16000,
    turn_timeout_ms     INTEGER NOT NULL DEFAULT 300000,
    approval_mode       TEXT NOT NULL DEFAULT 'manual' CHECK (approval_mode IN ('manual', 'yolo', 'custom')),
    verification_required INTEGER NOT NULL DEFAULT 0,
    allowed_tool_categories TEXT NOT NULL DEFAULT '[]',  -- JSON array
    tool_overrides      TEXT,                            -- JSON object
    skill_triggers      TEXT,                            -- JSON array of skill names to auto-suggest
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default policies
INSERT OR IGNORE INTO mode_policies (mode, max_iterations, max_input_tokens, max_output_tokens, turn_timeout_ms, verification_required, allowed_tool_categories) VALUES
    ('chat',   10, 128000,  8000, 120000, 0, '["filesystem","git","meta"]'),
    ('build',  25, 200000, 16000, 300000, 1, '["filesystem","terminal","git","code","mcp","meta"]'),
    ('review', 15, 200000, 12000, 180000, 0, '["filesystem","git","meta"]'),
    ('debug',  20, 200000, 16000, 300000, 1, '["filesystem","terminal","git","code","mcp","meta"]'),
    ('plan',   15, 200000, 12000, 180000, 0, '["filesystem","git","meta"]');

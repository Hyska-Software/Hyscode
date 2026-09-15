-- Persistent execution goals. The goal is scoped to one conversation and
-- keeps its control-plane state separate from the transcript and turn rows.

CREATE TABLE IF NOT EXISTS persistent_goals (
    id                    TEXT PRIMARY KEY,
    conversation_id       TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    project_id            TEXT NOT NULL,
    objective             TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('active', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete', 'cancelled')),
    verification          TEXT NOT NULL CHECK (verification IN ('verified', 'partial', 'unverified')),
    version               INTEGER NOT NULL DEFAULT 1,
    budget_max_tokens     INTEGER,
    budget_max_turns      INTEGER,
    budget_max_duration   INTEGER,
    budget_max_tool_calls INTEGER,
    budget_max_cost_usd   REAL,
    budget_max_errors     INTEGER,
    usage_input_tokens    INTEGER NOT NULL DEFAULT 0,
    usage_output_tokens   INTEGER NOT NULL DEFAULT 0,
    usage_total_tokens    INTEGER NOT NULL DEFAULT 0,
    usage_turns           INTEGER NOT NULL DEFAULT 0,
    usage_tool_calls      INTEGER NOT NULL DEFAULT 0,
    usage_duration_ms     INTEGER NOT NULL DEFAULT 0,
    usage_cost_usd        REAL,
    usage_consecutive_errors INTEGER NOT NULL DEFAULT 0,
    usage_last_turn_at    TEXT,
    checkpoint             TEXT NOT NULL DEFAULT '',
    last_error             TEXT,
    current_run_id         TEXT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL,
    completed_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_persistent_goals_project
    ON persistent_goals(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS persistent_goal_criteria (
    id                 TEXT PRIMARY KEY,
    goal_id            TEXT NOT NULL REFERENCES persistent_goals(id) ON DELETE CASCADE,
    description        TEXT NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('review', 'file_exists', 'command', 'tool_success')),
    config             TEXT NOT NULL DEFAULT '{}',
    required           INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
    status             TEXT NOT NULL CHECK (status IN ('pending', 'passed', 'failed', 'unproven')),
    verification_note  TEXT,
    evidence_id        TEXT
);

CREATE INDEX IF NOT EXISTS idx_persistent_goal_criteria_goal
    ON persistent_goal_criteria(goal_id);

CREATE TABLE IF NOT EXISTS persistent_goal_evidence (
    id           TEXT PRIMARY KEY,
    goal_id      TEXT NOT NULL REFERENCES persistent_goals(id) ON DELETE CASCADE,
    criterion_id TEXT REFERENCES persistent_goal_criteria(id) ON DELETE SET NULL,
    source       TEXT NOT NULL CHECK (source IN ('user', 'agent', 'validator', 'system')),
    summary      TEXT NOT NULL,
    details      TEXT,
    passed       INTEGER NOT NULL CHECK (passed IN (0, 1)),
    verified     INTEGER NOT NULL CHECK (verified IN (0, 1)),
    turn_id      TEXT,
    created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_persistent_goal_evidence_goal
    ON persistent_goal_evidence(goal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS persistent_goal_blockers (
    id                TEXT PRIMARY KEY,
    goal_id           TEXT NOT NULL REFERENCES persistent_goals(id) ON DELETE CASCADE,
    fingerprint       TEXT NOT NULL,
    summary           TEXT NOT NULL,
    details           TEXT,
    consecutive_turns INTEGER NOT NULL DEFAULT 1,
    first_seen_at     TEXT NOT NULL,
    last_seen_at      TEXT NOT NULL,
    last_turn_id      TEXT,
    resolved_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_persistent_goal_blockers_goal
    ON persistent_goal_blockers(goal_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS persistent_goal_runs (
    id             TEXT PRIMARY KEY,
    goal_id        TEXT NOT NULL REFERENCES persistent_goals(id) ON DELETE CASCADE,
    turn_id        TEXT,
    source         TEXT NOT NULL CHECK (source IN ('user', 'continuation', 'resume')),
    status         TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    started_at     TEXT,
    completed_at   TEXT,
    token_usage    TEXT NOT NULL DEFAULT '{}',
    tool_calls     INTEGER NOT NULL DEFAULT 0,
    duration_ms    INTEGER NOT NULL DEFAULT 0,
    error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_persistent_goal_runs_goal
    ON persistent_goal_runs(goal_id, started_at DESC);

CREATE TABLE IF NOT EXISTS persistent_goal_events (
    id         TEXT PRIMARY KEY,
    goal_id    TEXT NOT NULL REFERENCES persistent_goals(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    message    TEXT NOT NULL,
    turn_id    TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_persistent_goal_events_goal
    ON persistent_goal_events(goal_id, created_at DESC);

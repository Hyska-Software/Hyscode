-- SDD schema owned by the agent harness. The legacy sdd_* tables are retained
-- only for backward compatibility; all current code uses agent_sdd_*.
CREATE TABLE IF NOT EXISTS agent_sdd_sessions (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    description      TEXT NOT NULL,
    spec             TEXT,
    spec_approved    INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL CHECK (status IN (
                         'describing','specifying','planning','executing',
                         'reviewing','completed','cancelled'
                     )),
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sdd_sessions_project
    ON agent_sdd_sessions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sdd_sessions_conversation
    ON agent_sdd_sessions(conversation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_sdd_tasks (
    id               TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL REFERENCES agent_sdd_sessions(id) ON DELETE CASCADE,
    ordinal          INTEGER NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL,
    files            TEXT NOT NULL DEFAULT '[]',
    dependencies     TEXT NOT NULL DEFAULT '[]',
    status           TEXT NOT NULL CHECK (status IN (
                         'pending','in_progress','completed','skipped','failed'
                     )),
    agent_output     TEXT,
    tool_calls       TEXT NOT NULL DEFAULT '[]',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sdd_tasks_session
    ON agent_sdd_tasks(session_id, ordinal);

-- Preserve legacy sessions whose conversation still belongs to a project.
INSERT OR IGNORE INTO agent_sdd_sessions (
    id, project_id, conversation_id, description, spec, spec_approved,
    status, created_at, updated_at
)
SELECT
    legacy.id,
    conversation.project_id,
    legacy.conversation_id,
    legacy.description,
    legacy.spec,
    CASE WHEN legacy.phase IN ('plan', 'execute', 'review') OR legacy.status = 'completed' THEN 1 ELSE 0 END,
    CASE
        WHEN legacy.status = 'cancelled' THEN 'cancelled'
        WHEN legacy.status = 'completed' THEN 'completed'
        WHEN legacy.phase = 'spec' THEN 'specifying'
        WHEN legacy.phase = 'plan' THEN 'planning'
        WHEN legacy.phase = 'execute' THEN 'executing'
        WHEN legacy.phase = 'review' THEN 'reviewing'
        ELSE 'describing'
    END,
    legacy.created_at,
    legacy.updated_at
FROM sdd_sessions AS legacy
JOIN conversations AS conversation ON conversation.id = legacy.conversation_id
WHERE conversation.project_id IS NOT NULL;

INSERT OR IGNORE INTO agent_sdd_tasks (
    id, session_id, ordinal, title, description, files, dependencies,
    status, agent_output, tool_calls, created_at, updated_at
)
SELECT
    task.id,
    task.session_id,
    task.sort_order,
    task.title,
    COALESCE(task.description, ''),
    COALESCE(task.files, '[]'),
    '[]',
    CASE WHEN task.status = 'running' THEN 'in_progress' ELSE task.status END,
    task.output,
    '[]',
    COALESCE(task.started_at, session.created_at),
    COALESCE(task.completed_at, task.started_at, session.updated_at)
FROM sdd_tasks AS task
JOIN agent_sdd_sessions AS session ON session.id = task.session_id;

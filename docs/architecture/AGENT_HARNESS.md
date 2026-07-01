# Agent Harness Architecture

## Overview

The **Harness** is the orchestration engine that powers agentic behavior in HysCode. It manages the agent loop, routes tool calls, tracks execution plans, loads skills, and implements the SDD (Spec-Driven Development) workflow.

---

## Core Concepts

### Agent Loop

```
┌──────────────────────────────────────────────────┐
│                  HARNESS ENGINE                   │
│                                                   │
│  ┌─────────┐   ┌─────────┐   ┌──────────┐       │
│  │ OBSERVE │──→│  THINK  │──→│   PLAN   │       │
│  │         │   │  (LLM)  │   │          │       │
│  └────▲────┘   └─────────┘   └────┬─────┘       │
│       │                           │              │
│       │        ┌──────────┐       │              │
│       └────────│  UPDATE  │←──────┤              │
│                │ CONTEXT  │       ▼              │
│                └──────────┘   ┌──────────┐       │
│                               │   ACT    │       │
│                               │ (tools)  │       │
│                               └──────────┘       │
└──────────────────────────────────────────────────┘
```

**Steps:**

1. **Observe**: gather context (open files, git state, conversation history, user selection)
2. **Think**: send context + messages to LLM, receive response with potential tool calls
3. **Plan**: if tool calls present, validate against approval rules
4. **Act**: execute approved tool calls via Tool Router
5. **Update Context**: incorporate tool results into conversation, update token budget
6. **Repeat**: continue until LLM returns final text response or user interrupts

### Iteration Limits

- **Max iterations per turn**: configurable (default: 25)
- **Max tokens per turn**: configurable (default: 200k input, 16k output)
- **Timeout**: configurable (default: 5 minutes per turn)

### Turn Lifecycle

Every run has a unique `turnId` and one terminal outcome: `complete`,
`max_iterations`, `loop_detected`, `cancelled`, or `error`. Cancellation is
propagated to provider streams, tool execution, approvals, mode switches, and
agent questions through a shared `AbortSignal`. A harness rejects concurrent
turns rather than allowing their events to interleave.

---

## SDD (Spec-Driven Development) Engine

SDD is a structured workflow where features are described, specified, planned, and executed in discrete phases.

### Phases

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ DESCRIBE │──→│   SPEC   │──→│   PLAN   │──→│ EXECUTE  │──→ REVIEW
│ (user)   │   │  (agent) │   │  (agent) │   │  (agent) │
└─────────┘    └──────────┘    └──────────┘    └──────────┘
                    ↑ approve       ↑ approve       ↑ pause/resume
```

#### Phase 1: DESCRIBE

- User writes a natural language description of the desired feature
- Can include context: files to modify, constraints, examples

#### Phase 2: SPEC

- Agent generates a specification document (Markdown)
- Includes: purpose, acceptance criteria, affected files, edge cases, out-of-scope
- User reviews in Monaco Editor, can edit freely
- User approves or requests revision

#### Phase 3: PLAN

- Agent reads approved spec and generates a task list
- Each task: `{ id, title, description, files, dependencies, status }`
- Tasks are stored in SQLite for persistence
- User reviews, can reorder/edit/delete tasks
- User approves plan

#### Phase 4: EXECUTE

- Harness executes tasks sequentially (respecting dependencies)
- Each task triggers an agent loop (observe → think → act)
- Real-time progress UI: current task, completed count, tool calls
- User can **pause** (after current task completes), **resume**, or **skip** tasks
- Each task creates an undo checkpoint in the editor

#### Phase 5: REVIEW

- After all tasks complete, agent performs a self-review
- Checks: code compiles, tests pass (if applicable), consistency with spec
- Generates summary of all changes made
- User makes final approval

### SDD Data Model

```typescript
interface SddSession {
  id: string;
  projectId: string;
  description: string; // user's original prompt
  spec: string | null; // generated specification (markdown)
  specApproved: boolean;
  tasks: SddTask[];
  status:
    | 'describing'
    | 'specifying'
    | 'planning'
    | 'executing'
    | 'reviewing'
    | 'completed'
    | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

interface SddTask {
  id: string;
  sessionId: string;
  ordinal: number;
  title: string;
  description: string;
  files: string[]; // affected file paths
  dependencies: string[]; // task IDs this depends on
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';
  agentOutput: string | null; // agent's summary of what was done
  toolCalls: ToolCallRecord[]; // logged tool calls
}
```

---

## Context Manager

Responsible for assembling the context window sent to the LLM.

### Context Sources

| Source               | Priority | Description                                  |
| -------------------- | -------- | -------------------------------------------- |
| System prompt        | ALWAYS   | Base agent instructions + active skills      |
| Conversation history | ALWAYS   | Previous messages (with truncation strategy) |
| Active file          | HIGH     | Content of the file currently open in editor |
| Selected text        | HIGH     | User's current text selection                |
| Context chips        | HIGH     | Files/symbols explicitly added by user       |
| Git diff             | MEDIUM   | Uncommitted changes                          |
| File tree            | LOW      | Directory structure (summarized)             |
| Terminal output      | LOW      | Last command output                          |
| Search results       | LOW      | Recent search results                        |

### Token Budget Management

```typescript
interface TokenBudget {
  maxInput: number; // e.g., 200_000 for Claude
  maxOutput: number; // e.g., 16_000
  reserved: {
    systemPrompt: number; // estimated tokens for system prompt + skills
    toolDefinitions: number; // tokens for tool schemas
    responseBuffer: number; // minimum output tokens available
  };
  available: number; // maxInput - reserved totals
}
```

**Strategy:**

1. Always include complete protocol frames; assistant tool calls and their tool results are atomic
2. Fill remaining budget with context sources by priority
3. **Truncation**: older complete frames are dropped; orphan tool messages are never sent
4. **Sliding window**: when budget exhausted, oldest non-pinned messages are dropped

---

## Tool Router

Maps LLM tool calls to concrete implementations.

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  category: 'filesystem' | 'terminal' | 'git' | 'code' | 'browser' | 'mcp';
  requiresApproval: boolean; // per settings
  handler: (input: unknown) => Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

### Built-in Tools

| Tool                   | Category   | Approval Default |
| ---------------------- | ---------- | ---------------- |
| `read_file`            | filesystem | no               |
| `write_file`           | filesystem | yes              |
| `create_file`          | filesystem | yes              |
| `list_directory`       | filesystem | no               |
| `search_code`          | filesystem | no               |
| `run_terminal_command` | terminal   | yes              |
| `git_status`           | git        | no               |
| `git_diff`             | git        | no               |
| `git_commit`           | git        | yes              |
| `git_add`              | git        | yes              |
| `run_code`             | code       | yes              |
| `web_search`           | browser    | no               |
| `mcp_call`             | mcp        | configurable     |

### Approval Workflow

```
Agent requests tool_call
  → Tool Router checks tool.requiresApproval
  → If requires approval:
      → Add to pendingToolCalls in agentStore
      → UI shows approval card with tool name, input preview
      → User clicks Approve or Reject
      → If approved: execute and return result to agent
      → If rejected: return rejection reason to agent
  → If auto-approved:
      → Execute immediately
      → Show execution card in UI (collapsed by default)
```

**Approval modes:**

- `manual`: approval for every tool marked as approval-sensitive
- `smart`: risk-based approval with automatic safe reads
- `session-trust`: approve a tool type once per session
- `notify`: execute without blocking and emit a notification
- `yolo`: execute without approval
- `custom`: tool overrides, then category overrides, then tool defaults

---

## Skill Loader

Loads skill definitions and injects them into the agent's system prompt.

### Skill Resolution Order

1. **Built-in skills**: `packages/skills/` (shipped with app)
2. **Global skills**: `~/.hyscode/skills/` (user's global skills)
3. **Workspace skills**: `.hyscode/skills/` (project-specific skills)

### Loading Process

```typescript
async function loadSkills(workspacePath: string): Promise<Skill[]> {
  const builtIn = await loadSkillsFromDir(BUILT_IN_SKILLS_PATH);
  const global = await loadSkillsFromDir(GLOBAL_SKILLS_PATH);
  const workspace = await loadSkillsFromDir(join(workspacePath, '.hyscode/skills'));

  // Workspace overrides global, global overrides built-in (by name)
  return mergeSkills(builtIn, global, workspace);
}
```

### Skill Injection

Active skills are appended to the system prompt:

```
<skills>
{for each active skill}
<skill name="{name}">
{skill markdown content}
</skill>
{/for}
</skills>
```

### Skill Activation

- Skills can be **always active** or **trigger-based**
- Trigger conditions defined in frontmatter: `trigger: "when user mentions testing"`
- Agent can also request skill activation via a meta-tool: `activate_skill(name)`

---

## Plan Manager

Tracks SDD execution state in SQLite for persistence across app restarts.

### Tables

```sql
CREATE TABLE agent_sdd_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  description TEXT NOT NULL,
  spec TEXT,
  spec_approved INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'describing',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_sdd_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sdd_sessions(id),
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',        -- JSON array
  dependencies TEXT NOT NULL DEFAULT '[]',  -- JSON array of task IDs
  status TEXT NOT NULL DEFAULT 'pending',
  agent_output TEXT,
  tool_calls TEXT NOT NULL DEFAULT '[]',    -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## Error Handling

### Canonical turn protocol

The harness owns provider-native assistant and tool-result blocks. It emits `transcript_message` events with immutable turn/conversation/iteration identity. Desktop adapters render and persist these blocks without reconstructing ordering.

Cancellation is cooperative for PTY and provider operations. Native calls without cancellation support are awaited; if one completes after cancellation, the turn ends as `cancelled_partial`.

Workspace-relative paths are normalized and checked by segment containment. External absolute paths are rejected by default and require explicitly authorized adapter policy.

| Error Type                 | Handling                                                        |
| -------------------------- | --------------------------------------------------------------- |
| LLM API error (rate limit) | Exponential backoff, retry up to 3x, then surface to user       |
| LLM API error (auth)       | Surface immediately, prompt to check API key in settings        |
| Tool execution error       | Return error message to agent, agent decides next action        |
| Tool timeout               | Kill execution, return timeout error to agent                   |
| Context overflow           | Truncate oldest messages, warn user via status bar              |
| Agent loop stuck           | Detect repeated identical tool calls (3x), break loop, ask user |

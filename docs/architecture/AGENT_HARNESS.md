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

### Interaction Limits

- **Agent interactions per turn**: unlimited by default; users can opt into a
  configurable limit from Settings
- **GitHub Copilot**: retains mode-specific interaction caps because each
  interaction consumes a premium request; a lower user limit still wins
- **Mode policy compatibility**: persisted `max_iterations` values remain in
  the policy schema but do not cap the main agent
- **Max tokens per turn**: configurable (default: 200k input, 16k output)
- **Timeout**: configurable (default: 5 minutes per turn)

Unlimited turns still stop on normal model completion, explicit cancellation,
request timeout, repeated-call loop detection, or provider failure. Sub-agents
retain their separate interaction-limit setting.

### Delegated Child Turns

Delegation uses `Harness.createChild()` rather than reconstructing a second
runtime in the desktop layer. A child receives the parent environment for
filesystem access, dirty-buffer protection, approvals, terminal sessions,
memory, skills, and rules. Parent-only external tools are not inherited by
default; the caller must explicitly pass an allow-list such as MCP tools from
servers marked `agentSafe`.

Children increment `ToolExecutionContext.delegationLevel`. This lets tools
reject top-level interactions such as `ask_user` and `request_mode_switch`
without relying only on prompt instructions. Child turns use the parent
conversation ID so memory provenance, terminal ownership, and observability
remain attached to the real conversation. Their records and traces may carry a
`parent_turn_id` for querying delegated work independently.

### Optional Desktop Kanban integration

Desktop may construct a Harness with the additive `taskIntegration` option.
That option registers the namespaced `kanban_*` tools and carries an optional
`AgentTaskContext` through `TurnRequest`, `ToolExecutionContext`, and lifecycle
events. Read-only task listing is safe; task mutations, permanent deletion, and
delegation remain approval-gated. A child Harness receives the task context but does not inherit
the persistent Kanban mutation/delegation tools, preventing recursive task
creation.

The Desktop task service owns SQLite persistence and revisioned
`kanban:changed` events. `TaskExecutionCoordinator` uses the existing
`HarnessBridge` and provider registry rather than dispatching to a provider
directly. Harnesses created without `taskIntegration`, including the TUI
runtime, retain their existing tool surface and do not expose Kanban.

### Read Reuse Policy

Large reviews commonly read separate line ranges from the same source file.
The harness therefore tracks canonical paths and read spans instead of applying
a file-wide read count. Non-overlapping ranges are allowed. Repeated
successful overlapping reads produce a context warning rather than cancelling
the child turn. `read_file` and `read_multiple_files` populate a per-turn raw
content cache, and `gather_context` reuses that cache when possible.

Review and plan turns also use automatic gathered excerpts so context remains
available after older protocol frames are compacted.

### Parallel Delegation

Only `spawn_subagent` batches run concurrently. A batch composed entirely of
parallel-safe tools executes with one immutable execution context per call and
`Promise.allSettled`, preserving the original tool-call order in the transcript.
All other tool batches stay sequential.

The desktop coordinator (`SubAgentCoordinator`) enforces the app-level policy:

- `review` children hold a shared workspace lease and run in parallel, bounded
  by `subAgentMaxConcurrent` (default 2, max 4).
- `build`, `debug`, and `plan` children hold an exclusive workspace lease and
  queue behind running children. Once an exclusive child is queued, new shared
  children wait until it completes.
- Queued children are visible in the UI with their queue position and can be
  cancelled before they start.

Concurrent children receive isolated resources: unique approval ids routed to
the owning child router, a dedicated visible terminal session per child
(`ownerId`), serialized mutation-snapshot capture per path, and per-child token
usage. Parent cancellation cancels queued children immediately and aborts all
active runners.

### Turn Lifecycle

Every run has a unique `turnId` and one terminal outcome: `complete`,
`max_iterations`, `loop_detected`, `cancelled`, or `error`. Cancellation is
propagated to provider streams, tool execution, approvals, mode switches, and
agent questions through a shared `AbortSignal`. A harness rejects concurrent
turns rather than allowing their events to interleave.

### Prompt Cache Observability and Persistence

Prompt-cache measurements travel through the shared `TokenUsage` and `Trace`
contracts. Providers report raw cache-read and cache-write tokens when the
provider exposes them; the harness preserves unknown measurements instead of
turning them into false misses, and derives token-weighted and request-weighted
hit rates only from eligible observations.

The desktop persists turn-level cache metrics and cumulative session usage in
SQLite. The standalone TUI uses `CliDataStore` JSON but persists the same raw
counters, derived session metrics, and trace-level `promptCache` snapshots.
Codex conversations in the TUI also persist the provider thread id together
with the stable prompt fingerprint, so a changed system prompt cannot resume a
thread with incompatible cached context.

### Thinking Configuration and Client Synchronization

The harness accepts the shared `ThinkingConfig` contract from the provider layer.
Thinking is enabled only when the selected model declares compatible
`thinkingVariants`; `level` remains the canonical effort field, while `mode`,
`budgetTokens`, `type`, and `display` carry provider-native options when needed.
The harness applies the selected configuration to the next provider request and
does not create a separate TUI settings store.

The TUI runtime exposes the model capability metadata and the current value in its
additive `runtime_ready` payload. Visual `/thinking` selections call `set_config`
with the existing `providerId`, `modelId`, and `thinking` fields. Runtime validation
rejects unsupported enabled levels and normalizes incompatible persisted values to
a safe disabled state.

Both clients persist per-model settings under `${providerId}::${modelId}` in the
default shared settings file. On desktop startup, shared settings are read before
the initial export; active provider, active model, and thinking settings are
imported while desktop-only settings remain local. Synchronization is launch-based,
without a live file watcher, and a TUI `--config` path remains isolated.

The TUI also persists its presentation-only `sidebarVisible` preference through
the same runtime configuration contract. `/sidebar` sends the value through
`set_config`, updates the renderer immediately, and desktop shared-settings
writes preserve the field so a desktop settings update cannot reset the TUI
layout preference.

The same additive `runtime_ready` payload exposes a bounded `recentSessions`
projection for the TUI startup surface. The renderer uses it for the welcome
layout while the existing `session_list` request remains authoritative for the
full session browser.

The payload also exposes a `GitSummary` snapshot for the TUI header. It contains
the current branch and aggregate insertion/deletion counts from uncommitted
tracked changes. The standalone client refreshes this additive summary
periodically through `git_summary`, keeping Git inspection out of the render
loop while reflecting edits made during an active session.

The runtime also exposes the shared VORTEX update preferences in
`runtime_ready`. The standalone client owns the update lifecycle: it queries
the Stable or Pre-release GitHub channel, selects the exact native target from
the release manifest, verifies size and SHA-256, validates the complete bundle,
and uses a detached helper for a rollback-safe user-local installation swap.
The TUI schedules startup checks after rendering becomes available, supports
`/update`, and never applies an update while an agent turn is active. Protected
installations use the platform installer and do not receive silent elevation.

### Theme Catalog and Client Synchronization

The `@hyscode/theme` package owns the built-in theme ids and the normalized color
surface used by both clients. The runtime includes `activeThemeId` and the
available `ThemeSummary` catalog in `runtime_ready`; `/theme` sends a validated
`themeId` through `set_config`, updates the TUI renderer immediately, and writes
the selection to the shared settings file. Desktop hydration imports the same
field on startup. The TUI discovers enabled extension themes from the installed
`extension.json` contributions and their JSON assets under `~/.hyscode/extensions`,
using `extension-state.json` to exclude disabled extensions and rejecting assets
outside each extension directory.

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

### Native project instructions

`RuleLoader` is the single owner of rule discovery and resolution. For an open
workspace it discovers `AGENTS.md` and `CLAUDE.md` case-insensitively from the
workspace root through each requested target directory. The root is the trust
boundary: parent directories, the home directory, and targets outside the
workspace are never searched. Both filenames may be present in one directory;
the deterministic order is workspace root to target, then `AGENTS.md` before
`CLAUDE.md` at the same level.

Native rules have path-derived IDs, `origin: 'native'`, `mandatory: true`, and
an `appliesFrom` directory. They are always active, read-only, and separate
from the editable `.hyscode/rules` entries. Missing, empty, unreadable, or
oversized files produce discovery diagnostics and do not prevent a session
from starting. `TurnRequest.ruleTargetPaths` lets desktop and TUI provide the
workspace, active file, and context-file scope.

The harness refreshes rules before the first provider request and at the start
of every later turn. The harness owns the effective injected list; desktop and
TUI stores are projections of discovery plus preferences for managed rules.
`Harness.createChild()` forks the loader and copies the resolved target scope,
so a sub-agent cannot race or mutate its parent's rule state. Native
instructions are rendered in a dedicated `<project_instructions>` prompt
section after managed global/workspace rules and before skills. They cannot
override system or developer instructions, the explicit user request, safety
rules, tool-approval requirements, or workspace path policy.

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

### Prompt-cache preparation and telemetry

Prompt caching is a first-class harness concern and is independent from the other
cost-optimization switches. Before each provider request, `RequestPreparation`
canonicalizes the tool definitions, computes a versioned stable-prefix hash, and
creates a project-scoped key only when the provider/model declares keyed caching.
The request carries the provider-specific cache policy while the trace records the
same prefix fingerprint for later diagnosis.

Each API attempt records a `PromptCacheObservation` with one of these states:

| State | Meaning | Hit denominator |
| --- | --- | --- |
| `hit` | Native cache read was reported for an eligible prefix | yes |
| `miss` | Native cache fields were reported but no read occurred | yes |
| `not-reported` | Provider supports caching but omitted cache usage fields | no |
| `ineligible` | Stable prefix is below the 1,024-token minimum | no |
| `unsupported` | Provider/model does not expose prompt caching | no |

The trace and persisted turn record keep both token-weighted and request-weighted
metrics. The weighted rate is bounded to the eligible prefix, so cached history or
provider bookkeeping cannot inflate the result above 100%. Unknown telemetry is
visible and never silently counted as a miss.

The desktop database migration stores raw counters rather than derived floating
point rates. This keeps historical rows safe and lets the read path derive
`cacheHitRate`, `cacheRequestHitRate`, `cacheInputReadRatio`, and `cacheUnknownRate`
consistently after restart.

For the Codex sidecar, `sessionId` and `sessionFingerprint` are propagated through
the harness. Rust remembers and persists the native SDK thread id; a changed stable
fingerprint fences reuse and starts a new native thread. This preserves Codex's own
cache/session semantics without duplicating the complete HysCode history on every
resumed request.

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
  externalPathAccess?: {
    operation: 'read' | 'write' | 'execute';
    fields: Array<{ key: string; kind: 'target' | 'directory' }>;
  };
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

| Tool                     | Category   | Approval Default |
| ------------------------ | ---------- | ---------------- |
| `read_file`              | filesystem | no               |
| `write_file`             | filesystem | yes              |
| `create_file`            | filesystem | yes              |
| `list_directory`         | filesystem | no               |
| `search_code`            | filesystem | no               |
| `run_terminal_command`   | terminal   | yes              |
| `respond_terminal_input` | terminal   | yes              |
| `read_terminal_output`   | terminal   | no               |
| `stop_terminal_process`  | terminal   | yes              |
| `git_status`             | git        | no               |
| `git_diff`               | git        | no               |
| `git_commit`             | git        | yes              |
| `git_add`                | git        | yes              |
| `run_code`               | code       | yes              |
| `web_search`             | browser    | no               |
| `web_fetch`              | browser    | no               |
| `mcp_call`               | mcp        | configurable     |

Web tools (`web_search`, `web_fetch`) are classified `safe` (`CATEGORY_RISK`), listed in `SAFE_TOOLS`, and the desktop app's smart-approval mode derives its safe set from `SAFE_TOOLS` so classifications cannot drift.

### Approval Workflow

```
Agent requests tool_call
  → Tool Router validates declared path fields
  → If an external path is not covered by a session grant:
      → Always enqueue an external-access approval, regardless of mode
  → If the tool also requires normal approval:
      → Add one combined request to pendingToolCalls in agentStore
      → UI shows the tool and external path preview
      → User approves, grants the directory for this session, or rejects
      → If approved: execute with an authorized per-call path resolver
      → If rejected: return a recoverable rejection reason to the agent
  → If no external approval is required and the tool is auto-approved:
      → Execute immediately
      → Show execution card in UI (collapsed by default)
```

**Approval modes:**

- `manual`: approval for every tool marked as approval-sensitive
- `smart`: risk-based approval with automatic safe reads
- `session-trust`: approve a tool type once per session
- `notify`: execute without blocking and emit a notification
- `yolo`: execute without normal tool approval; external path access still requires explicit user approval
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

Terminal execution is delegated through `TerminalRuntimeAdapter`. The harness owns framed command
capture and the canonical result returned to the model. The adapter owns the runtime boundary and
must enforce `TerminalAccess` for conversation, owner, tool-call, and source (`agent`/`user`).
Desktop uses the Rust PTY registry through `DesktopTerminalRuntime`; the standalone CLI uses
`CliHost/node-pty` through `CliTerminalRuntime`. Both runtimes separate manual terminals from agent
terminals, reuse only the same owner/conversation/normalized `cwd`, expose resize, and retain an
inspectable terminal summary after exit until shutdown.

Terminal streams are replay-capable event hubs rather than one mutable listener. A subscriber is
registered before its snapshot is captured, concurrent PTY data is queued, snapshot sequences are
applied first, and queued events are drained only when newer. Sequence values are monotonic and exit
is emitted once. The bridge projects `terminal_updated` (`created`, `output`, `state`, `exit`) and
includes current terminals in every `runtime_ready`; the TUI consumes these by `terminalId` and
keeps raw output only for parsing, normalizing ANSI and framing before display. Live
`terminal_progress` events update tool activity but are not persisted as provider transcript blocks.

The TUI is an active, maintained client of this contract. `@hyscode/tui-runtime` remains the PTY
lifecycle and ownership authority. Its in-process `TerminalHandoff` API is an additive local
capability for the current conversation's manual user terminal only: it subscribes to raw PTY
bytes, writes raw keyboard data, forwards validated viewport sizes, and detaches without killing
the process. The TUI pauses its projected repaint and restores it on `Ctrl-]`, child exit, error,
or signal. Agent terminals never enter handoff and remain Harness-controlled projections. The
serialized `--protocol ndjson` loop remains non-interactive and does not transport raw stdin/stdout
or handoff bytes.

An `awaiting_input` terminal is a guarded interaction: the agent can use the approved
`respond_terminal_input` tool only for its owner and non-sensitive prompts. The TUI may write only
when no tool is actively controlling the terminal and the approval mode is not `yolo`; sensitive
input is masked and never added to transcript or model context. Chat, review, and plan policies deny
terminal tools, while build and debug policies retain them.

The fullscreen TUI embeds the bridge in-process. The packaged `vortex --protocol ndjson` launcher
and the compatibility runtime entrypoint reuse the same serialized request/event loop for
automation, including `initialize`, `send_message`, approvals, terminal events, cancellation, and
shutdown.

Workspace-relative paths are normalized and checked by segment containment. Absolute paths outside the workspace are classified before the handler runs and require explicit user approval in every approval mode. `allow once` applies only to the current tool call; `allow directory for this session` stores an operation-specific, non-persistent directory grant. Read grants never authorize writes or terminal execution. The terminal command text is not parsed for paths; only its `cwd` field participates in this gate. If no approval callback exists, external access fails closed.

| Error Type                 | Handling                                                        |
| -------------------------- | --------------------------------------------------------------- |
| LLM API error (rate limit) | Exponential backoff, retry up to 3x, then surface to user       |
| LLM API error (auth)       | Surface immediately, prompt to check API key in settings        |
| Tool execution error       | Return error message to agent, agent decides next action        |
| Tool timeout               | Kill execution, return timeout error to agent                   |
| Context overflow           | Truncate oldest messages, warn user via status bar              |
| Agent loop stuck           | Detect repeated identical tool calls (3x), break loop, ask user |

Provider connectivity is represented as structured harness events (`connection_state_changed`,
`retry_scheduled`, `retry_started`, and `turn_recoverable_error`). The desktop UI may automatically
retry only before semantic output. If a stream fails after output begins, the harness preserves text
and thinking, discards incomplete tool calls, and requires the user to continue or retry explicitly.
Cancellation propagates to the native Tauri request and aborts the active `reqwest` task.

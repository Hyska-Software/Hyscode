# Desktop Kanban and Agent Task Integration Plan

## Plan title

Build a project-persistent Desktop Kanban whose delegated task runs use the existing HysCode Harness and are projected consistently into chat, Editor, and VORTEX.

## Intent

Replace the absence of a persistent project-task domain with a local-first, revisioned Desktop task system. Keep turn-local `manage_tasks` behavior distinct, connect deliberate task delegation to the existing Harness lifecycle, and make task state observable from every Desktop surface that can create, focus, or execute agent work.

## Current behavior

- `packages/agent-harness/src/tools.ts` exposes `manage_tasks`, but it accepts a complete lightweight list and returns metadata to the Desktop bridge; it does not persist a project task.
- `apps/desktop/src/stores/agent-store.ts` stores `agentTasks` inside a conversation tab. `clearConversation` clears them, and session restoration does not restore them from SQLite.
- `apps/desktop/src/components/agent/agent-task-list.tsx` renders only that compact turn-local list.
- `apps/desktop/src-tauri/src/commands/db.rs` owns SQLite access and registers migrations 001-015; current SDD tables are a separate domain under `agent_sdd_*`.
- `apps/desktop/src/lib/harness-bridge.ts` owns the Desktop Harness, approvals, external tools, provider configuration, turn events, turn persistence, and VORTEX-isolated bridge creation.
- `apps/desktop/src/lib/vortex-session-runtime.ts` manages one isolated `HarnessBridge` and `AgentStoreApi` per `projectPath::conversationId`; only the focused runtime is projected into the shared agent store, while background runtimes continue independently.
- `apps/desktop/src/components/layouts/editor-layout.tsx` renders the Activity Bar/Sidebar in Editor mode. `agent-layout.tsx` renders VORTEX as project/session navigator, chat, and right-side surfaces; it does not render the Editor Activity Bar.
- `apps/desktop/src/stores/layout-store.ts` owns workspace mode and built-in sidebar/right-panel navigation, while `settings-store.ts` owns persisted sidebar order and visibility.
- `packages/ai-providers` already exposes the unified `AsyncIterable<StreamChunk>` provider contract through `ProviderRegistry`; the Harness selects the configured provider/model and emits correlated lifecycle events.
- The TUI is a separate host and is explicitly excluded from this goal. No TUI files are implementation targets.

## Implementation status

The feature branch now contains the Desktop vertical slice: optional Harness
Kanban tools, migration 016, typed Tauri commands and change events, the
project-scoped Zustand projection, current-chat and dedicated VORTEX task
execution, the Editor/sidebar board, the shared modal opened from the top bar,
the VORTEX navigator badge, and a linked agent-chat task card. The TUI remains
outside the feature boundary.

The TypeScript Harness and Desktop gates pass. Rust formatting and the full
Rust test suite also pass through the MSVC Developer Command Prompt. The live
Tauri/fake-provider integration run and packaged Desktop smoke path were not
executed in this implementation turn, so they remain final publication gates.

## Expected outcome

Desktop users have a project-scoped default board with persistent cards, seeded workflow columns, labels, priority, descriptions, activity, archive state, and task-run state. They can delegate work from the board or chat. Every delegated run has a durable `task_run_id` and links to the actual conversation/turn/runtime/provider/model. Board events arrive live in all Desktop projections, including background VORTEX runtimes, and reconcile safely across project switches and concurrent UI/agent writes. Custom board and column management remains a follow-up scope after this proven default-board slice.

## Target-perspective output

From the user perspective:

1. The Editor Activity Bar exposes a native Tasks view with a usable Kanban board.
2. The VORTEX workspace exposes the same project task domain through a task entry/surface and shows task-linked runtime badges in the project/session navigator.
3. The agent chat displays a compact linked-task card with the execution state, provider/model, progress summary, open-board/open-chat actions, cancel, and retry.
4. A task remains present after conversation changes and application restart.
5. A board update made by the user, agent tool, or background runtime is reflected without a manual reload.

## Truth owner

The Rust/Tauri task repository plus SQLite transaction is authoritative for persisted board state. The Harness is authoritative for turn/tool/provider execution outcomes. `TaskExecutionCoordinator` translates Harness outcomes into task-run transitions and activity records. Zustand stores are projections, never authorities.

## Contract boundary

### Desktop domain contract

The Desktop task service owns these domain concepts:

```text
Board             project-scoped board metadata and monotonic revision
Column            ordered workflow stage with optional system key and WIP limit
Task              card data, column/position, metadata, version, and links
TaskRun           one delegation attempt linked to conversation/turn/runtime
TaskActivity      append-only audit/activity record for user, agent, and system changes
ChangeEvent       project/board revision, mutation id, changed entity, and snapshot
```

`Task.columnId` and `TaskRun.executionState` are intentionally separate. A user can move a card while an agent is waiting for approval without erasing the execution state. Automatic workflow-column transitions are version guarded and never overwrite a newer manual move.

### Optional Harness contract

Add an additive `TaskIntegration`/`TaskContext` contract to `@hyscode/agent-harness`:

- `HarnessOptions.taskIntegration?: TaskIntegration`.
- `HarnessEnvironment.taskIntegration?: TaskIntegration`, inherited only by Desktop-created child Harnesses.
- `TurnRequest.taskContext?: AgentTaskContext`.
- `ToolExecutionContext.taskContext?: AgentTaskContext`.
- `HarnessEvent` optionally carries `taskId` and `taskRunId` alongside its existing turn/conversation identity.
- `createKanbanTools(integration)` returns handlers; `Harness` registers them only when an integration is supplied.

The TUI creates its Harness without `taskIntegration`, so it does not register, announce, render, or persist Kanban functionality. No TUI protocol or data-store change is part of this plan.

### Tool boundary

The Desktop-enabled tool set is explicit and namespaced:

- `kanban_list_tasks` and `kanban_get_task`: read-only, safe.
- `kanban_create_task`, `kanban_update_task`, `kanban_move_task`, `kanban_archive_task`, `kanban_delete_task`, and `kanban_add_comment`: persistent mutations using the existing approval policy; execution state is not agent-writable.
- `kanban_delegate_task`: deliberate delegation, always approval-gated and unavailable to nested agents unless an explicit future policy allows it.

`manage_tasks` remains the turn-local checklist tool. It is not adapted to write board rows and has no migration path into the Kanban schema.

## Displaced path

`AgentState.agentTasks`, `PerTabState.agentTasks`, and `AgentTaskList` remain valid for a turn-local checklist, but they are displaced as the authority for project tasks. No implementation may restore project persistence by extending those arrays or by placing board state in a VORTEX runtime record.

## Value density

The first high-value slice is a single default project board with persistent CRUD/move, one real delegated Harness run, revisioned live events, and linked chat/runtime projection. Custom board management, labels, activity browsing, filters, and polish follow the proven slice; they must not create a second execution or persistence path.

## Acceptance evidence

The feature is accepted only with schema tests, optional-Harness tests, Desktop projection tests, a fake-provider run that traverses the real Harness/ProviderRegistry path, and a packaged Desktop smoke flow covering restart, background VORTEX execution, approval, cancellation, retry, and project-switch isolation.

## Evidence lane

Use focused Rust/Harness/Desktop tests first, then package lint/typecheck and the integrated fake-provider lane. Before publication run `npm run lint`, `npm run typecheck`, focused tests, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `scripts/agent-preflight.ps1`. Do not run Prettier.

## Kill criteria

Stop before expanding the UI if frontend code writes task rows outside the typed service, a task calls providers outside the Harness, an event lacks project/revision/mutation identity, `manage_tasks` becomes persistent, background VORTEX tasks lose their runtime link, or a shared-contract change forces the TUI to expose Kanban.

## Non-goals

The TUI, remote sync, multi-user collaboration, cloud persistence, SDD replacement, provider-specific execution loops, and extension-contributed core-board implementations are out of scope.

## Risk if wrong

An incorrect authority boundary would create lost tasks, stale cross-project updates, duplicate agent execution, or a UI that reports success while the real Harness failed. The implementation must therefore prioritize transaction/revision tests and an end-to-end Desktop run before visual completeness.

## Architecture slice

### Persistence and Rust ownership

Add an append-only `016_kanban.sql` migration and a typed `commands/kanban.rs` module. The schema is project-scoped through the existing `projects.id = normalized project path` contract:

| Entity | Required fields and invariants |
| --- | --- |
| `kanban_boards` | `id`, `project_id`, name, default flag, monotonic `revision`, timestamps; one default board per project; cascade on project deletion |
| `kanban_columns` | `id`, `board_id`, name, optional `system_key`, color, integer order, optional WIP limit, archived flag; ordered transactionally |
| `kanban_tasks` | `id`, board/column FKs, title, description, priority, position, due date, creator, links, auto-transition policy, integer `version`, timestamps |
| `kanban_labels` / `kanban_task_labels` | board-scoped names/colors and many-to-many task labels with unique constraints |
| `kanban_task_runs` | task FK, optional conversation/turn/runtime links, provider/model/mode snapshot, execution state, prompt/summary/error, timestamps |
| `kanban_task_activity` | task/run FK, actor, event kind, JSON payload, mutation id, created timestamp; append-only history |

Seed the default board and five usable columns (`backlog`, `todo`, `in_progress`, `blocked`, `done`) in one transaction. A cancelled run is an execution state and activity event; a separate `cancelled` workflow column is optional and not required for the first slice.

Every write command validates ownership and legal transitions inside a transaction, increments task version and board revision, and emits one event only after commit. Task moves resequence source/target column positions atomically. Mutations accept an expected task version and/or board revision; conflicts return the authoritative current snapshot rather than silently applying last-write-wins.

### Tauri command and event boundary

Use typed commands rather than the existing SDD JSON-string shim:

- `db_kanban_get_snapshot(project_id, board_id?)` — board, columns, tasks, labels, active runs, and current revision.
- `db_kanban_create_board`, `db_kanban_update_board`.
- `db_kanban_create_column`, `db_kanban_update_column`, `db_kanban_reorder_columns`.
- `db_kanban_create_task`, `db_kanban_update_task`, `db_kanban_move_task`, `db_kanban_archive_task`, `db_kanban_delete_task`.
- `db_kanban_create_task_run`, `db_kanban_update_task_run`, `db_kanban_list_task_activity`.

Each mutation emits `kanban:changed` with at least:

```text
projectId, boardId, boardRevision, mutationId, entityKind, entityId,
task/column/run snapshot when applicable, actor, createdAt
```

The frontend subscribes once through a Desktop `KanbanService`, filters by active project and board, ignores revisions older than its last accepted revision, and refetches the snapshot on a gap or conflict.

### Desktop read model

Create a typed `KanbanService` around `tauriInvoke`/`tauriListen` and a project-scoped `useKanbanStore`. The store owns loading, empty, error, conflict, board selection, selected task, and live run projections, but never performs SQL or invents task status. `project-persistence.ts` initializes it after `db_ensure_project` and clears/unsubscribes it during the existing project lifecycle reset.

The store has a single event listener for the application. It filters by `projectId`, carries a lifecycle generation, and rejects late events from a previous project. UI mutations can optimistically reorder a card only when the expected version is known; a rejected command rolls back to the returned authoritative snapshot and presents a conflict action.

### Execution path

```text
User/agent delegates task
  -> KanbanService creates queued TaskRun
  -> TaskExecutionCoordinator chooses current chat or dedicated session
  -> existing HarnessBridge.sendMessage(task prompt, task context, pinned provider/model)
  -> existing Harness.run
  -> existing ToolRouter / approvals / MCP / skills / terminal / tracing
  -> existing ProviderRegistry stream
  -> correlated HarnessEvent lifecycle
  -> TaskExecutionCoordinator persists run/activity and guarded column transition
  -> Tauri change event -> KanbanStore + chat/VORTEX projections
```

The coordinator never imports a provider implementation. It uses the existing `HarnessBridge` and `VortexSessionRuntimeManager` APIs. A dedicated task run gets its own conversation/runtime so it can be queued, cancelled, retried, and observed in the VORTEX background list. A task delegated from the active chat may instead bind to that conversation when the user chooses “current chat”; the coordinator rejects unsafe concurrent turns and queues work rather than interleaving events.

At delegation time, capture provider ID, model ID, agent mode, task prompt, and task context. Extend `HarnessBridge.sendMessage` options to accept these per-run values instead of reading only global settings. A missing provider/model fails the run with an actionable error; it must not silently fall back to a different provider.

### Runtime state machine

```text
queued -> running -> waiting -> running -> completed
                         |                  |
                         v                  v
                      cancelled          failed
queued -> cancelled
failed -> queued (retry creates a new attempt)
```

`waiting` covers tool approval and user-question pauses. Provider retry/recoverable errors remain distinguishable in activity and the linked chat, while the task run transitions only when the user must act or the turn is terminal. Cancellation uses the existing bridge abort path. Retry creates a new `TaskRun` attempt while retaining the prior activity and error.

### UI ownership and surfaces

- **Canonical board:** `KanbanBoard` rendered by a new built-in Editor sidebar view `tasks`. It owns card rendering, drag/keyboard movement, filters, search, task details, delegation controls, and the standard right-click task action menu through the store/service. Archive remains recoverable; permanent deletion is confirmed and blocked for active runs.
- **VORTEX access:** `AgentLeftPanel` gets a Tasks entry and compact project summary; it opens the same `KanbanBoard` surface/modal rather than a second board implementation. `VortexProjectSessionNavigator` shows task-linked runtime badges and open-task actions for background sessions.
- **Agent chat:** `AgentTaskContextCard` renders the task/run linked to the current conversation, including live state, summary, provider/model, open board, open conversation, cancel, and retry. Existing `AgentTaskList` remains the turn-local checklist and is labeled/kept separate.
- **Layout state:** add only navigation/open-surface state to `layout-store` or a dedicated task UI store. Task data and run state remain in `useKanbanStore`; right-tab preferences are not a second task authority.
- **Accessibility:** native drag behavior is supplemented with keyboard move actions, focus-visible states, announced column/card changes, and explicit conflict/error feedback. Loading, empty, error, waiting-approval, cancelled, failed, and stale-session states are designed before polish.

## Cutover

1. On project open, ensure the project and default board/columns exist before rendering the board.
2. Keep existing `agentTasks` exactly as a turn-local projection; do not attempt to infer persistent tasks from it.
3. Register Desktop Kanban tools only when the optional integration is present. Existing TUI Harness construction remains unchanged.
4. For existing conversations, the chat task list remains available but no historical board rows are invented. New project tasks are created explicitly by the user or `kanban_create_task`.
5. For deleted conversations, task rows survive because project tasks are authoritative; task-run conversation links become nullable and the activity records retain the historical run outcome.
6. On project switch, the existing lifecycle generation clears the Kanban store and task listeners before accepting the new project snapshot. Queued runs persist; active runs follow an explicit cancel/retain policy and never continue against a new project context.

## Detailed implementation plan

### KANBAN-01 — Freeze contracts and optional Harness integration

**Scope:** define task domain types, task context, optional integration interface, task tool factory, event correlation, and approval/risk semantics.

**Files to create or modify:**

- Create `packages/agent-harness/src/task-integration.ts`.
- Modify `packages/agent-harness/src/types.ts`.
- Modify `packages/agent-harness/src/environment.ts`.
- Modify `packages/agent-harness/src/harness.ts`.
- Modify `packages/agent-harness/src/index.ts`.
- Create `packages/agent-harness/src/task-integration.test.ts`.
- Create `packages/agent-harness/src/task-tools.test.ts`.

**Required output:** additive `TaskIntegration`, `AgentTaskContext`, `TaskRunState`, typed tool definitions, optional Harness registration, and event enrichment. No TUI call site changes.

**Verification:** `npm run typecheck --workspace @hyscode/agent-harness`; `npm run test --workspace @hyscode/agent-harness`.

**Acceptance evidence:** a Harness created without integration has exactly its existing task-tool surface; a Harness with integration exposes only the `kanban_*` tools; an aborted task context reaches the handler and event IDs remain correlated.

**Parallelism:** independent from Rust schema work after the domain state names are agreed; integrate before Desktop adapter work.

### KANBAN-02 — Add SQLite schema, migration, seed, and Rust repository

**Scope:** implement persistent tables, constraints, seed logic, transaction helpers, version checks, positions, activity, and typed row serialization.

**Files to create or modify:**

- Create `apps/desktop/src-tauri/migrations/016_kanban.sql`.
- Create `apps/desktop/src-tauri/src/commands/kanban.rs`.
- Modify `apps/desktop/src-tauri/src/commands/mod.rs`.
- Modify `apps/desktop/src-tauri/src/commands/db.rs` to apply migration 016 after migration 015.
- Modify `apps/desktop/src-tauri/src/lib.rs` to register the commands.
- Create Rust tests in `apps/desktop/src-tauri/src/commands/kanban.rs` or its test module.

**Required output:** typed snapshot/mutation results, default-board seed, atomic move/resequence, guarded updates, run transition validation, and post-commit `kanban:changed` emission.

**Verification:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.

**Acceptance evidence:** a temporary SQLite database can create a project, seed a board, move a task, reject a stale version, persist an activity record, and restore the exact snapshot after reopening.

**Parallelism:** can proceed in parallel with KANBAN-01, but command payloads must be reconciled before frontend typing.

### KANBAN-03 — Build typed Desktop service and project lifecycle store

**Scope:** connect typed IPC commands/events to a single project-scoped frontend projection with refresh, conflict, event-gap, and lifecycle handling.

**Files to create or modify:**

- Create `apps/desktop/src/lib/kanban-service.ts`.
- Create `apps/desktop/src/stores/kanban-store.ts`.
- Modify `apps/desktop/src/lib/tauri-invoke.ts` with command argument/return contracts.
- Modify `apps/desktop/src/lib/project-persistence.ts` to initialize, clear, and generation-guard Kanban state.
- Create `apps/desktop/src/lib/kanban-service.test.ts`.
- Create `apps/desktop/src/stores/kanban-store.test.ts`.

**Required output:** one authoritative read/write adapter, project filtering, revision reconciliation, snapshot refetch on gaps/conflicts, and explicit loading/empty/error states.

**Verification:** `npm run test --workspace @hyscode/desktop -- src/lib/kanban-service.test.ts src/stores/kanban-store.test.ts`; `npm run typecheck --workspace @hyscode/desktop`.

**Acceptance evidence:** a late event from project A cannot alter an active project B; a conflict restores the server snapshot; a project open/close cycle leaves no listener or task data behind.

**Dependencies:** KANBAN-02.

### KANBAN-04 — Adapt the HarnessBridge and runtime manager for task runs

**Scope:** make provider/model/task context per-run, expose correlated task lifecycle hooks, persist task-run outcomes, and use existing VORTEX runtime isolation for background execution.

**Files to create or modify:**

- Create `apps/desktop/src/lib/task-execution-coordinator.ts`.
- Create `apps/desktop/src/lib/kanban-harness-adapter.ts`.
- Modify `apps/desktop/src/lib/harness-bridge.ts` for optional task integration, task context, per-run provider/model, event forwarding, cancellation, and finalization.
- Modify `apps/desktop/src/lib/vortex-session-runtime.ts` for task-runtime creation, background send, task linkage, and focused-session opening.
- Modify `apps/desktop/src/lib/vortex-runtime-types.ts` with optional task/run projection fields.
- Modify `apps/desktop/src/lib/active-agent-bridge.ts` for task-aware active-chat delegation.
- Create focused tests beside the coordinator, bridge, and VORTEX runtime.

**Required output:** `TaskExecutionCoordinator` creates a durable queued run, selects current-chat or dedicated-session execution, passes a task envelope to the Harness, maps events to run states, uses existing abort/retry behavior, and writes a final summary/activity record. It must queue or reject concurrent turns deterministically.

**Provider contract:** the coordinator captures provider/model and passes them through `HarnessBridge.sendMessage`; `ProviderRegistry` remains the only provider dispatch path. No file in this task imports a concrete provider implementation.

**Verification:** `npm run test --workspace @hyscode/desktop -- src/lib/task-execution-coordinator.test.ts src/lib/vortex-session-runtime.test.ts`; `npm run typecheck --workspace @hyscode/desktop`.

**Acceptance evidence:** a fake provider produces a real Harness turn whose `turn_start`, approval wait, tool result, and `turn_end` events update the matching task run, even when the runtime is not focused. Cancellation and retry produce the correct attempt/activity history.

**Dependencies:** KANBAN-01, KANBAN-02, KANBAN-03.

### KANBAN-05 — Implement the canonical Kanban UI

**Scope:** deliver a usable board and task details without adding a second task truth path.

**Files to create or modify:**

- Create `apps/desktop/src/components/tasks/kanban-board.tsx`.
- Create `apps/desktop/src/components/tasks/kanban-column.tsx`.
- Create `apps/desktop/src/components/tasks/kanban-task-card.tsx`.
- Create `apps/desktop/src/components/tasks/task-detail-panel.tsx`.
- Create `apps/desktop/src/components/tasks/task-run-badge.tsx`.
- Create `apps/desktop/src/components/tasks/task-delegation-dialog.tsx`.
- Create `apps/desktop/src/components/sidebar/views/tasks-view.tsx`.
- Modify `apps/desktop/src/components/sidebar/sidebar-content.tsx`.
- Modify `apps/desktop/src/components/sidebar/sidebar.tsx` and `apps/desktop/src/components/sidebar/activity-bar.tsx`.
- Modify `apps/desktop/src/lib/activity-bar-model.ts`.
- Modify `apps/desktop/src/stores/layout-store.ts` and `apps/desktop/src/stores/settings-store-defaults.ts` for the built-in `tasks` view and navigation state.
- Modify `apps/desktop/src/components/titlebar/view-menu.tsx` if required by the built-in view menu contract.
- Create component tests for board states, card actions, keyboard movement, and conflict recovery.

**Required output:** project board CRUD, drag-and-drop plus keyboard movement, filtering/search, selected-task detail, labels/priority/due date, activity/run status, delegate/cancel/retry/open-chat actions, and accessible loading/empty/error/conflict states.

**Verification:** `npm run test --workspace @hyscode/desktop -- src/components/tasks`; `npm run lint --workspace @hyscode/desktop`; `npm run typecheck --workspace @hyscode/desktop`.

**Acceptance evidence:** the Editor Tasks view can create and move a card, render an active run badge, and recover from a rejected stale mutation without inventing local data.

**Dependencies:** KANBAN-03 and KANBAN-04.

### KANBAN-06 — Integrate VORTEX, chat, and project/session lifecycle

**Scope:** project the same task/run state into VORTEX and the agent chat while preserving isolated runtime ownership.

**Files to create or modify:**

- Create `apps/desktop/src/components/tasks/task-board-surface.tsx` for the shared board surface opened from VORTEX.
- Create `apps/desktop/src/components/agent/agent-task-context-card.tsx`.
- Modify `apps/desktop/src/components/agent/agent-panel.tsx` to render the linked task card separately from `AgentTaskList`.
- Modify `apps/desktop/src/components/layouts/agent-left-panel.tsx` to expose Tasks and open the shared board surface.
- Modify `apps/desktop/src/components/agent/vortex-project-session-navigator.tsx` to render task-linked runtime badges/actions.
- Modify `apps/desktop/src/components/layouts/agent-layout.tsx` only if a stable VORTEX board surface mount point is required.
- Add/extend tests for focused and background runtimes, project filtering, open-chat actions, and task cards.

**Required output:** a task delegated in background remains visible in VORTEX without focus; selecting Open chat focuses the linked conversation; switching to Editor does not lose board/run state; the chat card never reads a different conversation's task.

**Verification:** `npm run test --workspace @hyscode/desktop -- src/components/agent/vortex-project-session-navigator.test.tsx src/lib/vortex-session-runtime.test.ts`; `npm run typecheck --workspace @hyscode/desktop`.

**Acceptance evidence:** two VORTEX runtimes can be listed while one task is running in the background, and the task card, navigator badge, and board all show the same run ID/state.

**Dependencies:** KANBAN-04 and KANBAN-05.

### KANBAN-07 — Harden security, approval, observability, and failure paths

**Scope:** validate ownership, path boundaries, approval semantics, run cancellation, provider failure, event gaps, reload, and task deletion/archive policy.

**Files to modify:**

- `packages/agent-harness/src/task-integration.ts` and task-tool tests for input validation/risk.
- `apps/desktop/src/lib/kanban-harness-adapter.ts` and coordinator tests for abort/approval/child-agent behavior.
- `apps/desktop/src-tauri/src/commands/kanban.rs` for ownership/constraint/error mapping.
- `apps/desktop/src/components/tasks/*` for explicit error/retry/conflict states.
- Existing security/approval documentation and focused architecture docs.

**Required output:** no cross-project task access, no hidden provider fallback, no task tool escalation from nested agents, deterministic behavior when a conversation/provider disappears, and bounded activity/output payloads.

**Verification:** focused Rust/Harness/Desktop tests, `npm run lint`, `npm run typecheck`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.

**Acceptance evidence:** negative tests demonstrate that invalid project/task IDs, stale versions, denied approvals, cancellation, provider errors, and late events produce safe visible states.

**Dependencies:** KANBAN-01 through KANBAN-06.

### KANBAN-08 — Synchronize architecture documentation and perform integrated proof

**Scope:** document the new authority boundaries and prove the feature through a real Desktop path.

**Files to create or modify:**

- Create `docs/architecture/KANBAN.md` as the canonical task-domain and lifecycle document.
- Modify `docs/architecture/AGENT_HARNESS.md` with optional Desktop task integration and event correlation.
- Modify `docs/architecture/OVERVIEW.md` with the Desktop Kanban integration boundary, without adding TUI scope.
- Modify `docs/architecture/DATABASE.md` to describe the actual rusqlite/embedded-migration implementation and the new Kanban schema.
- Modify `docs/specs/UI_UX_SPEC.md` with board surfaces/accessibility and VORTEX/chat projection expectations.
- Do not modify `tools/hyscode-tui`, `packages/tui-runtime`, or TUI-specific docs for this feature.

**Required output:** docs agree with the code, name the source of truth, show the read/write path, state the displaced `manage_tasks` behavior, and record Desktop-only scope.

**Verification:** `git diff --check`; documentation link/path review; `npm run lint`; `npm run typecheck`; focused tests; `scripts/agent-preflight.ps1` before publication.

**Acceptance evidence:** a reviewer can follow the docs from board click to SQLite event to Harness turn to provider stream and back to every Desktop projection, with no undocumented alternate path.

**Dependencies:** KANBAN-07.

## Parallel work map

| Track | Tasks | Write scope | Integration gate |
| --- | --- | --- | --- |
| Contracts | KANBAN-01 | `packages/agent-harness` | optional registration and event tests |
| Persistence | KANBAN-02 | Tauri migration/commands | Rust repository and migration tests |
| Projection | KANBAN-03 | Desktop service/store/lifecycle | event/revision tests |
| Runtime | KANBAN-04 | bridge/coordinator/VORTEX | fake-provider end-to-end test |
| UI | KANBAN-05/06 | tasks components/layout projections | focused component and background-runtime tests |
| Hardening/docs | KANBAN-07/08 | security/docs/gates | packaged Desktop smoke path |

Tracks Contracts and Persistence can start in parallel. Projection waits for command payloads. Runtime waits for the optional Harness contract and service. UI waits for the store and coordinator interfaces. Only the integration gates may combine these tracks; no parallel task may write the same source file.

## Test and evidence matrix

| Risk | Proof | Minimum evidence |
| --- | --- | --- |
| Schema/migration drift | Rust tests on temporary DB | seed, constraints, reopen, version conflict |
| Duplicate truth | Harness/bridge tests | `manage_tasks` remains local; `kanban_*` uses service |
| Provider bypass | fake-provider integration | call path includes Harness and ProviderRegistry |
| Background VORTEX leakage | runtime/store tests | two runtimes, one project filter, late-event rejection |
| Approval/cancellation | Harness/Desktop tests | pending approval, deny, abort, retry and final run state |
| UI race/conflict | component/store tests | optimistic move rollback and snapshot refetch |
| Cross-platform packaging | Desktop smoke | Windows plus available macOS/Linux build artifacts and runtime launch |
| TUI scope regression | build/typecheck without TUI edits | TUI remains unchanged and no task capability is advertised |

## Rollout gate

The implementation is ready for a PR only when the default board vertical slice, background task linkage, provider pinning, live revisioned events, Editor/VORTEX/chat projections, and negative-path tests all pass. A passing unit suite without a real task run through the Harness is insufficient. Do not commit, push, or open a PR until the user explicitly authorizes it; when authorized, follow `docs/WORKFLOW.md` and the repository `AGENTS.md` issue/branch/commit rules.

## Plan Review Gate: Requires PRE review before execution

PRE review checklist for this plan:

- Expected outcome and target-perspective proof are explicit.
- Rust/Tauri task persistence is the source of truth; Zustand, VORTEX, and Harness roles are bounded.
- The optional shared contract prevents TUI activation and keeps the displaced `manage_tasks` path explicit.
- The read/write path, event identity, revision policy, provider path, cutover, and kill criteria are named.
- Tasks have exact files, output, verification, dependencies, and disjoint parallel scopes.
- Acceptance is evidence-based and includes a real Desktop task run, not only tests or a diff.

The implementation gate is closed until this PRE review has no blocker or major finding, or the user explicitly accepts the finding and its correction.

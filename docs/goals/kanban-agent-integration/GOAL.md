# Goal: Desktop Kanban and Agent Task Integration

## Goal package

- Issue: [#48](https://github.com/Hyska-Software/Hyscode/issues/48)
- Planned branch: `feat/48-agent-harness-kanban`
- Scope: Desktop only (`apps/desktop`, Tauri/Rust, shared optional Harness contracts)
- Status: Desktop implementation complete on the feature branch; live Tauri/packaged proof remains outstanding

## Intent

Create a project-scoped Kanban system that persists tasks in the Desktop SQLite database and connects each delegated task to a real HysCode agent execution. A user must be able to create and organize work, delegate a task to the configured agent, and observe the task lifecycle in the board, the agent chat, the Editor layout, and the VORTEX layout.

## Expected outcome

The Desktop has one canonical task domain and one execution path:

```text
Kanban UI / Desktop task tools
            |
            v
Tauri task service + SQLite + revisioned change events
            |
            v
TaskExecutionCoordinator
            |
            v
Existing HarnessBridge / VortexSessionRuntimeManager
            |
            v
Existing Harness -> ToolRouter -> ProviderRegistry -> configured provider
```

The TUI is not a host for this feature. It receives no Kanban UI, command, persistence, protocol, or renderer work. Shared Harness contracts, if needed, remain optional so the existing TUI construction does not register or expose task tools.

## Target-perspective proof

The user opens a Desktop project and sees a persistent Tasks/Kanban view with real columns and cards. They create or move a task, restart the app, and see the same state. They choose Delegate, select the current chat or a dedicated agent session, and see the card move through queued/running/waiting/completed or failed execution states while the agent chat and VORTEX session show the same linked task. Cancelling or retrying from either the task card or the linked agent surface updates the board without a refresh.

The maintainer can inspect the SQLite migration, Tauri commands, Harness event correlation, and focused tests to verify that no provider bypass, duplicate task truth, stale-project event leak, or TUI integration was introduced. A live fake-provider run and packaged Desktop smoke evidence remain required before publication.

## Truth owner

The Desktop Rust/Tauri task repository and SQLite transaction boundary own task, board, column, run, activity, and revision truth. Zustand is a project-scoped read model and interaction cache. The Harness owns turn/tool/provider truth. The VORTEX runtime store owns live session projection truth. No layer may silently promote its cache to the domain source of truth.

## Contract boundary

The shared `@hyscode/agent-harness` package provides only additive, optional task integration contracts and tool definitions. Desktop supplies the task service and registers the tools; the TUI supplies neither and does not advertise the capability. Providers remain behind the existing `ProviderRegistry` and are never called by the Kanban service.

## Cutover

`manage_tasks` remains a turn-local, ephemeral planning list and is explicitly not migrated into the project board. The new `kanban_*` tools and Desktop TaskExecutionCoordinator become the only path for project tasks and delegated task runs. Existing `AgentTaskList` remains a compact turn-plan projection until a later, separately scoped cleanup removes it.

## Displaced path

The current `AgentState.agentTasks` / `PerTabState.agentTasks` path is displaced as the project-task authority. It is not deleted in this feature because it serves a different turn-local use case. Any implementation that stores project tasks only in that path, localStorage, or a VORTEX runtime record is incomplete.

## Value density

This feature is high-value but large. The highest-value vertical slice is: one default project board, persistent CRUD/move, one delegated task run through the existing Harness, revisioned live events, and a linked chat/task card. Custom boards, labels, history, filters, and polished cross-layout surfaces follow only after that slice is proven.

## Acceptance evidence

Acceptance requires all of the following evidence lanes:

1. Rust migration and repository tests prove schema constraints, default-board seeding, atomic moves, task-run transitions, activity records, and optimistic-conflict rejection.
2. Harness tests prove optional task-tool registration, task-context propagation, approval behavior, abort behavior, and event correlation without changing a Harness created without task integration.
3. Desktop tests prove project lifecycle isolation, event reconciliation, VORTEX background-runtime linkage, and UI states for loading, empty, error, conflict, waiting, retry, and cancellation.
4. A fake-provider integrated run proves `TaskExecutionCoordinator -> HarnessBridge -> Harness -> ProviderRegistry -> fake provider`, with persisted final status and transcript linkage.
5. A live Tauri/packaged Desktop smoke run proves restart persistence, drag-and-drop/keyboard movement, approval interaction, background VORTEX execution, cancellation, retry, and no stale event leakage after project switch.

## Evidence lane

Run focused package and Rust tests first, then Desktop typecheck/lint and the integrated fake-provider lane. Before publication, run the repository-required `npm run lint`, `npm run typecheck`, focused tests, Rust tests, and `scripts/agent-preflight.ps1`. Do not run Prettier. The implementation branch must remain uncommitted until the user explicitly requests commit or publication.

## Kill criteria

Stop and redesign before expanding the UI if any of these become true:

- A React component or Zustand action writes task rows without going through the typed task service and Tauri transaction boundary.
- A delegated task calls an AI provider directly or creates a provider-specific execution loop outside the existing Harness.
- `manage_tasks` begins carrying project IDs, task-run IDs, or persistent board state, creating two authorities.
- A Tauri change event lacks project ID, board revision, and mutation identity, making stale/background reconciliation ambiguous.
- VORTEX cannot keep a background task linked to its conversation/runtime without focusing that runtime.
- A shared-contract change forces the TUI to expose or persist Kanban data; the contract must remain optional instead.
- Auto-advance overwrites a user drag or manual column change without a version-guarded policy.

## Non-goals

- Any Kanban feature in the TUI.
- Remote synchronization, multi-user collaboration, cloud persistence, or server APIs.
- Replacing SDD sessions/tasks or changing their lifecycle.
- A second provider, MCP, or tool execution stack.
- An extension-contributed implementation of the core board.

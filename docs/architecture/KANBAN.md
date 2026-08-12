# Desktop Kanban Architecture

## Scope

Kanban is a Desktop-only project work domain. The board is available in the
Editor sidebar, from the VORTEX workspace, and from the top bar button placed
next to the File and View context menus. The fullscreen TUI does not render,
persist, advertise, or execute Kanban tasks.

## Authority boundary

```text
React board / agent kanban tools
          |
          v
Typed KanbanService -> Tauri commands -> SQLite migration 016
          |
          +--> kanban:changed (project + board revision + mutation id)
          |
          v
TaskExecutionCoordinator
          |
          +--> current HarnessBridge
          |
          +--> isolated VortexSessionRuntimeManager runtime
                         |
                         v
                 Harness -> ToolRouter -> ProviderRegistry
```

SQLite and the Rust command transaction own persistent board, task, run, and
activity truth. `useKanbanStore` is a project-scoped read model. Harness
turns, providers, approvals, MCP, skills, terminal access, and tracing remain
owned by the existing Harness path. VORTEX runtime records only project the
live conversation and optional task linkage.

`manage_tasks` remains the ephemeral, turn-local checklist. It is not migrated
to the board and is not used as a persistence adapter.

## Data model

Migration `016_kanban.sql` adds:

- `kanban_boards` with one default project board and monotonic revision;
- `kanban_columns` with the five seeded workflow columns;
- `kanban_tasks` with optimistic `version`, position, priority, labels, due
  date, auto-transition policy, and recoverable archive metadata;
- `kanban_labels` and `kanban_task_labels`;
- `kanban_task_runs` with execution mode, provider/model snapshot,
  conversation/turn links, instructions, state, summary, and error. The
  latest terminal run remains available on the task projection after it is no
  longer active;
- `kanban_task_activity` as append-only mutation/run/comment history.

Task mutations validate the project boundary and expected task version inside
the Rust transaction. Successful writes increment the board revision and emit
`kanban:changed` only after commit. Event delivery is best-effort after the
transaction; a listener failure cannot turn a committed write into a false
mutation failure.

The Desktop board exposes the task action menu on right click. It can open the
editor, move a task between seeded columns, delegate or stop an agent run,
archive a task, and permanently delete a task. Archive is a recoverable soft
state; permanent deletion is a version-checked transaction that rejects active
runs, removes the task-owned runs, label links, and activity through foreign-key
cascades, resequences the source column, and emits a `task_deleted` change
event with the pre-delete snapshot. The destructive action is confirmed in the
standard Desktop dialog. The `kanban_delete_task` Harness tool uses the same
backend rule and remains approval-gated.

## Task execution

Delegation first creates a durable `queued` run. The coordinator then chooses
the current conversation or an isolated VORTEX conversation. It pins the
provider/model captured at delegation, passes `AgentTaskContext` through the
Harness, and never imports a concrete provider. Missing provider/model
configuration fails the run with an actionable error.

The run state is:

```text
queued -> running -> waiting -> running -> completed
   |          |                    |
   +--------> cancelled         failed
```

Approval and user-question pauses map to `waiting`. Completion, failure, and
cancellation are persisted with activity and live change events. Automatic
workflow movement is guarded by the task's persisted policy and versioned
transaction boundary.

## Desktop projections

- The `Tasks` sidebar view and the full `Project Kanban` surface use the same
  `KanbanBoard` component and `useKanbanStore` state.
- The top bar `Kanban` button is next to `ViewMenu`; its state is transient
  layout state and its task data is never stored in layout preferences.
- The VORTEX navigator marks background sessions linked to a task.
- The agent chat renders `AgentTaskContextCard` for the current conversation,
  with live state, provider/model, board navigation, and cancellation.
- Project switching clears the read model and increments its lifecycle
  generation; events for a different project are ignored and revision gaps
  trigger a snapshot refresh.

## Verification

TypeScript checks cover optional Harness registration and Desktop contracts.
The Rust migration/command suite passes through the MSVC Developer Command
Prompt. A live Tauri fake-provider run and packaged Desktop smoke run remain
the final unproven evidence lanes. No commit, push, or PR is part of
implementation until explicitly requested by the user.

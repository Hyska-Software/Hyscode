# HysCode — System Architecture Overview

## Vision

HysCode is a **desktop-native agentic IDE** built on Tauri v2 where AI agents write, edit, and execute code using real developer tools. It follows the **Spec-Driven Development (SDD)** methodology orchestrated by the **Harness** engine.

---

## System Layers

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                            │
│  File Tree │ Monaco Editor │ Agent Panel │ Terminal │ Settings   │
│  React 19 + shadcn/ui + Tailwind v4 + Zustand                   │
├──────────────────────────────────────────────────────────────────┤
│                     TAURI IPC BOUNDARY                           │
│  invoke() / emit() / listen() — typed commands                   │
├──────────────────────────────────────────────────────────────────┤
│                      TAURI RUST SHELL                            │
│  FS Commands │ PTY Manager │ Git Ops │ SQLite │ Process Sandbox  │
│  tauri-plugin-fs │ tauri-plugin-shell │ tauri-plugin-sql         │
├──────────────────────────────────────────────────────────────────┤
│                     AGENT HARNESS (TS)                           │
│  Agent Loop │ Context Manager │ Tool Router │ Plan Manager       │
│  SDD Engine │ Skill Loader │ Approval Workflow                   │
├──────────────────────────────────────────────────────────────────┤
│                    AI PROVIDER LAYER (TS)                        │
│  Anthropic │ OpenAI │ Gemini │ Ollama │ OpenRouter               │
│  Unified streaming protocol │ Token counting │ Retry logic       │
├──────────────────────────────────────────────────────────────────┤
│                     MCP CLIENT (TS)                              │
│  @modelcontextprotocol/sdk │ stdio/SSE/WS transports            │
│  Dynamic tool resolution │ Capability gating                     │
└──────────────────────────────────────────────────────────────────┘
```

## Desktop diagnostics contract

The desktop agent's `get_diagnostics` tool is backed by the registered Tauri
command `get_diagnostics`. The command receives the validated workspace path and
an optional file path, then returns typed records with `file`, `line`, `col`,
`severity`, `message`, and `source`.

Monaco/LSP markers are authoritative for every open model, including unsaved
content. The desktop bridge uses Cargo and TypeScript compiler output for closed
files and global queries, and Python syntax compilation for a requested Python
file. Global results combine Rust and TypeScript providers; compiler results for
open models are discarded so stale disk output cannot override the buffer.
Provider startup, configuration, timeout, and process failures are returned as
errors instead of being represented as an empty diagnostic list. Python checks
compile source bytes in memory and therefore do not create `__pycache__`.

The tracker is initialized after the Monaco instance mounts, aggregates markers
from every owner, keeps per-file details and open-model state, decodes file URIs
(including spaces and UNC paths), and removes model state on disposal. Compiler
records are normalized, filtered case-insensitively on Windows, deduplicated,
and sorted before reaching the agent.

## Standalone TypeScript TUI Client

The repository ships a standalone TypeScript client in `tools/hyscode-tui`.
The client owns terminal rendering, keyboard input, structured transcript
projection, session/project/tab commands, context attachments, persistent
terminal interaction, cancellation, resize, recovery, and approval/question
prompts.
The interactive shell uses a fullscreen, keyboard-first layout: a contextual
header and adaptive session sidebar frame the transcript, while the composer
and action panels stay anchored at the bottom. Typing `/` opens a filtered
command palette in place; `Tab` completes the selected command and `Enter`
executes it. `Ctrl-K` opens the same palette without discarding a normal draft.
It instantiates `TuiBridge` in-process instead of launching a second NDJSON
bridge process. This keeps the CLI on the same
`@hyscode/agent-harness`, `@hyscode/ai-providers`, `@hyscode/mcp-client`, built-in
skills, rules, agent modes, sub-agent flow, SDD services, and provider streaming
protocol as HysCode Desktop. Additive protocol capability version 2 exposes
structured tool cards, terminal progress, file-review state, gathered context,
SDD phases/tasks, scoped child-agent events, usage telemetry, and connection
recovery while retaining protocol version 1 for older NDJSON clients.

When a workspace is ready, the empty transcript becomes a welcome surface with
the CLI wordmark, workspace/runtime details, keyboard-first tips, and recent
sessions from the same TUI data store. `tools/hyscode-tui/src/logo.ts` provides
the half-block rasterization of `apps/desktop/public/hyscode-logo.svg` and a
compact fallback for narrow terminals. The logo glyphs use the active theme
accent at render time, so `/theme` repaints the mark together with the rest of
the shell.

`@hyscode/tui-runtime` owns the TypeScript host adapter and creates native PTYs
through `node-pty`. PTY output is sequenced and bounded, supports snapshot/replay
from a sequence, resize, interrupt, kill, exit events, and shutdown. The same
host also exposes filesystem, Git, Docker, web, keychain, memory, SDD, and
diagnostic commands to the harness. There is no Rust UI, Rust agent runtime, or
production host round trip in the TUI path.

Desktop settings are mirrored from the existing Zustand/local-storage store to
the platform shared settings file (`%LOCALAPPDATA%/hyscode/settings.json` on
Windows). The CLI reads and writes that contract and uses the same file-backed
`hyscode:<account>` keychain convention. CLI conversations, memories, SDD rows,
and traces use an isolated JSON data store so a terminal session cannot mutate
the desktop SQLite database unexpectedly. The bridge protocol is explicit about
streaming events, interaction requests, cancellation, host requests, and
structured errors, leaving room for a future shared SQLite adapter without
changing the TUI presentation layer.

Color themes use the shared `@hyscode/theme` catalog. The seven built-in themes
are available in the desktop and TUI, and `/theme` opens the same keyboard-first
selector pattern as the other runtime commands. The runtime returns the active
theme and catalog in `runtime_ready`, accepts `themeId` through `set_config`,
repaints the terminal with the selected palette, and persists the choice in the
shared settings file. Enabled extension themes are read from the same installed
extension manifests and JSON theme assets used by the desktop
(`~/.hyscode/extensions`, filtered by `~/.hyscode/extension-state.json`), so an
extension theme can be selected from either client.

The additive `recentSessions` field in `runtime_ready` carries a bounded list
for the startup surface; the full `/sessions` command remains the source for
the interactive session browser.

The same payload carries a `GitSummary` snapshot for the top chat bar. It shows
the active branch and aggregate `+insertions - deletions` for uncommitted
tracked changes; the TUI refreshes it periodically through `git_summary` without
running Git during each render.

The TUI-only `sidebarVisible` preference is persisted in the same settings file
and can be changed with `/sidebar`, `/sidebar on`, `/sidebar off`, or
`/sidebar toggle`. Desktop synchronization preserves this field without exposing
it as a desktop layout setting.

The runtime still exports a small NDJSON compatibility entrypoint for external
protocol clients and tests. The packaged TUI does not launch it; direct in-process
construction is the only production client path.

### Build and launch

From the repository root on Windows:

```powershell
npm run build:tui
tools/hyscode-tui/dist/hyscode-tui.exe .
```

`build:tui` creates one self-contained `hyscode-tui.exe`. The packaged launcher
therefore does not require Bun at runtime. For source development, run
`npm run -w @hyscode/tui-client build` or execute the TypeScript entrypoint with
Bun. Use `HYSCODE_REPO_ROOT` when launching the executable from another
directory so the Codex sidecar can be discovered.

The launcher accepts `--provider`, `--model`, `--mode`, `--config`, and
`--workspace`. Inside the TUI, the supported commands are:

`/help`, `/mode`, `/thinking`, `/theme`, `/sidebar`, `/approval`, `/model`, `/models`, `/projects`,
`/project`, `/new`, `/sessions`, `/load`, `/tab`, `/rename`, `/export`,
`/attach`, `/context`, `/rules`, `/skills`, `/memory`, `/terminal`, `/diffs`,
`/sdd`, `/subagents`, `/usage`, `/diagnostics`, `/retry`, `/continue`,
`/cancel`, `/clear`, and `/quit` (with aliases such as `/resume`, `/diag`,
`/q`, and `/exit`). The palette groups commands by session, context,
workspace, model, and runtime scope and also exposes command usage inline.

OpenCode-style composer shortcuts are supported for the terminal workflow:
`@path message` attaches a file/directory and sends the remaining message,
`!command` writes to a persistent PTY, `/attach image:path` sends a supported
image on the next model request, `Shift+Enter` inserts a multiline break, and
bracketed paste preserves newlines. `/diffs` shows bounded textual diffs and
accept/reject actions for file changes emitted by the shared harness.

`Ctrl-C` cancels an active turn and quits when the input is empty; `Shift-Tab`
cycles agent modes; `Ctrl-T` cycles supported thinking levels; `Tab` changes
focus outside the command palette; `Esc` closes a palette or clears the draft;
`F1` opens help. Approval prompts support `y` (allow), `n` (deny), `t`
(allow and trust the tool), and `a` (approve and switch to session yolo mode).
Question prompts support multiple questions, option selection, free-form text,
and multiline answers.

### Configuration and credentials

The default Windows files are:

| Purpose | Default path | Override |
|---|---|---|
| Shared desktop/TUI settings | `%LOCALAPPDATA%\\hyscode\\settings.json` | `HYSCODE_CONFIG_PATH` or `--config` |
| Shared file-backed credentials | `%LOCALAPPDATA%\\hyscode\\keychain.json` | `HYSCODE_KEYCHAIN_PATH` |
| Installed extension themes | `%USERPROFILE%\\.hyscode\\extensions` and `extension-state.json` | `HYSCODE_EXTENSIONS_PATH`, `HYSCODE_EXTENSION_STATE_PATH` |
| TUI sessions, memory, SDD, traces | `%LOCALAPPDATA%\\hyscode\\tui-data.json` | `HYSCODE_TUI_DATA_PATH` |
| TUI executable | `tools/hyscode-tui/dist/hyscode-tui.exe` | `HYSCODE_REPO_ROOT` |
| Codex provider sidecar | packaged sibling or repository binary | `HYSCODE_CODEX_SIDECAR` |
| Repository discovery | current directory | `HYSCODE_REPO_ROOT` |

The desktop sync is one-way while the desktop is running: desktop settings,
including `themeId`, are written to the shared JSON file whenever the settings
store changes. If both clients are open, launch the TUI after the desired desktop
settings are saved, or pass an explicit `--config` file for an isolated profile.
Provider API keys
are resolved from environment variables first and then the shared keychain
file; the TUI never writes API keys into session history.

### Diagnostics and recovery

`/diagnostics` runs the workspace compiler when the standalone client has no
Monaco/LSP process: `cargo check --message-format=json --workspace` for Rust
projects, `tsc --noEmit` for TypeScript projects, and `python -m py_compile`
for a requested Python file. The result is projected into the transcript with
file, line, column, severity, and source. Agents can also run project-specific
linters and tests through the shared persistent terminal tools.

If a provider request fails, the shared runtime emits a structured error and the
TUI keeps the session available for `/retry` or a follow-up message. If a
provider is missing, select a configured provider with `/model` or fix the
shared settings/keychain files.
MCP connection failures are reported as diagnostics and do not prevent the
rest of the runtime from starting. The standalone client intentionally does not
provide Monaco buffers, editor decorations, desktop SQLite sharing, or a GUI
file picker; those remain desktop-only presentation features.

---

## Data Flow

### User-Initiated Edit
```
User types in Editor
  → Monaco onChange → editorStore.updateBuffer(fileId, content)
  → debounced save → Tauri invoke("fs_write_file", { path, content })
  → Rust handler writes to disk
```

### Agent-Initiated Edit (Agentic Loop)
```
User sends prompt via Agent Panel
  → agentStore.sendMessage(prompt)
  → Harness.run(conversation)
    → Context Manager gathers: open files, git diff, selected text
    → AI Provider.streamChat(messages, tools)
    → LLM returns tool_call: edit_file({ path, old, new })
    → Tool Router routes to Tauri invoke("fs_patch_file", ...)
    → Rust patches file on disk
    → Monaco updates buffer (via fileStore subscription)
    → Agent streams next response token
  → Loop continues until agent returns final message or user interrupts
```

### SDD Flow (Spec-Driven Development)
```
User describes feature in natural language
  → Harness enters SDD mode
  → Phase 1 — SPEC: LLM generates specification document
  → User reviews/approves spec (editable in Monaco)
  → Phase 2 — PLAN: LLM generates task list from approved spec
  → User reviews/approves plan
  → Phase 3 — EXECUTE: Harness executes tasks sequentially
    → Each task is an agent loop (observe → think → act)
    → Progress tracked in SQLite (plan_tasks table)
    → User can pause/resume/skip tasks
  → Phase 4 — REVIEW: Agent self-reviews all changes
```

---

## Cross-Cutting Concerns

### Security
- **API Keys**: stored in OS keychain via Tauri's secure storage (never in SQLite/plaintext)
- **CSP**: strict Content-Security-Policy in Tauri config (no `unsafe-eval`, no remote scripts)
- **Capabilities**: Tauri v2 capability system gates IPC commands per window
- **Sandbox**: code execution runs in isolated subprocess with resource limits
- **MCP Gating**: each MCP server gets explicit capability grants

### Observability
- **Structured logging**: `tracing` crate in Rust, `pino` in TypeScript
- **Agent telemetry**: token usage, tool call counts, latency per provider (stored in SQLite)
- **Error boundaries**: React error boundaries per panel to prevent cascade crashes

### Performance
- **Monaco lazy load**: dynamic import, only loaded when editor panel is visible
- **Virtual file tree**: only renders visible nodes (react-window or tanstack-virtual)
- **Streaming UI**: agent responses render token-by-token via AsyncIterable → React state
- **SQLite WAL mode**: concurrent reads during writes for responsive UI
- **Rust-side caching**: LRU cache for file metadata, directory listings

### State Management
```
Zustand Stores (client-side)
├── editorStore     — open tabs, active file, cursor positions, dirty state
├── agentStore      — conversations, messages, streaming state, tool calls
├── fileStore       — file tree, file contents cache, watch events
├── settingsStore   — user preferences, AI config, keybindings
└── projectStore    — active project, recent projects, workspace config, VORTEX visibility
```

### VORTEX Project/Session Federation

The VORTEX layout presents a federated index of known projects and persisted conversations. The
index is read from the Rust-owned SQLite `projects` and `conversations` tables through the typed
`db_list_vortex_project_sessions` command and is merged with the local recent-project registry so
projects with no sessions remain discoverable.

VORTEX keeps one isolated `HarnessBridge` and `AgentStoreApi` per project/conversation runtime.
Multiple sessions in the same project and sessions in different projects can therefore execute at
the same time. The runtime manager owns lifecycle, cancellation, retry, status publication, and
focus selection; only the focused runtime is projected into the shared agent-panel store used by
the rest of the layout. Background runtimes continue receiving harness events and publish their
own live status and message counts to the navigator.

Selecting a project or session still goes through the existing project-persistence coordinator
when the file workspace must change. That coordinator clears the shared projection without
disposing VORTEX runtimes, hydrates the target project, and resumes projection after generation
and path guards pass. EDITOR continues to use the legacy singleton bridge and exposes only one
active project's runtime.

---

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Desktop framework | Tauri v2 | ~10MB bundle, Rust security, native OS integration |
| Frontend framework | React 19 | Largest ecosystem, concurrent features, RSC-ready |
| UI library | shadcn/ui | Composable primitives, owns the source, Tailwind-native |
| Editor | Monaco Editor | LSP support, diff view, same engine as VS Code |
| State | Zustand + Immer | Minimal boilerplate, fine-grained subscriptions |
| Database | SQLite (sqlx) | Structured queries, migrations, Rust-native |
| Monorepo | Turborepo + pnpm | Build caching, workspace linking, Tauri-compatible |
| AI abstraction | Custom provider layer | Full streaming control, no SDK bundle overhead |
| Agent protocol | MCP (@modelcontextprotocol/sdk) | Official standard, growing ecosystem |

---

## Package Dependency Graph

```
apps/desktop
  ├── packages/ui           (shadcn components)
  ├── packages/agent-harness (orchestration)
  │     ├── packages/ai-providers
  │     ├── packages/mcp-client
  │     └── packages/skills
  └── packages/ai-providers  (direct for settings UI)

apps/server (optional, M3+)
  ├── packages/ai-providers
  └── packages/mcp-client
```

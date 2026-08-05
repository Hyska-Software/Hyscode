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

## Standalone Rust TUI Client

The repository also ships a standalone Ratatui client in `tools/hyscode-tui`.
The Rust process owns terminal rendering, keyboard input, transcript projection,
session commands, cancellation, terminal resize, and interactive
approval/question prompts. It launches `packages/tui-runtime` as a versioned
NDJSON bridge so the desktop and CLI use the same
`@hyscode/agent-harness`, `@hyscode/ai-providers`, `@hyscode/mcp-client`, built-in
skills, rules, agent modes, sub-agent flow, SDD services, and provider streaming
protocol.

The production bridge keeps the desktop host contract and forwards terminal
operations to the Rust `portable-pty` manager. That manager owns native PTY
creation, input, resize, snapshots, replay buffers, interrupts, exit events,
and shutdown. The TypeScript layer remains the source of truth for agent
behavior and projects the Rust-host events into the same terminal runtime used
by the harness. Filesystem, Git, Docker, web, keychain, memory, SDD, and
diagnostic commands are exposed through the host adapter; no production tool
uses fake data or an empty exporter.

Desktop settings are mirrored from the existing Zustand/local-storage store to
the platform shared settings file (`%LOCALAPPDATA%/hyscode/settings.json` on
Windows). The CLI reads and writes that contract and uses the same file-backed
`hyscode:<account>` keychain convention. CLI conversations, memories, SDD rows,
and traces use an isolated JSON data store so a terminal session cannot mutate
the desktop SQLite database unexpectedly. The bridge protocol is explicit about
streaming events, interaction requests, cancellation, host requests, and
structured errors, leaving room for a future shared SQLite adapter without
changing the Rust UI.

### Build and launch

From the repository root on Windows:

```powershell
npm run build:tui
tools/hyscode-tui/dist/hyscode-tui.exe .
```

`build:tui` creates `hyscode-tui.exe` and `hyscode-tui-bridge.exe` in the same
directory. The packaged launcher therefore does not require Bun at runtime.
For source development, `cargo run --manifest-path tools/hyscode-tui/Cargo.toml
-- .` discovers `packages/tui-runtime/src/main.ts` through Bun. Use
`HYSCODE_REPO_ROOT` when launching the executable from another directory.

The launcher accepts `--provider`, `--model`, `--mode`, `--config`, and
`--workspace`. Inside the TUI, the supported commands are:

`/help`, `/mode`, `/model`, `/projects`, `/project`, `/new`, `/sessions`,
`/load`, `/diagnostics`, `/retry`, `/cancel`, `/quit`.

`Ctrl-C` cancels an active turn and quits when the input is empty; `Esc` cancels
or clears input. Approval prompts support `y` (allow), `n` (deny), and `t`
(allow and trust the tool). Question prompts accept text followed by Enter.

### Configuration and credentials

The default Windows files are:

| Purpose | Default path | Override |
|---|---|---|
| Shared desktop/TUI settings | `%LOCALAPPDATA%\\hyscode\\settings.json` | `HYSCODE_CONFIG_PATH` or `--config` |
| Shared file-backed credentials | `%LOCALAPPDATA%\\hyscode\\keychain.json` | `HYSCODE_KEYCHAIN_PATH` |
| TUI sessions, memory, SDD, traces | `%LOCALAPPDATA%\\hyscode\\tui-data.json` | `HYSCODE_TUI_DATA_PATH` |
| Rust-to-runtime bridge | packaged sibling or source Bun entrypoint | `HYSCODE_TUI_BRIDGE` |
| Codex provider sidecar | packaged sibling or repository binary | `HYSCODE_CODEX_SIDECAR` |
| Repository discovery | current directory | `HYSCODE_REPO_ROOT` |

The desktop sync is one-way while the desktop is running: desktop settings are
written to the shared JSON file whenever the settings store changes. If both
clients are open, launch the TUI after the desired desktop settings are saved,
or pass an explicit `--config` file for an isolated profile. Provider API keys
are resolved from environment variables first and then the shared keychain
file; the TUI never writes API keys into session history.

### Diagnostics and recovery

`/diagnostics` runs the workspace compiler when the standalone client has no
Monaco/LSP process: `cargo check --message-format=json --workspace` for Rust
projects, `tsc --noEmit` for TypeScript projects, and `python -m py_compile`
for a requested Python file. The result is projected into the transcript with
file, line, column, severity, and source. Agents can also run project-specific
linters and tests through the shared persistent terminal tools.

If a provider request fails, the bridge emits a structured error and the TUI
keeps the session available for `/retry` or a follow-up message. If the bridge
cannot start, verify that the packaged bridge is beside the launcher, or set
`HYSCODE_TUI_BRIDGE` to an executable path. If a provider is missing, select a
configured provider with `/model` or fix the shared settings/keychain files.
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

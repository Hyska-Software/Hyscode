# HysCode — Task Breakdown

## Task Format

Each task follows this format:
- **ID**: `M{milestone}-T{number}` (e.g., `M0-T1`)
- **Type**: `setup` | `feat` | `fix` | `refactor` | `docs` | `test`
- **Size**: `S` (< 2h) | `M` (2-4h) | `L` (4-8h) | `XL` (8h+)
- **Deps**: task IDs this depends on

---

## M0 — Foundation

| ID | Type | Size | Title | Description | Deps |
|---|---|---|---|---|---|
| M0-T1 | setup | M | Initialize Turborepo + pnpm workspaces | Create root `package.json`, `pnpm-workspace.yaml`, `turbo.json`. Configure workspace packages: `apps/desktop`, `packages/ui`, `packages/ai-providers`, `packages/agent-harness`, `packages/mcp-client`, `packages/skills`. | — |
| M0-T2 | setup | L | Scaffold Tauri v2 + React + Vite | `pnpm create tauri-app` in `apps/desktop/`. Configure `tauri.conf.json` with app name, window settings, CSP. Verify `pnpm tauri dev` works. | M0-T1 |
| M0-T3 | setup | M | Configure Tailwind CSS v4 | Install `@tailwindcss/vite`, set up CSS-first config in `app.css`. No `tailwind.config.js` (v4 style). | M0-T2 |
| M0-T4 | setup | M | Configure shadcn/ui with Zinc theme | Run `npx shadcn@latest init`. Select Zinc base color. Install: Button, Input, Textarea, Card, Dialog, Sheet, Tabs, DropdownMenu, ScrollArea, Tooltip, Separator. | M0-T3 |
| M0-T5 | setup | S | Install Geist fonts | Add `geist` npm package. Configure `@font-face` in CSS. Set as default UI and mono fonts in Tailwind config. | M0-T3 |
| M0-T6 | setup | L | Configure SQLite via tauri-plugin-sql | Add `tauri-plugin-sql` to Cargo.toml. Register plugin in `main.rs`. Write initial migration (`001_initial.sql`) with all tables from DATABASE.md. Set WAL mode pragmas. | M0-T2 |
| M0-T7 | feat | M | Create Zustand stores skeleton | Create store files: `editorStore.ts`, `agentStore.ts`, `fileStore.ts`, `settingsStore.ts`, `projectStore.ts`. Define interfaces and initial state (no implementations yet). | M0-T2 |
| M0-T8 | feat | L | Build base IDE layout shell | Create App shell with `react-resizable-panels`. 3-panel layout: sidebar, editor area (with terminal below), agent panel. TauriTitleBar component. StatusBar component. All with placeholder content. | M0-T4, M0-T5 |
| M0-T9 | setup | M | GitHub Actions CI | Workflow: checkout, install pnpm, install deps, `pnpm lint`, `pnpm typecheck`, `pnpm tauri build --ci`. Matrix: ubuntu-latest. | M0-T2 |
| M0-T10 | setup | S | Configure ESLint + Prettier | Shared ESLint config in root. Prettier config. Lint scripts in root `package.json`. | M0-T1 |
| M0-T11 | setup | S | Add tsconfig base configs | Root `tsconfig.base.json` with strict mode. Package-specific `tsconfig.json` extending base. Path aliases for `@hyscode/*`. | M0-T1 |
| M0-T12 | setup | S | Configure Tauri capabilities | Create `capabilities/main.json` with permissions for FS, shell, sql, http, dialog, clipboard. Scope FS access. | M0-T2 |

---

## M1 — Core IDE

| ID | Type | Size | Title | Description | Deps |
|---|---|---|---|---|---|
| M1-T1 | feat | L | Implement Tauri FS commands | Rust commands: `fs_read_file`, `fs_write_file`, `fs_create_file`, `fs_delete_file`, `fs_list_dir`, `fs_stat`, `fs_patch_file`. TypeScript bindings via `@tauri-apps/api`. | M0-T6, M0-T12 |
| M1-T2 | feat | M | Implement FS watcher | Rust: `fs_watch` / `fs_unwatch` commands using `notify` crate. Emit `fs:changed` events. Frontend listener in `fileStore`. | M1-T1 |
| M1-T3 | feat | L | Build file tree panel | Virtual scrolling file tree component. Recursive directory loading via `fs_list_dir`. Expand/collapse with state persistence. File type icons (lucide or phosphor). Git status decorations (placeholder). | M1-T1 |
| M1-T4 | feat | M | Folder open dialog | "Open Folder" button and Ctrl+K Ctrl+O shortcut. Uses Tauri dialog plugin. Loads file tree for selected directory. Updates `projectStore` and `fileStore`. | M1-T3 |
| M1-T5 | feat | XL | Integrate Monaco Editor | Lazy-load `@monaco-editor/react`. Custom dark theme (`hyscode-dark`). Editor component that reads from `fileStore` cache. `onChange` updates `editorStore` buffer. | M0-T8 |
| M1-T6 | feat | L | Implement tab system | Tab bar component. Open file → new tab. Close tab (with save prompt if dirty). Switch tabs. Tab context menu. Dirty indicator. Preview mode (single-click = preview, double-click = pin). | M1-T5 |
| M1-T7 | feat | M | File save operations | Ctrl+S saves active file via `fs_write_file`. Ctrl+Shift+S saves all. Debounced auto-save (optional, in settings). Clear dirty state on save. | M1-T1, M1-T6 |
| M1-T8 | feat | L | Implement Tauri PTY commands | Rust commands: `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`. Event emission for `pty:data` and `pty:exit`. PTY state management in Rust. | M0-T12 |
| M1-T9 | feat | L | Integrate xterm.js terminal | Install `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`. Terminal component connected to PTY via Tauri events. Auto-resize on panel resize. Theme matching. | M1-T8 |
| M1-T10 | feat | M | Multiple terminal sessions | Terminal tab bar. New terminal button. Kill terminal. Switch between terminals. Default shell detection. | M1-T9 |
| M1-T11 | feat | L | Workspace search | Search panel (Ctrl+Shift+F). Uses `fs_search` Tauri command. Regex support. File pattern filter. Results with file path + line number. Click result → open file at line. | M1-T1, M1-T5 |
| M1-T12 | feat | M | Resizable panels polish | Fine-tune `react-resizable-panels`. Collapse/expand animations. Persist layout in `settingsStore`. Min/max constraints. | M0-T8, M0-T7 |
| M1-T13 | feat | M | Keyboard shortcuts (core) | Register shortcuts: Ctrl+P (go to file), Ctrl+Shift+P (command palette placeholder), Ctrl+B (toggle sidebar), Ctrl+` (toggle terminal), Ctrl+L (focus agent input). | M1-T5, M1-T9 |
| M1-T14 | feat | S | External file change handling | When `fs:changed` event received for open file: if clean → auto-reload. If dirty → show notification dialog. | M1-T2, M1-T6 |

---

## M2 — AI Provider Layer

| ID | Type | Size | Title | Description | Deps |
|---|---|---|---|---|---|
| M2-T1 | feat | L | Define AIProvider interface + types | `packages/ai-providers/src/types.ts`: AIProvider, AIModel, ChatParams, StreamChunk, Message, TokenUsage interfaces. | M0-T11 |
| M2-T2 | feat | L | Implement Anthropic adapter | POST to `/v1/messages`. SSE streaming parser. Tool use content blocks handling. Cache control support. Token counting via tokenizer. | M2-T1 |
| M2-T3 | feat | L | Implement OpenAI adapter | POST to `/v1/chat/completions`. SSE streaming parser. Function calling translation. Token counting via tiktoken. | M2-T1 |
| M2-T4 | feat | M | Implement Gemini adapter | REST API to `generateContent`/`streamGenerateContent`. Parts translation. Function declarations mapping. | M2-T1 |
| M2-T5 | feat | M | Implement Ollama adapter | POST to `http://localhost:11434/api/chat`. NDJSON streaming. Dynamic model list via `/api/tags`. No auth required. | M2-T1 |
| M2-T6 | feat | S | Implement OpenRouter adapter | Extends OpenAI adapter with OpenRouter base URL + headers. Dynamic model list via `/api/v1/models`. | M2-T3 |
| M2-T7 | feat | M | Provider registry | `ProviderRegistry` class: register, get, list, initialize. Dynamic initialization from keychain. Singleton pattern. | M2-T2, M2-T3, M2-T4, M2-T5, M2-T6 |
| M2-T8 | feat | M | Tauri keychain integration | Rust commands: `keychain_set`, `keychain_get`, `keychain_delete`. TypeScript wrapper. Used by Settings UI for API key management. | M0-T12 |
| M2-T9 | feat | L | Settings UI — AI providers | Settings page: provider list, select active provider, model dropdown, API key input (masked), temperature slider, max tokens input. Key validation on save. | M2-T7, M2-T8, M0-T4 |
| M2-T10 | feat | L | Agent Panel — basic chat UI | Agent panel layout: header (model selector), message thread, input bar. Send message → stream response → display. No tools yet. | M2-T7, M0-T8 |
| M2-T11 | feat | M | Streaming UI rendering | Token-by-token text rendering. Markdown parsing with syntax highlighting in code blocks. Auto-scroll on new content. Stop button to cancel stream. | M2-T10 |
| M2-T12 | feat | S | Token usage status bar | Display input/output tokens and estimated cost in status bar. Updated after each message. | M2-T10 |

---

## M3 — Agent Harness v1

| ID | Type | Size | Title | Description | Deps |
|---|---|---|---|---|---|
| M3-T1 | feat | XL | Harness engine core | `packages/agent-harness/src/harness.ts`: main loop implementation. Observe → Think → Plan → Act → Update cycle. Iteration limits, timeout, cancellation. | M2-T7 |
| M3-T2 | feat | L | Context Manager | Gather context from: open files, selection, conversation history, file tree. Token budget management. Priority-based context assembly. Truncation strategy for long conversations. | M3-T1 |
| M3-T3 | feat | L | Tool Router | Tool registration, schema validation (against inputSchema), dispatch to handlers. Category-based routing. Error wrapping. | M3-T1 |
| M3-T4 | feat | L | Filesystem tool handlers | Implement handlers for: `read_file`, `write_file`, `edit_file`, `create_file`, `list_directory`, `search_code`. All via Tauri IPC. | M3-T3, M1-T1 |
| M3-T5 | feat | M | Terminal tool handler | `run_terminal_command` handler. Spawn PTY, send command, capture output, return result. Timeout support. | M3-T3, M1-T8 |
| M3-T6 | feat | M | Git tool handlers (read-only) | `git_status`, `git_diff` handlers via Tauri git commands. | M3-T3 |
| M3-T7 | feat | L | Approval workflow | `agentStore.pendingToolCalls` queue. Approval card UI component. Approve/reject buttons. Auto-approve mode setting. Per-category approval config. | M3-T3, M2-T10 |
| M3-T8 | feat | L | Tool call visualization | Tool call card component: name, input preview, status icon, timing, expandable output. Status transitions with animation. Failed state with error details. | M3-T7 |
| M3-T9 | feat | M | Context chips | Context chip bar below message thread. Drag file from tree → add chip. @mention autocomplete in input. Remove chip (X button). Visual indicator of token budget. | M3-T2, M2-T10 |
| M3-T10 | feat | M | Agent edit visualization | When agent uses `edit_file`/`write_file`: highlight affected lines in Monaco with diff decorations. Ghost cursor during streaming. Undo checkpoint creation. | M3-T4, M1-T5 |
| M3-T11 | feat | S | Stuck loop detection | Track last N tool calls. If 3 identical consecutive calls, break loop and prompt user. Warning UI in agent panel. | M3-T1 |
| M3-T12 | feat | M | Conversation persistence | Save conversations to SQLite (conversations + messages tables). Load conversation history. New conversation button. Conversation title auto-generation. | M3-T1, M0-T6 |

---

## M4 — SDD Flow

| ID | Type | Size | Title | Description | Deps |
|---|---|---|---|---|---|
| M4-T1 | feat | L | Build mode UI | Phase indicator component (Describe → Spec → Plan → Execute → Review). Description input panel. Mode toggle in agent header. | M2-T10 |
| M4-T2 | feat | L | SDD spec generation | System prompt for spec generation from description. Structured spec output (Markdown). Spec displayed in agent panel with "Edit in Editor" button. | M3-T1 |
| M4-T3 | feat | M | Spec review + approval | Open spec in Monaco as virtual document. User edits freely. Approve/Redo buttons. Save approved spec to SDD session. | M4-T2, M1-T5 |
| M4-T4 | feat | L | Plan generation | System prompt for task list generation from approved spec. Parse structured task list. Display in task list UI. | M4-T3 |
| M4-T5 | feat | L | Task list UI | Task list component: ordered tasks with checkboxes, status icon, description, file list. Progress bar. Reorder via drag. Edit/delete tasks. | M4-T4 |
| M4-T6 | feat | XL | Sequential task execution | Harness executes tasks in order (respecting deps). Each task = one agent loop. Progress updates in real-time. Task status transitions. Agent output per task. | M4-T5, M3-T1 |
| M4-T7 | feat | M | Pause/resume/skip controls | Pause button (waits for current task to complete). Resume button. Skip task button. Cancel entire session. | M4-T6 |
| M4-T8 | feat | M | SDD persistence | Save SDD sessions + tasks to SQLite. Resume interrupted sessions after app restart. Load session history. | M4-T6, M0-T6 |
| M4-T9 | feat | M | Undo checkpoints per task | Each completed task creates a labeled undo checkpoint in editor. "Undo Task X" in edit menu. | M4-T6, M1-T5 |
| M4-T10 | feat | L | Self-review phase | After all tasks: agent reviews all changes (git diff). Generates summary. Checks consistency with spec. Review displayed in agent panel. | M4-T6 |

---

## M5 — MCP + Skills

| ID | Type | Size | Title | Description | Deps |
|---|---|---|---|---|---|
| M5-T1 | feat | L | MCP client manager core | `packages/mcp-client/src/manager.ts`: connect/disconnect, tool discovery, callTool, lifecycle management. Connection pooling. | M0-T11 |
| M5-T2 | feat | L | stdio transport | Spawn local process via Tauri PTY. JSON-RPC over stdin/stdout. Process lifecycle management. | M5-T1, M1-T8 |
| M5-T3 | feat | M | SSE transport | HTTP SSE client for server→client. POST endpoints for client→server. Session management. Reconnection logic. | M5-T1 |
| M5-T4 | feat | M | Dynamic tool registration | On MCP connect: parse tool list, generate ToolDefinitions, register in Tool Router. Namespace tools with server ID. Unregister on disconnect. | M5-T1, M3-T3 |
| M5-T5 | feat | M | MCP settings UI | Settings panel for MCP servers. Add server form (name, transport type, command/URL). Test connection button. Enable/disable toggle. Remove button. | M5-T1 |
| M5-T6 | feat | L | Skill loader | `packages/skills/src/loader.ts`: load skills from 3 scopes (built-in, global, workspace). Parse YAML frontmatter + markdown body. Merge by name. | M0-T11 |
| M5-T7 | feat | M | Skill injection into system prompt | Append active skills as `<skill>` blocks to system prompt. Respect token budget. Priority-based ordering. | M5-T6, M3-T2 |
| M5-T8 | feat | L | Built-in skills | Write skill markdown files: `base-agent.md`, `code-editing.md`, `code-review.md`, `refactor.md`, `test-generation.md`, `debug.md`, `security-audit.md`, `git-workflow.md`. | M5-T6 |
| M5-T9 | feat | M | Trigger-based activation | Parse trigger conditions from frontmatter. Match against user messages (keyword matching). Auto-activate matching skills. | M5-T7 |
| M5-T10 | feat | M | Skills panel UI | Sidebar panel: active skills section, available skills section. Toggle switches. Skill details on click. "New Skill" button. "Open Skills Dir" button. | M5-T6 |
| M5-T11 | feat | S | `activate_skill` meta-tool | Tool definition for agent to request skill activation. Handler loads and activates the skill for current conversation. | M5-T7, M3-T3 |
| M5-T12 | feat | M | `list_mcp_tools` meta-tool | Tool that returns all available MCP tools across connected servers. Used by agent for discovery. | M5-T4 |
| M5-T13 | feat | M | Skill editor | Create new skill from template in workspace `.hyscode/skills/`. Open in Monaco for editing. YAML frontmatter syntax awareness. | M5-T6, M1-T5 |

---

## M6 — Code Sandbox + Git

| ID | Type | Size | Title | Description | Deps |
|---|---|---|---|---|---|
| M6-T1 | feat | XL | Sandboxed code execution | Rust-side subprocess with resource limits (CPU timeout, memory cap, no network). Support JS (Node), Python, Bash. Stream output via events. Kill command. | M0-T12 |
| M6-T2 | feat | M | `run_code` tool handler | Validate language, dispatch to sandbox. Capture stdout/stderr. Return result with exit code and duration. | M6-T1, M3-T3 |
| M6-T3 | feat | L | Tauri git commands (write ops) | Rust commands: `git_commit`, `git_add`, `git_checkout`, `git_branch_list`, `git_branch_create`, `git_log`. All via `git2` crate. | M0-T12 |
| M6-T4 | feat | M | `git_commit` tool handler | Stage specified files + create commit. Requires approval. Return commit hash. | M6-T3, M3-T3 |
| M6-T5 | feat | L | Git panel in sidebar | Show: current branch, changed files (staged/unstaged), file status icons. Stage/unstage buttons. Commit input + button. | M6-T3 |
| M6-T6 | feat | M | Git log viewer | Scrollable commit history. Each commit: hash, message, author, date. Click → view diff for that commit. | M6-T3 |
| M6-T7 | feat | M | Git decorations in file tree | Modified (M, yellow), Added (A, green), Deleted (D, red), Untracked (U, gray) labels on file tree nodes. | M6-T3, M1-T3 |
| M6-T8 | feat | M | Git gutter decorations in editor | Monaco editor gutter decorations: green bar for added lines, red bar for deleted lines (vs HEAD). | M6-T3, M1-T5 |
| M6-T9 | feat | L | Review mode | Toggle review mode in agent header. Auto-loads `git diff`. Agent reviews changes with severity levels (P0-P2). Inline comments linked to file:line. | M6-T3, M3-T1 |
| M6-T10 | feat | M | `web_search` tool | HTTP request via Tauri plugin to search API (DuckDuckGo or SearXNG). Parse results. Return title + snippet + URL. | M3-T3 |

---

## M7 — Polish + Optimization

| ID | Type | Size | Title | Description | Deps |
|---|---|---|---|---|---|
| M7-T1 | refactor | L | Performance audit + optimization | Measure all metrics from MVP spec. Profile Monaco load time. Optimize bundle with code splitting. Reduce memory usage. | All |
| M7-T2 | feat | M | Virtual scrolling for file tree | Replace naive list with `@tanstack/react-virtual`. Only render visible nodes. Handle expand/collapse with virtual list. | M1-T3 |
| M7-T3 | feat | M | Virtual scrolling for message thread | Virtualize agent panel message list. Handle variable-height messages. Maintain scroll position on new messages. | M2-T10 |
| M7-T4 | feat | L | Command palette | Ctrl+Shift+P opens command palette (Dialog + Command component from shadcn). Searchable list of all commands. Keyboard navigation. | M0-T4 |
| M7-T5 | feat | M | Keyboard shortcuts — complete set | Register all shortcuts from UI_UX_SPEC. Keybinding editor in settings. Conflict detection. | M1-T13 |
| M7-T6 | feat | L | Welcome + onboarding screen | First-launch welcome screen. Setup wizard: choose theme, configure first AI provider, open a project. Feature overview. | M0-T4 |
| M7-T7 | feat | M | Conversation history browser | List all past conversations. Search by title/content. Delete conversations. Resume conversation. | M3-T12 |
| M7-T8 | feat | L | Telemetry dashboard | Local-only analytics page: token usage over time, cost by provider, tool call frequency, average latency. Charts (recharts). | M0-T6 |
| M7-T9 | feat | M | Loading/empty/error states | Implement all states from UI_UX_SPEC: skeleton loaders, empty state illustrations, error cards, toast notifications. | M0-T4 |
| M7-T10 | feat | M | Streaming optimization | Batch DOM updates during streaming. RequestAnimationFrame for smooth token rendering. Reduce re-renders during streaming. | M2-T11 |
| M7-T11 | docs | M | User documentation | README.md, QUICKSTART.md, CONTRIBUTING.md. Feature documentation. Keyboard shortcut reference. | — |
| M7-T12 | test | L | Cross-platform testing | Test on Windows, macOS, Linux. Fix platform-specific issues. Verify all Tauri commands work across platforms. | All |
| M7-T13 | feat | S | App icons + branding | Design app icon. Configure Tauri icon set. Window title. About dialog. | — |

---

## Summary

| Milestone | Tasks | Total Size |
|---|---|---|
| M0 — Foundation | 12 | 6S + 4M + 2L |
| M1 — Core IDE | 14 | 1S + 5M + 7L + 1XL |
| M2 — AI Provider Layer | 12 | 2S + 5M + 5L |
| M3 — Agent Harness v1 | 12 | 2S + 5M + 4L + 1XL |
| M4 — SDD Flow | 10 | 0S + 4M + 4L + 2XL |
| M5 — MCP + Skills | 13 | 2S + 7M + 4L |
| M6 — Sandbox + Git | 10 | 0S + 6M + 3L + 1XL |
| M7 — Polish | 13 | 1S + 6M + 5L + 1XL |
| **Total** | **96** | |

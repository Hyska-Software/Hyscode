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
└── projectStore    — active project, recent projects, workspace config
```

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

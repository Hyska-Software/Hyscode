# MVP Specification

## Product Definition

**HysCode** is a desktop-native agentic IDE where AI agents write, edit, and execute code using real developer tools. Built on Tauri v2, it provides a full code editor, integrated terminal, and an AI agent panel that can autonomously perform development tasks using the Spec-Driven Development (SDD) methodology.

### Target Users
- Solo developers building projects with AI assistance
- AI-native development teams wanting deeper tool integration than chat-based copilots
- Developers who want a local-first, privacy-respecting AI coding environment

### Core Value Proposition
> "An IDE where the AI agent is a first-class citizen — not a sidebar chatbot, but an active participant with real tools."

---

## User Stories (MVP)

### Editor (P0)

| ID | Story | Acceptance Criteria |
|---|---|---|
| US-01 | As a user, I can open a folder and browse its file tree | Folder picker dialog, recursive tree rendering, expand/collapse |
| US-02 | As a user, I can open files in tabbed editor panels | Click file → new tab, syntax highlighting, multiple tabs |
| US-03 | As a user, I can edit and save files | Type in Monaco, dirty indicator on tab, Ctrl+S saves via Tauri FS |
| US-04 | As a user, I can use an integrated terminal | xterm.js terminal, run commands, capture output |
| US-05 | As a user, I can search across workspace files | Ctrl+Shift+F opens search, regex support, results with file links |
| US-06 | As a user, I can see file changes in diff view | After agent edit, side-by-side diff, accept/reject buttons |

### AI Agent (P0)

| ID | Story | Acceptance Criteria |
|---|---|---|
| US-10 | As a user, I can chat with an AI model | Agent panel, text input, streaming response display |
| US-11 | As a user, I can choose my AI provider and model | Settings UI, provider dropdown, model list, API key input |
| US-12 | As a user, I can see when the agent uses tools | Tool call cards in chat, expandable, show input/output |
| US-13 | As a user, I can approve or reject destructive tool calls | Approval cards for write/terminal tools, approve/reject buttons |
| US-14 | As a user, I can add files to the agent's context | Context chips, drag file from tree, or @mention syntax |
| US-15 | As a user, I can see the agent edit files in real-time | Streaming edit visualization in Monaco, typing cursor effect |

### SDD (P0)

| ID | Story | Acceptance Criteria |
|---|---|---|
| US-20 | As a user, I can describe a feature and get a spec | "Build" mode, enter description, agent generates spec markdown |
| US-21 | As a user, I can review and edit the generated spec | Spec opens in Monaco, user edits freely, approve button |
| US-22 | As a user, I can see the execution plan | Task list UI, each task with checkbox, description, status |
| US-23 | As a user, I can watch the agent execute tasks | Real-time progress, current task highlighted, tool calls shown |
| US-24 | As a user, I can pause/resume/skip tasks | Controls on task list: pause, resume, skip buttons |

### MCP & Skills (P1)

| ID | Story | Acceptance Criteria |
|---|---|---|
| US-30 | As a user, I can configure MCP servers | Settings panel, add server form (stdio/SSE), test connection |
| US-31 | As a user, I can see MCP tools in agent capabilities | MCP tools listed alongside built-in tools |
| US-32 | As a user, I can view and toggle skills | Skills panel, active/available sections, toggle switch |
| US-33 | As a user, I can create custom skills | "New Skill" button, markdown template, save to workspace |

### Settings & Polish (P1)

| ID | Story | Acceptance Criteria |
|---|---|---|
| US-40 | As a user, I can customize editor settings | Font size, tab size, word wrap, theme toggle |
| US-41 | As a user, I can see token usage and cost estimates | Status bar: tokens used, estimated cost per conversation |
| US-42 | As a user, I can use keyboard shortcuts for common actions | Shortcut map: Ctrl+P, Ctrl+Shift+P, Ctrl+L, Ctrl+B, etc. |

---

## Out of Scope (MVP)

- Multi-window / multi-workspace support
- Extension/plugin marketplace
- Collaborative editing (multi-user)
- Remote development (SSH/containers)
- Built-in debugging (DAP)
- Mobile/web deployment (Tauri desktop only)
- User accounts / cloud sync
- Voice input
- Image generation
- Auto-updates (manual download for MVP)

---

## Success Metrics

| Metric | Target |
|---|---|
| App launch to usable editor | < 3 seconds |
| File open time (P75) | < 200ms |
| Agent first-token latency | < 1.5 seconds (after API round-trip) |
| Agent tool execution (P75) | < 500ms per tool call |
| Bundle size (installed) | < 30MB |
| Memory usage (idle) | < 200MB |
| Crash rate | < 1% of sessions |
| SDD spec-to-execution | Full feature in < 10 minutes (simple CRUD) |

---

## Technical Constraints

1. **Offline-capable**: editor and terminal work without internet; only AI features need connectivity (except Ollama)
2. **Local-first**: all data stored locally in SQLite; no cloud dependencies
3. **Cross-platform**: Windows, macOS, Linux (Tauri v2 targets all three)
4. **Secure by default**: API keys in OS keychain, CSP enforced, sandboxed execution

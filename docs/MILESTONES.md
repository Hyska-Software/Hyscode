# HysCode — Milestones

## Overview

Development is organized into 8 milestones (M0–M7) spanning approximately 17 weeks. Each milestone has clear deliverables, a definition of done, and dependencies on previous milestones.

---

## M0 — Foundation (Week 1–2)

### Goal
Set up the monorepo, Tauri desktop shell, React frontend scaffold, database, and CI pipeline.

### Deliverables
- [x] Turborepo monorepo with pnpm workspaces
- [x] Tauri v2 app (`apps/desktop/`) with React + Vite
- [x] shadcn/ui configured with Zinc dark theme + Geist fonts
- [x] Tailwind CSS v4 with CSS-first config
- [x] SQLite via `tauri-plugin-sql` with initial migration (schema v1)
- [x] Zustand stores scaffold (editor, agent, file, settings, project)
- [x] `packages/` skeleton (ui, ai-providers, agent-harness, mcp-client, skills)
- [x] GitHub Actions CI (lint, typecheck, Tauri build check)
- [x] Base layout shell (sidebar, editor panel placeholder, agent panel placeholder, status bar)

### Definition of Done
`pnpm dev` opens a Tauri window with the base IDE layout. All panels are visible (with placeholder content). CI passes on push.

### Dependencies
None (first milestone).

---

## M1 — Core IDE (Week 3–5)

### Goal
Build a functional code editor with file tree, tabs, terminal, and basic file operations.

### Deliverables
- [ ] File tree panel with virtual scrolling
- [ ] Folder open dialog (Tauri native dialog)
- [ ] Monaco Editor integration (lazy loaded)
- [ ] Custom dark theme for Monaco (matching shadcn tokens)
- [ ] Tab system (open, close, switch, dirty indicator, preview mode)
- [ ] File read/write via Tauri FS commands
- [ ] FS watcher for external change detection
- [ ] Integrated terminal (xterm.js + Tauri PTY)
- [ ] Multiple terminal sessions with tabs
- [ ] Workspace search (Ctrl+Shift+F)
- [ ] Keyboard shortcuts (core set)
- [ ] Resizable panels with react-resizable-panels

### Definition of Done
User can open a project folder, browse files in tree, edit files in Monaco, save files, and run terminal commands. All core keyboard shortcuts work.

### Dependencies
M0 (all infrastructure)

---

## M2 — AI Provider Layer (Week 5–6)

### Goal
Implement the AI provider abstraction and connect to all 5 providers with streaming chat.

### Deliverables
- [ ] `packages/ai-providers` — abstract AIProvider interface
- [ ] Anthropic adapter (streaming, tool use)
- [ ] OpenAI adapter (streaming, function calling)
- [ ] Gemini adapter (streaming, function declarations)
- [ ] Ollama adapter (local, streaming, tool use)
- [ ] OpenRouter adapter (OpenAI-compatible)
- [ ] Provider registry with dynamic initialization
- [ ] API key management via Tauri keychain
- [ ] Settings UI: provider picker, model selector, API key input
- [ ] Basic chat in Agent Panel (text only, no tools yet)
- [ ] Streaming UI: token-by-token rendering
- [ ] Token usage display in status bar

### Definition of Done
User can select any of the 5 providers, enter an API key, choose a model, and have a streaming text chat in the Agent Panel.

### Dependencies
M0 (stores, UI), M1 not strictly required (can develop in parallel)

---

## M3 — Agent Harness v1 (Week 7–9)

### Goal
Build the core agentic loop with tool routing, context management, and the approval workflow.

### Deliverables
- [ ] `packages/agent-harness` — Harness engine core
- [ ] Agent loop implementation (observe → think → act cycle)
- [ ] Context Manager with token budget
- [ ] Tool Router with schema validation
- [ ] Built-in tool handlers (all filesystem tools)
- [ ] Terminal tool handler (run_terminal_command)
- [ ] Git tools (status, diff — read-only)
- [ ] Approval workflow UI (pending cards, approve/reject buttons)
- [ ] Tool call visualization (expandable cards, status, timing)
- [ ] Agent iteration limit and timeout
- [ ] Stuck loop detection (repeated identical tool calls)
- [ ] Context chips (files in context, add via drag or @mention)

### Definition of Done
Agent can: read files, edit files (with approval), create files, list directories, search code, run terminal commands (with approval), and check git status. All tool calls are visible in the Agent Panel. Context chips work for adding files.

### Dependencies
M1 (editor, file system), M2 (AI providers)

---

## M4 — SDD Flow (Week 9–11)

### Goal
Implement the full Spec-Driven Development workflow with spec generation, planning, and autonomous execution.

### Deliverables
- [ ] Build mode UI (phase indicators, description input)
- [ ] SDD Engine: spec generation from description
- [ ] Spec review UI (open in Monaco, approve/edit/redo)
- [ ] Plan generation from approved spec
- [ ] Task list UI (checkboxes, status, progress bar)
- [ ] Sequential task execution with agent loop per task
- [ ] Pause/resume/skip controls
- [ ] SDD data persistence (SQLite: sdd_sessions, sdd_tasks)
- [ ] Undo checkpoints per task
- [ ] Self-review phase after execution
- [ ] Change summary generation

### Definition of Done
User can describe a feature, agent generates spec, user approves, agent generates plan, user approves, agent executes all tasks autonomously with real-time progress. User can pause and resume. All state survives app restart.

### Dependencies
M3 (harness, tools, approval workflow)

---

## M5 — MCP + Skills (Week 11–13)

### Goal
Integrate MCP client for external tools and implement the skills system.

### Deliverables
- [ ] `packages/mcp-client` — MCP client manager
- [ ] stdio transport (local process servers)
- [ ] SSE transport (remote servers)
- [ ] Dynamic tool registration from MCP servers
- [ ] Built-in MCP server configs (filesystem, git)
- [ ] MCP settings UI (add/remove servers, test connection)
- [ ] `packages/skills` — skill loader
- [ ] Skill discovery (built-in, global, workspace)
- [ ] Skill injection into system prompt
- [ ] Trigger-based activation
- [ ] Skills panel UI (active/available, toggle, create new)
- [ ] Built-in skills: base-agent, code-editing, code-review, refactor, test-generation, debug
- [ ] `activate_skill` meta-tool
- [ ] Skill editor (create/edit .md files in Monaco)

### Definition of Done
User can connect MCP servers (stdio and SSE), agent can use MCP-provided tools. Skills panel shows built-in and workspace skills. Skills modify agent behavior when activated. User can create custom skills.

### Dependencies
M3 (tool router for MCP integration), M1 (Monaco for skill editing)

---

## M6 — Code Sandbox + Git (Week 13–15)

### Goal
Add sandboxed code execution and full git integration.

### Deliverables
- [ ] Sandboxed code execution (subprocess with resource limits)
- [ ] `run_code` tool: JavaScript, TypeScript, Python, Bash
- [ ] Sandbox output streaming
- [ ] Git panel in sidebar
- [ ] Git commit tool (stage + commit with approval)
- [ ] Git branch operations (list, create, checkout)
- [ ] Git log viewer
- [ ] Git decorations in file tree (modified/added/deleted indicators)
- [ ] Git diff decorations in editor gutter
- [ ] Review mode: auto-load git diff, agent reviews changes
- [ ] `web_search` tool implementation (via Tauri HTTP plugin)

### Definition of Done
Agent can run code snippets in sandbox, execute git operations (commit with approval), and perform web searches. User can view git status and history in sidebar. Review mode works for reviewing uncommitted changes.

### Dependencies
M3 (tool infrastructure), M4 (review mode concept)

---

## M7 — Polish + Optimization (Week 15–17)

### Goal
Performance optimization, UX polish, keyboard shortcuts completion, onboarding, and stability.

### Deliverables
- [ ] Performance audit: measure all metrics from MVP spec
- [ ] Monaco lazy loading optimization
- [ ] Virtual scrolling for file tree and message thread
- [ ] Streaming UI optimization (batch DOM updates)
- [ ] Keyboard shortcuts: complete set from spec
- [ ] Command palette (Ctrl+Shift+P)
- [ ] Welcome/onboarding screen
- [ ] Conversation history browser
- [ ] Telemetry dashboard (local: token usage, cost estimates, tool stats)
- [ ] Loading/empty/error states for all panels
- [ ] App icon and branding
- [ ] Cross-platform testing (Windows, macOS, Linux)
- [ ] Crash reporting (local error log)
- [ ] User documentation (README, quick start guide)

### Definition of Done
All performance targets from MVP spec are met. All keyboard shortcuts work. Onboarding flow is smooth. App is stable across Windows, macOS, and Linux. Ready for beta release.

### Dependencies
All previous milestones (M0–M6).

---

## Timeline Summary

```
Week  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17
M0    ████
M1          ████████
M2                ████
M3                      ████████
M4                            ████████
M5                                  ████████
M6                                        ████████
M7                                              ████████
```

Note: M1 and M2 overlap (weeks 5-6) as they can be developed in parallel by different concerns (editor vs AI layer).

# HysCode — Full Project Analysis

> Produced by the analysis agent pass. Scope: whole repository at
> `D:/Hyscode` (branch `fix/lsp-windows-spawn-and-uris`), version `0.15.0`
> (desktop build `0.15.0-build.114`).

---

## 1. What the product is

**HysCode** is a **native agentic desktop IDE**: AI agents write, edit, and
execute code using real developer tools (Monaco editor, terminal, git, LSP,
filesystem) instead of being a sidebar chatbot. It follows a **Spec-Driven
Development (SDD)** methodology orchestrated by an internal engine called the
**Harness**.

Deliverables shipped from this repo:

1. **Desktop app** (`apps/desktop`) — Tauri v2 shell + React 19 WebView.
2. **VORTEX CLI / TUI** (`tools/hyscode-tui` + `packages/tui-runtime`) — a
   standalone terminal client sharing the same agent data store as Desktop.
3. **2 first-party sidecars** (`packages/claude-agent-sidecar`,
   `packages/codex-sidecar`) — Bun-compiled binaries wrapping the Claude Agent
   SDK and OpenAI Codex SDK.
4. **33 first-party extensions** (`extensions/`) — language support, themes,
   and tools.

Canonical repo: `https://github.com/Hyska-Software/Hyscode`, maintainer
`@Estevaobonatto`, MIT license.

---

## 2. Architecture (layers)

```
┌──────────────────────────────────────────────────────────────┐
│ React 19 UI — Monaco, xterm.js terminal, Agent panel, Kanban │
│ shadcn/ui + Tailwind v4 + Zustand 5 stores                   │
├──────────────────────────────────────────────────────────────┤
│ Tauri IPC (invoke / emit / listen, typed, camelCase args)    │
├──────────────────────────────────────────────────────────────┤
│ Rust shell — 24 command modules, PTY, git, SQLite, keychain, │
│ LSP spawn, Docker, GitHub OAuth/PR, hardened fs.rs guards    │
├──────────────────────────────────────────────────────────────┤
│ Agent Harness (packages/agent-harness) — the "heart":        │
│ conversation loop, ToolRouter, ContextManager (token budget),│
│ SddEngine, SkillLoader/RuleLoader, memory, traces,           │
│ spawn_subagent, mode policies (chat/build/review/debug/plan) │
├──────────────────────────────────────────────────────────────┤
│ AI Providers (packages/ai-providers) — Anthropic, OpenAI,    │
│ Gemini, Ollama, OpenRouter, Copilot, OpenCode, Claude/Codex  │
│ sidecars; all chat() return AsyncIterable<StreamChunk>       │
├──────────────────────────────────────────────────────────────┤
│ MCP Client (stdio / SSE / WS) · LSP Client · Extension host  │
└──────────────────────────────────────────────────────────────┘
```

Key structural rules (from `docs/architecture/*` and `architecture-diagram.md`):

- The **Harness lives outside React**; bridges (`harness-bridge.ts`,
  `sub-agent-runner.ts`, `mcp-bridge.ts`, `lsp-bridge.ts`) connect pure
  packages to Zustand stores via callbacks.
- **Sub-agents** get a fresh `Harness()`, a `SUBAGENT_PREAMBLE` without
  `ask_user`, read-loop detection (max 3x), and inherit skills/rules/approvals
  from the parent. `spawn_subagent` is registered by the host, never by
  sub-agents themselves (no recursion).
- **TUI parity is mandatory**: shared contract changes must keep the fullscreen
  TUI supported alongside Desktop (`AGENTS.md`).
- **Security boundary**: direct Tauri `plugin-fs` writes are blocked by
  capability config; all filesystem mutation goes through hardened Rust
  commands (`fs.rs`: canonicalize + filesystem-root guard). API keys live in
  the OS keychain, never in TS or SQLite. MCP secrets come from credential
  storage; MCP transport enforces HTTPS/WSS except loopback, deadline-bound
  RPCs, and capability/delegation allowlists.

---

## 3. Repository map

| Area | Contents | Notes |
|---|---|---|
| `apps/desktop/` | Tauri app: `src/` (components, stores, hooks, lib) + `src-tauri/` (Rust) | 38 Zustand stores, ~24 Rust command modules (`ai, browser, claude_agent, codex, db, devices, diagnostics, docker, extension, fs, git, git_backend, github_*, kanban, keychain, lsp, notifications, pty, search, security, updater, window`) |
| `packages/agent-harness` | Agent loop, tools, SDD engine, memory, policies, delegation | Largest package: ~50 source modules with co-located tests; `harness.ts` is the core class |
| `packages/ai-providers` | Provider registry, model catalogs, retry, prompt-cache, token counting | 14 provider implementations under `src/providers/` |
| `packages/mcp-client` | MCP manager + transports (manager, types, index) | stdio transport disabled by design (no raw-process JSON-RPC) |
| `packages/lsp-client` | LSP connection/manager, Monaco adapter, semantic tokens, URI utils, Tauri transport | 6 test files; Windows spawn/URIs are the current fix branch |
| `packages/extension-api` + `extension-host` | Extension authoring types + sandbox runtime (contributions, keybindings, commands) | Host registers contributions in registries |
| `packages/skills`, `packages/theme`, `packages/ui` | Built-in skills, shared theme tokens, Radix/shadcn component library | `ui` has ~25 Radix dependencies |
| `packages/tui-runtime` | Runtime for the terminal client: bridge, data-store, PTY, NDJSON protocol, themes, updater | Tested (10 test files) |
| `packages/claude-agent-sidecar`, `packages/codex-sidecar` | Bun `--compile` binaries emitted to `apps/desktop/src-tauri/binaries/` | Tagged per target triple |
| `tools/hyscode-tui` | VORTEX CLI source (controller, renderer, commands, input, subagent-state) | Production bundle via `npm run build:vortex` |
| `extensions/` | **33** `extension.json` manifests: 24 language/tool extensions + 8 themes under `extensions/themes/` + `todo-tree` etc. | e.g. react/vue/go/java support, code-runner, git-pulse, request-forge |
| `docs/` | 6 architecture docs, 5 specs (+sample extension), 4 ADRs, 2 goal plans, WORKFLOW/PLAYBOOK/MILESTONES/MODELS_REFERENCE | Rich, maintained documentation |
| `scripts/` | ~40 build/release scripts (Windows/macOS/Linux, installers, sidecar packaging, preflight) | PowerShell-heavy (Windows-primary development) |
| `.github/workflows` | `ci.yml`, `pr-lint.yml`, `release.yml`, `auto-merge.yml`, `stale.yml`, `sync-labels.yml` | PR title/branch/body linting enforced by CI |

---

## 4. Main flows

1. **Agent turn** — `Harness.run()` prepares the request (context manager with
   token budget, prompt cache, rules/skills/project instructions), streams
   provider chunks, routes tool calls through the `ToolRouter` (approval
   policies, path policies, tool invocation policy), records traces, and
   supports cancellation (ADR-0002 cooperative cancellation).
2. **Sub-agents** — `spawn_subagent(task, mode)` batches run concurrently when
   possible; `build/debug/plan` wait for an exclusive workspace slot, `review`
   runs in parallel. Results mirror back into the parent tool-call timeline.
3. **SDD engine** — `sdd-engine.ts` drives spec → plan → implement cycles;
   `manage_tasks` is the turn-local checklist, while persistent project tasks
   live in the **Kanban** domain (SQLite migration `016_kanban.sql`,
   `kanban_*` tools, `TaskExecutionCoordinator`, revisioned `kanban:changed`
   events). Goal mode (`017_goals.sql`) adds persistent objectives with
   criteria and budgets.
4. **VORTEX sessions** — background/dedicated agent sessions per project are
   indexed and focused through `vortex-session-runtime.ts`; the same data store
   feeds the TUI (`tools/hyscode-tui`).
5. **Editor/LSP/Extensions** — `extension-loader.ts` reads `extension.json`
   contributions → `extension-host` registries → Monaco via `lsp-client`
   adapter; language servers spawn through Tauri `lsp.rs`.
6. **Terminal** — authoritative terminal runtime (ADR-0004) over Rust PTY,
   rendered with xterm.js; the TUI has its own `node-pty` path with terminal
   handoff.

---

## 5. Technology stack & tooling

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript 5.8 (strict) + Vite 6 |
| UI | shadcn/ui + Tailwind CSS v4 + Base UI/Radix |
| State | Zustand 5 (+ immer middleware) |
| Editor / Terminal | Monaco (`@monaco-editor/react`) · xterm.js 6 |
| Database | SQLite (`tauri-plugin-sql`), WAL mode, 11 migrations (`001–009`, `016`, `017`) |
| Monorepo | Turborepo + npm workspaces (`apps/*`, `packages/*`, `tools/*`) |
| Tests | Vitest 3 + Testing Library (jsdom) — **157 test files** |
| Quality | ESLint (flat config, `no-explicit-any: error`), Prettier (printWidth 100, singleQuote) |
| CI/CD | GitHub Actions: ci, pr-lint, release (tags `vX.Y.Z-build.N`), auto-merge, stale, sync-labels |
| Build scripts | ~40 scripts in `scripts/` (NSIS/Inno installers, sidecar packaging, preflight) |

Primary scripts: `npm run dev`, `build`, `lint`, `typecheck`, `test`,
`format`, `build:prod*`, `release:local`, `build:vortex`, `build:tui`.

---

## 6. Repository state (at analysis time)

- **Branch**: `fix/lsp-windows-spawn-and-uris`.
- **Uncommitted work**: 13 modified files —
  - staged: `harness-bridge.ts`, `sub-agent-runner.ts`, `delegated-runner.ts`,
    `delegation.test.ts`, `agent-harness/index.ts`,
    `middleware-compaction.test.ts`, `middleware.ts`
  - unstaged: `ai-tab.tsx`, `general-tab.tsx`, `harness.test.ts`,
    `harness.ts`, `agent-harness/index.ts` (also staged → dual state),
    `mode-policies.ts`
- Theme of the in-flight change: LSP Windows spawn/URI fixes plus agent mode
  policy / delegation adjustments. **No commit, push, or PR is performed —
  that is the user's decision** (per `AGENTS.md`).

---

## 7. Strengths

1. **Exceptionally thorough documentation** — architecture, specs, ADRs,
   workflow playbook, model reference, extension guide; docs and code are kept
   in sync (e.g. Kanban doc explicitly records `manage_tasks` displacement).
2. **Clear layering and boundaries** — pure packages vs React bridges vs Rust
   shell; the Harness is UI-independent and reused by both Desktop and TUI.
3. **Safety-first agent design** — approval dialogs, path policies, capability
   gating, keychain-only secrets, hardened FS commands, MCP transport
   hardening, sub-agent recursion blocked, `ask_user` blocked in children.
4. **Multi-surface parity** — Desktop + fullscreen TUI (VORTEX) share data
   store and contracts; sidecars isolate Claude/Codex SDKs.
5. **Strong test culture** — 157 test files with co-located tests, plus
   acceptance/e2e suites (`live-harness.acceptance.test.ts`,
   `prompt-cache.e2e.test.ts`, `catalog-golden.test.ts`).
6. **Mature workflow governance** — issue-first, branch/PR lint CI, agent
   preflight script, conventional commits, explicit merge-label rules.
7. **Broad provider coverage** — 14 providers with a unified streaming
   interface, retry, cost, and prompt-cache handling.

## 8. Risks / technical debt

1. **Scale of the core loop** — `agent-harness` concentrates ~50 modules;
   `harness.ts` and `tools.ts` are very large, raising regression risk for
   mode-policy/delegation changes (the current uncommitted work touches
   exactly these files).
2. **Documentation vs code drift risk** — many docs describe behavior that
   must be updated in lockstep (`AGENTS.md` mandates this); the dual
   staged/unstaged state of `index.ts`/`harness.ts` suggests work mid-flight.
3. **Migration numbering gaps** — migrations jump `009 → 016 → 017`; either
   removed migrations or pending ones, worth confirming to avoid ordering
   confusion.
4. **Windows/PowerShell-centric release tooling** — most build scripts are
   `.ps1`; cross-platform contributors depend on WSL/shell alternatives.
5. **Wide surface area in Rust commands** — 200+ `#[tauri::command]`
   occurrences across 24 modules; consistency of error handling and
   validation must be policed by review (there is no Rust test suite visible
   in this pass beyond MSVC-driven command suites mentioned in docs).
6. **UI dependency weight** — `@hyscode/ui` carries ~25 Radix packages and
   the desktop app adds mermaid, xlsx, mammoth, etc.; bundle size is watched
   (`verify-frontend-bundle.mjs`) but remains a watch item.
7. **Root-level log artifacts** — `pref.log`, `probe-*.log`, `ps-error.log`,
   `tsc_output.txt` clutter the tree and should not be committed.

## 9. Useful statistics

| Metric | Value |
|---|---|
| Version | `0.15.0` (desktop `0.15.0-build.114`) |
| Workspace packages | 1 app + 12 packages + 1 tool |
| Zustand stores (desktop) | 38 |
| Rust command modules | 24 (200+ `#[tauri::command]` sites) |
| SQLite migrations | 11 files (`001–009`, `016`, `017`) |
| Extensions | 33 `extension.json` manifests (25 top-level + 8 themes) |
| Test files | 157 |
| Provider implementations | 14 |
| ADRs | 4 |
| GitHub workflows | 6 |
| Build/release scripts | ~40 |
| Architecture docs / specs | 6 / 5 |

---

## 10. Suggested follow-ups (optional)

- Commit or stash the in-flight `fix/lsp-windows-spawn-and-uris` work
  (13 files) once verified with `npm run lint && npm run typecheck`.
- Reconcile migration numbering (or document the gap).
- Clean root-level `*.log` artifacts and add them to `.gitignore`.
- Keep `docs/architecture/*` synchronized with any mode-policy/delegation
  behavior change introduced by the current branch.

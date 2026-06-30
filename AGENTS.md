# HysCode — Agent Guide

## Project Overview

HysCode is a desktop IDE powered by AI agents. Agents write, edit, and execute code using real developer tools (Monaco Editor, terminal, git, filesystem). Built with Tauri v2 (Rust) + React 19 (TypeScript).

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript + Vite 6 |
| UI | shadcn/ui + Tailwind CSS v4 + Base UI |
| State | Zustand 5 |
| Editor | Monaco Editor + @monaco-editor/react |
| Terminal | xterm.js + @xterm/addon-fit |
| Database | SQLite (tauri-plugin-sql) |
| Monorepo | Turborepo + npm workspaces |

## Project Structure

```
├── apps/desktop/          # Tauri app (React frontend + Rust backend)
│   ├── src/               # React components, stores, hooks, lib
│   └── src-tauri/         # Rust shell (PTY, git, FS commands)
├── packages/
│   ├── agent-harness/     # Agent loop, tool router, SDD engine, memory, middleware
│   ├── ai-providers/      # Provider abstraction (Anthropic, OpenAI, Gemini, Ollama, OpenRouter, GitHub Copilot, OpenCode)
│   ├── mcp-client/        # Model Context Protocol client (stdio/SSE/WS)
│   ├── skills/            # Built-in agent skills runtime
│   ├── ui/                # Shared UI components
│   ├── extension-api/     # Extension authoring types & API
│   ├── extension-host/    # Extension sandbox runtime (contributions, keybindings, commands)
│   ├── lsp-client/        # Language Server Protocol client (Monaco adapter)
│   └── claude-agent-sidecar/ # Bun-compiled Claude Code sidecar binary
├── extensions/            # 26 first-party extensions (language support, themes, tools)
├── docs/
│   ├── architecture/      # OVERVIEW, AGENT_HARNESS, AI_PROVIDERS, MCP, FRONTEND, TAURI, SKILLS, DATABASE
│   └── specs/             # MVP_SPEC, AGENT_SPEC, EDITOR_SPEC, TOOLS_SPEC, UI_UX_SPEC
└── scripts/               # Build scripts for Windows, macOS, Linux
```

## Architecture

```
┌────────────────────────────────────────────┐
│  React UI (Monaco, Terminal, Agent Panel)  │
│  shadcn/ui + Tailwind + Zustand            │
├────────────────────────────────────────────┤
│  Tauri IPC (invoke/emit/listen)            │
├────────────────────────────────────────────┤
│  Rust Shell (FS, PTY, Git, SQLite, Sandbox)│
├────────────────────────────────────────────┤
│  Agent Harness (SDD Engine, Tool Router)   │
├────────────────────────────────────────────┤
│  AI Providers (Anthropic, OpenAI, Gemini…) │
├────────────────────────────────────────────┤
│  MCP Client (stdio / SSE / WS transports)  │
└────────────────────────────────────────────┘
```

## Available Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start full dev environment (turbo dev + Tauri) |
| `pnpm build` | Build all packages (turbo build) |
| `pnpm lint` | Run ESLint across all packages |
| `pnpm typecheck` | TypeScript type checking (tsc --noEmit) |
| `pnpm format` | Prettier format all files |
| `pnpm format:check` | Check formatting without writing |
| `pnpm build:prod` | Windows production build (PowerShell) |
| `pnpm build:prod:nsis` | Windows NSIS installer build |
| `pnpm build:prod:inno` | Windows Inno Setup build |

## Coding Conventions

- **TypeScript**: strict mode, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`, `declaration: true`, `sourceMap: true`
- **Modules**: ESNext + bundler resolution (import/export)
- **Formatting**: Prettier with project config (run `pnpm format`)
- **Linting**: ESLint (run `pnpm lint` before push)
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `perf:`, `test:`)
- **Rust**: `cargo fmt` + `cargo clippy` before committing Rust changes
- **Tauri IPC**: `invoke()` arguments in camelCase (auto-converts to snake_case in Rust)
- **AI Providers**: All `chat()` methods return `AsyncIterable<StreamChunk>` (not Promise)
- **API Keys**: Never stored in TypeScript or SQLite — use Rust keychain layer
- **Branch naming**: `feat/feature-name`, `fix/bug-name` (from `main`)

## Code Quality Rules

### Completeness (Zero Placeholder Policy)
- Never output placeholders, TODOs, stubs, or `// implement later`. Every function must be fully implemented.
- No fake/mock data, no `console.log("test")` as body, no `throw new Error("not implemented")`.
- No minimal/partial implementations — if a feature has N parts, implement all N.
- If AI context window limits force truncation, split work across turns, never ship incomplete code.
- Every new feature includes its error handling, edge cases, and type definitions — not just the happy path.
- Before finishing a file, verify no placeholder patterns remain: `TODO`, `FIXME`, `...`, `???`, `___,` `implement me`, `your code here`, `add logic`.

### Structure & Readability
- Prefer small focused files (<300 lines). Extract types, utils, and constants into separate files
- Follow existing patterns in neighboring files — don't invent new conventions per file
- Avoid deep nesting (>3 levels). Extract branches into early returns or helper functions
- Use descriptive names. Abbreviations only for well-known terms (ref, cb, req, res)
- No magic numbers/strings — extract to named constants at top of file

### TypeScript
- Prefer `type` over `interface` unless extending or declaration merging is needed
- Mark function return types explicitly (no inference for public APIs)
- Use discriminated unions instead of optional fields for mutually exclusive states
- Avoid `any`. Use `unknown` + type narrowing when type is unpredictable
- Prefer `const` over `let` — only use `let` when rebinding is unavoidable

### React
- Components as functions, no class components
- Extract side effects into custom hooks, not inline in components
- Keep useEffect dependencies explicit — no missing deps, no `[]` for derived state
- Memoize expensive computations with `useMemo`/`useCallback`, not everything
- Use Zustand stores for shared state, React state for local UI state
- Avoid prop drilling past 2 levels — use composition or Zustand

### Rust
- No `unwrap()` or `expect()` in production code — propagate errors with `?`
- Use `thiserror` for library error types, `anyhow` for app-level errors
- Prefer iterator chains over raw loops where readable
- Mark immutable references by default, minimize `mut`
- Use `cargo clippy` and `cargo fmt` before committing

### Imports & Dependencies
- Group imports: 1) built-in 2) external 3) internal `@hyscode/*` 4) relative
- Use barrel exports (`index.ts`) at package roots — not deep internal paths
- Never add a dependency without checking if the project already has it
- Prefer internal packages over adding new npm dependencies

### Safety & Best Practices
- Never hardcode secrets, API keys, or tokens in code
- Validate all user/agent input before use — assume untrusted
- Handle errors explicitly. No empty catch blocks or silent swallows
- Log or trace meaningful context in catch blocks, not just the message
- Prefer immutable patterns — spread/rest instead of mutation where practical
- Use `neverthrow` Result pattern or discriminated unions over try/catch for expected failure paths

1. Check existing issues/discussions before starting work
2. Open an issue for large changes before writing code
3. Branch from `main` using conventional branch names
4. Keep commits focused and atomic
5. Run `pnpm lint && pnpm typecheck` before pushing
6. PR against `main` with template filled, issue linked (`Closes #123`)

## Key Packages & Internal Dependencies

| Package | Depends On | Purpose |
|---|---|---|
| @hyscode/agent-harness | ai-providers | Agent lifecycle, tool routing, SDD, memory, rules, skills |
| @hyscode/ai-providers | — | Provider registry, retry, token counting |
| @hyscode/mcp-client | — | MCP transport + manager |
| @hyscode/skills | — | Built-in skill definitions |
| @hyscode/extension-host | extension-api | Extension sandbox, contribution/kb/command registry |
| @hyscode/lsp-client | extension-api | LSP connection manager, Monaco adapter, built-in servers |
| @hyscode/ui | — | Shared React components |
| @hyscode/claude-agent-sidecar | anthropic SDK | Standalone Claude Code binary |

## Build/Release

- **Versioning**: Tags follow `v{major}.{minor}.{build}` (e.g., `v0.3.1-build.40`)
- **CI**: GitHub Actions (`.github/workflows/release.yml`)
- **Release**: `RELEASE.md` for process
- **Changelog**: `scripts/CHANGELOG.md`

## Related Docs

- `docs/architecture/OVERVIEW.md` — Full architecture
- `docs/architecture/AGENT_HARNESS.md` — Agent harness design
- `docs/architecture/AI_PROVIDERS.md` — Provider abstraction
- `docs/architecture/MCP.md` — MCP client design
- `docs/specs/MVP_SPEC.md` — MVP feature scope
- `docs/specs/AGENT_SPEC.md` — Agent specification
- `CONTRIBUTING.md` — Full contribution guide
- `architecture-diagram.md` — Visual architecture

## Security

- Report vulnerabilities per `SECURITY.md`
- License: MIT

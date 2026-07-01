# Contributing to HysCode

Thank you for your interest in contributing. This document covers everything you need to get started.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Workflow](#workflow)
- [Commit Convention](#commit-convention)
- [Code Style](#code-style)
- [Testing](#testing)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating you agree to uphold these standards.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18+ |
| pnpm | 10+ |
| Rust | 1.70+ |
| Git | any recent |

Tauri also requires platform-specific dependencies. See the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for your OS.

---

## Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/Hyscode.git
cd Hyscode

# 2. Install dependencies
pnpm install

# 3. Start dev server
pnpm dev
```

The Tauri window will launch with hot reload for both the frontend and Rust backend.

### Useful Commands

```bash
pnpm dev              # Start full dev environment
pnpm build            # Build all packages
pnpm lint             # Run ESLint across all packages
pnpm typecheck        # Run TypeScript type checking
pnpm format           # Format code with Prettier
pnpm format:check     # Check formatting without writing
```

---

## Project Structure

```
apps/desktop/         # Tauri desktop app
  src/                # React 19 frontend (components, stores, hooks)
  src-tauri/          # Rust backend (commands, plugins, migrations)

packages/
  ai-providers/       # AI provider abstraction (Anthropic, OpenAI, Gemini, Ollama, OpenRouter)
  agent-harness/      # Agentic loop engine, tool router, SDD engine
  mcp-client/         # Model Context Protocol client
  skills/             # Built-in agent skills
  ui/                 # Shared UI components
  extension-api/      # Extension authoring types and API
  extension-host/     # Extension sandbox runtime
  lsp-client/         # Language Server Protocol client

extensions/           # Bundled first-party extensions
docs/                 # Architecture docs and specs
```

---

## Workflow

> **Source of truth:** [`docs/WORKFLOW.md`](docs/WORKFLOW.md). Este guia é um
> resumo — sempre consulte a spec canônica quando houver dúvida.

1. **Check existing issues** before starting work to avoid duplication.
   ```bash
   gh issue list --search "<keyword>" --state all
   ```
2. **Open an issue** using the right template (`.github/ISSUE_TEMPLATE/`).
   Apply labels in the form `type:*`, `area:*`, `priority:*` and (if AI-driven)
   `workflow:agent-tasks`.
3. **Create a branch** from `main` following the strict pattern:
   ```bash
   # Substitua <remote> pelo nome do seu remote (`git remote -v` para descobrir).
   # No repositório upstream é `hyska`; em clones pode ser `origin`.
   git fetch <remote>
   git switch -c <type>/<issue#>-<scope>-<slug> main
   # e.g. feat/142-agent-harness-streaming-tools
   ```
   Pattern: `^(feat|fix|chore|refactor|perf|docs|test)/[0-9]+-[a-z0-9][a-z0-9-]*$`
4. **Make your changes**, keeping commits focused, atomic and following
   [Conventional Commits](https://www.conventionalcommits.org/). Reference the
   issue in the footer with `Refs #N` (or `Closes #N` for delivery).
5. **Run pre-flight** (also works for AI agents):
   ```bash
   ./scripts/agent-preflight.sh   # or pwsh scripts/agent-preflight.ps1 on Windows
   ```
6. **Run checks** before pushing:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test
   # Plus for Rust changes:
   cd apps/desktop/src-tauri && cargo fmt && cargo clippy && cargo test
   ```
7. **Push and open a Pull Request** against `main`:
   ```bash
   git push -u <remote> HEAD
   gh pr create --title "<type>(<scope>): <subject>" \
     --body-file .github/PULL_REQUEST_TEMPLATE.md --base main
   ```
8. **Squash-merge** is the only allowed merge strategy. The PR title (in
   Conventional Commits format) becomes the squash commit message on `main`.

See [`docs/WORKFLOW.md`](docs/WORKFLOW.md) for the complete spec (label taxonomy,
PR template, merge strategy, etc). For AI agents, see
[`docs/AGENT_PLAYBOOK.md`](docs/AGENT_PLAYBOOK.md).

---

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**

| Type | When to use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that is neither feat nor fix |
| `test` | Adding or updating tests |
| `chore` | Build process, dependency updates |
| `perf` | Performance improvement |

**Examples:**

```
feat(agent-harness): add streaming tool call support
fix(ai-providers): handle OpenAI rate limit retry correctly
docs(architecture): update OVERVIEW with PTY model
```

---

## Code Style

- **TypeScript**: strict mode, `noUnusedLocals`, `noUnusedParameters`
- **Modules**: ESNext modules, bundler resolution
- **Formatting**: Prettier with project config (run `pnpm format`)
- **Linting**: ESLint with project config (run `pnpm lint`)
- **Rust**: `cargo fmt` and `cargo clippy` before committing Rust changes

### Key Conventions

- Tauri `invoke()` arguments must use **camelCase** — Tauri v2 auto-converts to snake_case for Rust.
- API keys are never stored in TypeScript or SQLite — always via the Rust keychain layer.
- All AI provider `chat()` calls return `AsyncIterable<StreamChunk>` (never a Promise).

---

## Testing

```bash
# TypeScript tests (when available)
pnpm test

# Rust tests
cd apps/desktop/src-tauri
cargo test
```

When adding a new feature, include tests where feasible. For bug fixes, add a regression test.

---

## Submitting a Pull Request

- Fill out the pull request template completely (`.github/PULL_REQUEST_TEMPLATE.md`).
- PR title **must** follow [Conventional Commits](https://www.conventionalcommits.org/) — enforced by `pr-lint` workflow.
- Link the related issue with `Closes #N` (delivery) or `Refs #N` (partial work) — enforced by `pr-lint` workflow.
- Branch name **must** follow `<type>/<issue#>-<scope>-<slug>` — enforced by `pr-lint` workflow.
- Keep the PR focused — one logical change per PR (1 issue = 1 PR = 1 squash).
- Ensure CI passes before requesting review.
- Squash-merge is the only allowed strategy. See [`docs/WORKFLOW.md`](docs/WORKFLOW.md) §5.
- Be responsive to review feedback.

---

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- OS, Node.js version, Rust version
- Relevant logs or screenshots

---

## Requesting Features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Check the [Milestones](./docs/MILESTONES.md) first — your idea may already be planned.

---

## Questions

Open a [GitHub Discussion](https://github.com/Hyska-Software/Hyscode/discussions) for questions that are not bug reports or feature requests.

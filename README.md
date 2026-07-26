# HysCode

<p align="center">
  <img src="img-logos/vortex_icon_svg.svg" alt="HysCode logo" width="140" />
</p>

<p align="center">
  <strong>Native agentic desktop IDE</strong> — where AI agents write, edit, and execute code using real developer tools.
</p>

<p align="center">
  <a href="https://github.com/Hyska-Software/Hyscode/actions/workflows/ci.yml"><img src="https://github.com/Hyska-Software/Hyscode/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"/></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.1.0-blue" alt="Version"/></a>
</p>

---

Table of Contents

- [What is HysCode?](#what-is-hyscode)
- [Highlights](#highlights)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Getting Started (quick)](#getting-started-quick)
- [Development](#development)
- [Build/Production](#buildproduction)
- [Repository Structure](#repository-structure)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## What is HysCode?

HysCode reimagines the development workflow by bringing AI agents into the heart of the development environment. Instead of merely suggesting code, agents can:

- Write and edit code in real time using the Monaco Editor
- Run developer tools (terminal, Git, and file operations)
- Follow specifications with the Spec-Driven Development (SDD) engine
- Request user approval for every change — you always retain final control


## Highlights

- Autonomous agents with a feedback loop (SDD)
- Integration with multiple AI providers (Anthropic, OpenAI, Gemini, Ollama, OpenRouter)
- Rust/Tauri shell for secure filesystem, PTY, and Git operations
- Advanced editor (Monaco), integrated terminal (xterm.js), and shadcn/ui + Tailwind components

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                           USER INTERFACE                        │
│  File Tree │ Monaco Editor │ Agent Panel │ Terminal │ Settings   │
│  React + shadcn/ui + Tailwind + Zustand                          │
├──────────────────────────────────────────────────────────────────┤
│                     TAURI IPC BOUNDARY                           │
│  invoke()/emit()/listen() — typed commands                       │
├──────────────────────────────────────────────────────────────────┤
│                      TAURI RUST SHELL                            │
│  FS Commands │ PTY Manager │ Git Ops │ SQLite │ Process Sandbox   │
├──────────────────────────────────────────────────────────────────┤
│                     AGENT HARNESS (TS)                           │
│  Agent Loop │ Context Manager │ Tool Router │ SDD Engine         │
├──────────────────────────────────────────────────────────────────┤
│                    AI PROVIDER LAYER (TS)                        │
│  Anthropic │ OpenAI │ Gemini │ Ollama │ OpenRouter               │
├──────────────────────────────────────────────────────────────────┤
│                     MCP CLIENT (TS)                              │
│  @modelcontextprotocol/sdk │ stdio / SSE / WS transports         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

- Desktop shell: Tauri v2 (Rust)
- Frontend: React + TypeScript
- UI: shadcn/ui + Tailwind CSS
- State: Zustand
- Code editor: Monaco Editor
- Terminal: xterm.js + Tauri PTY
- Database: SQLite (tauri-plugin-sql)
- Monorepo: Turborepo + npm workspaces

---

## Getting Started (quick)

Prerequisites:

- Node.js 18+
- npm 10+ (the project pins the version through `packageManager` in `package.json`)
- Rust 1.70+ (`cargo` must be on your PATH — `C:\Users\<user>\.cargo\bin` on Windows)
- Tauri CLI prerequisites — see https://tauri.app/start/prerequisites/

Quick steps:

```bash
# Clone the repository
git clone https://github.com/Hyska-Software/Hyscode.git
cd Hyscode

# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev
```

The Tauri window opens automatically on startup.

---

## Development

Useful scripts (defined in `package.json`):

- `npm run dev` — starts all apps in development mode (turbo dev)
- `npm run build` — builds the monorepo (turbo build)
- `npm run lint` — runs the linter
- `npm run typecheck` — runs the TypeScript type checker
- `npm run format` — formats code with Prettier

---

## Build/Production

To create builds:

```bash
# Windows (PowerShell script that packages the app)
npm run build:prod

# macOS / Linux
npm run build
```

Installers are placed in `apps/desktop/src-tauri/target/release/bundle/` after the build.

---

## Repository Structure

Main directories:

```
apps/                 # apps (Tauri desktop + other applications)
packages/             # shared libraries (ai-providers, agent-harness, etc.)
extensions/           # bundled extensions
docs/                 # architecture and specification documentation
scripts/              # utility scripts
```

---

## Documentation

See the documents in `docs/` for architecture and design details:

- docs/architecture/OVERVIEW.md
- docs/architecture/AGENT_HARNESS.md
- docs/architecture/AI_PROVIDERS.md
- docs/architecture/MCP.md
- docs/architecture/FRONTEND.md
- docs/architecture/TAURI.md
- docs/EXTENSION_GUIDE.md
- docs/specs/MVP_SPEC.md

---

## Contributing

Contributions are very welcome! Before opening a pull request, please read `CONTRIBUTING.md`.

Suggestions for contributing:

- Open issues describing bugs or improvement proposals
- Create one branch per feature/bug fix (e.g. `feat/agent-loop-improvement`)
- Keep commits small and messages clear

---

## Security

For responsible vulnerability disclosure, see `SECURITY.md`.

---

## License

MIT — see `LICENSE` for details.

---

If you need help setting up the environment or running the project locally, tell me which operating system you are using — I can guide you step by step.

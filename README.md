# HysCode

<p align="center">
  <img src="img-logos/logo-150px.png" alt="HysCode logo" width="140" />
</p>

<p align="center">
  <strong>IDE agentiva nativa para desktop</strong> — onde agentes de IA escrevem, editam e executam código usando ferramentas reais de desenvolvedor.
</p>

<p align="center">
  <a href="https://github.com/Hyska-Software/Hyscode/actions/workflows/ci.yml"><img src="https://github.com/Hyska-Software/Hyscode/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"/></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.1.0-blue" alt="Version"/></a>
</p>

---

Índice

- [O que é o HysCode?](#o-que-é-o-hyscode)
- [Destaques](#destaques)
- [Arquitetura](#arquitetura)
- [Stack Tecnológico](#stack-tecnológico)
- [Começando (rápido)](#começando-rápido)
- [Desenvolvimento](#desenvolvimento)
- [Build/Produção](#buildprodução)
- [Estrutura do Repositório](#estrutura-do-repositório)
- [Documentação](#documentação)
- [Contribuição](#contribuição)
- [Segurança](#segurança)
- [Licença](#licença)

---

## O que é o HysCode?

HysCode reimagina o fluxo de desenvolvimento trazendo agentes de IA para o coração do ambiente de desenvolvimento. Em vez de apenas sugerir código, agentes podem:

- Escrever e editar código em tempo real usando o Monaco Editor
- Executar ferramentas de desenvolvedor (terminal, git, operações de arquivo)
- Seguir especificações com o motor Spec-Driven Development (SDD)
- Solicitar aprovação do usuário para cada alteração — você sempre tem controle final


## Destaques

- Agentes autônomos com ciclo de feedback (SDD)
- Integração com múltiplos provedores de IA (Anthropic, OpenAI, Gemini, Ollama, OpenRouter)
- Shell Rust/Tauri para operações seguras de filesystem, PTY e git
- Editor avançado (Monaco), terminal integrado (xterm.js) e componentes shadcn/ui + Tailwind

---

## Arquitetura

```
┌──────────────────────────────────────────────────────────────────┐
│                        INTERFACE DO USUÁRIO                      │
│  File Tree │ Monaco Editor │ Agent Panel │ Terminal │ Settings   │
│  React + shadcn/ui + Tailwind + Zustand                          │
├──────────────────────────────────────────────────────────────────┤
│                     TAURI IPC BOUNDARY                           │
│  invoke()/emit()/listen() — comandos tipados                      │
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

## Stack Tecnológico

- Desktop shell: Tauri v2 (Rust)
- Frontend: React + TypeScript
- UI: shadcn/ui + Tailwind CSS
- Estado: Zustand
- Editor de código: Monaco Editor
- Terminal: xterm.js + Tauri PTY
- Banco de dados: SQLite (tauri-plugin-sql)
- Monorepo: Turborepo + npm workspaces

---

## Começando (rápido)

Pré-requisitos:

- Node.js 18+
- npm 10+ (o projeto fixa a versão via `packageManager` em `package.json`)
- Rust 1.70+ (o `cargo` deve estar no PATH — `C:\Users\<user>\.cargo\bin` no Windows)
- Tauri CLI prerequisites — veja https://tauri.app/start/prerequisites/

Passos rápidos:

```bash
# Clonar o repositório
git clone https://github.com/Hyska-Software/Hyscode.git
cd Hyscode

# Instalar dependências
npm install

# Rodar em modo dev (hot reload)
npm run dev
```

Ao iniciar, a janela Tauri será aberta automaticamente.

---

## Desenvolvimento

Scripts úteis (definidos em `package.json`):

- `npm run dev` — inicia todos os apps em modo desenvolvimento (turbo dev)
- `npm run build` — build do monorepo (turbo build)
- `npm run lint` — executa linter
- `npm run typecheck` — checagem de tipos TypeScript
- `npm run format` — formata o código com Prettier

---

## Build/Produção

Para gerar builds:

```bash
# Windows (script PowerShell que empacota o app)
npm run build:prod

# macOS / Linux
npm run build
```

Os instaladores ficam em `apps/desktop/src-tauri/target/release/bundle/` após o build.

---

## Estrutura do Repositório

Principais pastas:

```
apps/                 # apps (desktop Tauri + outras aplicações)
packages/             # bibliotecas compartilhadas (ai-providers, agent-harness, etc)
extensions/           # extensões empacotadas
docs/                 # documentação de arquitetura e especificações
scripts/              # scripts auxiliares
```

---

## Documentação

Consulte os documentos em `docs/` para detalhes de arquitetura e design:

- docs/architecture/OVERVIEW.md
- docs/architecture/AGENT_HARNESS.md
- docs/architecture/AI_PROVIDERS.md
- docs/architecture/MCP.md
- docs/architecture/FRONTEND.md
- docs/architecture/TAURI.md
- docs/EXTENSION_GUIDE.md
- docs/specs/MVP_SPEC.md

---

## Contribuição

Contribuições são muito bem-vindas! Antes de abrir PRs, por favor leia `CONTRIBUTING.md`.

Sugestões para contribuir:

- Abra issues descrevendo bugs ou propostas de melhoria
- Crie uma branch por feature/bugfix (ex.: `feat/agent-loop-improvement`)
- Mantenha commits pequenos e com mensagens claras

---

## Segurança

Para divulgação responsável de vulnerabilidades, veja `SECURITY.md`.

---

## Licença

MIT — veja `LICENSE` para detalhes.

---

Se quiser ajuda para configurar o ambiente ou rodar o projeto localmente, me diga qual SO você está usando — eu posso guiar passo a passo.
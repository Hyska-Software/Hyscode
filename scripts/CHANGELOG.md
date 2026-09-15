# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Corrigido

- **LSP (Windows):** o `rust-analyzer` não iniciava em builds instalados
  (`os error 448`, `ERROR_UNTRUSTED_MOUNT_POINT`). O `CreateProcess` recusava o
  symlink proxy do rustup (`~/.cargo/bin/rust-analyzer.exe -> rustup.exe`).
  Agora o binário real da toolchain é resolvido com `rustup which`, o `PATH` do
  processo filho inclui o `bin` da toolchain (para `cargo`/`rustc`) e há retry
  único com mensagem acionável em caso de reparse point.
- **Terminal (xterm):** `Uncaught ReferenceError: i is not defined` em
  `InputHandler.requestMode` ao receber DECRQM. O `build.target` do Vite foi
  fixado em ES2021 para impedir o lowering de `||=` pelo esbuild 0.25.x, e um
  guard de pós-build (`scripts/verify-frontend-bundle.mjs`) falha o build se o
  padrão quebrado reaparecer no bundle.
- **LSP (URIs de documento):** os providers Monaco enviavam paths Windows crus
  (`monaco.Uri.parse('D:\\...')`), gerando URIs inválidas e erros
  `-32603: url is not a file` / `-32602: missing field range` no rust-analyzer.
  Os modelos agora usam URIs `file:///d%3A/...` canônicas, modelos sem arquivo
  real (history/diff/untitled) são ignorados e `textDocument/inlayHint` passa o
  `range` visível exigido pelos servidores.

## [0.1.0] - 2026-04-16

### Adicionado

- **Editor integrado** com suporte a múltiplas linguagens (TypeScript, Python, Rust, etc.)
- **Terminal interativo** integrado ao editor
- **Explorador de arquivos** com visualização de árvore
- **Painel do Git** com status de repositório e controle de commits
- **Integração com Claude AI** via MCP (Model Context Protocol)
- **Agent Harness** para orquestração de tarefas de IA
- **Docker integration** para gerenciamento de containers
- **Skills system** extensível para funcionalidades customizadas
- **Extension API** para desenvolvedores criar extensões
- **Review system** para análise de código
- **Dark theme** com tema "Tokyo Night"
- **React 19** + TypeScript + Vite para frontend
- **Tauri v2** para desktop (Windows, macOS, Linux)
- **Turbo monorepo** para gerenciamento de pacotes
- **pnpm workspaces** para dependências eficientes

### Corrigido

- Erros de tipo TypeScript no build
- Compilação correta de tipos no agent-harness
- Exportação adequada de tipos do ai-providers
- Imports não utilizados removidos da compilation

### Documentação

- README completo com arquitetura e roadmap
- Guia de contribuição detalhado
- Código de conduta Contributor Covenant
- Política de segurança
- Licença MIT

### Notas de Lançamento

Este é o primeiro lançamento do HysCode em versão pública. Ainda é uma versão MVP (Minimum Viable Product) com as funcionalidades core implementadas. Vários recursos ainda estão em desenvolvimento e serão adicionados em versões futuras.

#### Problemas Conhecidos

- O build de `claude-agent-sidecar` com `bun` pode falhar em alguns ambientes (não bloqueia o build Tauri)
- Bundle JavaScript pode exceder limite de 500KB recomendado
- Alguns warnings de import não utilizado no Rust build

#### Próximas Prioridades

- [ ] Melhorias de performance no editor
- [ ] Suporte a mais linguagens de programação
- [ ] CLI tool para HysCode
- [ ] Suporte a múltiplos workspaces
- [ ] Marketplace de extensions
- [ ] Testes automatizados
- [ ] CI/CD pipeline

---

[0.1.0]: https://github.com/Hyska-Software/Hyscode/releases/tag/v0.1.0

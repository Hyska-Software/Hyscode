# HysCode v0.1.0 — Release Inicial

## Bem-vindo ao HysCode

HysCode é um **IDE desktop agentico** nativo construído com **Tauri v2**, onde agentes de IA escrevem, editam e executam código usando ferramentas de desenvolvedor reais.

**Data de Lançamento:** Abril de 2026

---

## O que é o HysCode?

HysCode reimagina o desenvolvimento de software ao trazer a inteligência artificial para o núcleo do seu ambiente de codificação. Em vez de apenas sugerir código, o HysCode permite que agentes de IA:

- **Escrevam e editem código** em tempo real
- **Executem ferramentas** de desenvolvedor (terminal, git, sistema de arquivos)
- **Sigam especificações** através do fluxo Spec-Driven Development (SDD)
- **Aprovem mudanças** com controle total do usuário

---

## Funcionalidades da Versão 0.1.0

### Infraestrutura Base (M0)
- Monorepo Turborepo com pnpm workspaces
- Desktop nativo com Tauri v2 + React 19
- Interface moderna com **shadcn/ui** e tema Zinc escuro
- **Tailwind CSS v4** com configuração CSS-first
- Banco de dados SQLite integrado
- Stores Zustand para gerenciamento de estado (editor, agente, arquivos, settings, projetos)
- CI/CD com GitHub Actions
- Layout base IDE (sidebar, painel de editor, painel de agente, status bar)

### Próximas Milestones (em desenvolvimento)
- **M1**: Editor de código funcional com Monaco, árvore de arquivos, terminal integrado
- **M2**: Camada de provedores de IA (Anthropic, OpenAI, Gemini, Ollama, OpenRouter)
- **M3**: Harness de agentes com loop agentico e ferramentas
- **M4–M7**: SDD engine, MCP client, extensões, e refinamentos

---

## Requisitos do Sistema

### Para Usuários
- **Windows 10+**, **macOS 11+**, ou **Linux** (principais distros)
- Mínimo 4GB RAM
- 500MB espaço em disco

### Para Desenvolvedores
- **Node.js** 18+ ou **pnpm** 10+
- **Rust** 1.70+ (para builds do Tauri)
- **Tauri CLI** (`npm install -g @tauri-apps/cli`)
- Git

---

## Instalação

### Build Local (Desenvolvimento)

```bash
# Clonar o repositório
git clone https://github.com/Hyska-Software/Hyscode.git
cd Hyscode

# Instalar dependências
pnpm install

# Executar em modo desenvolvimento
pnpm dev

# O app Tauri abrirá automaticamente
```

### Build de Produção

```bash
# Windows (PowerShell)
pnpm run build:prod

# macOS
pnpm run build:prod

# Linux
pnpm run build:prod

# Instalar o executável gerado
```

---

## Documentação

Leia a documentação completa do projeto:

- [Visão Geral da Arquitetura](./docs/architecture/OVERVIEW.md) — camadas do sistema, fluxo de dados
- [Milestones](./docs/MILESTONES.md) — roadmap detalhado (M0–M7)
- [Guia do Agente Harness](./docs/architecture/AGENT_HARNESS.md) — motor de agentes
- [Provedores de IA](./docs/architecture/AI_PROVIDERS.md) — suporte multi-AI
- [MCP (Model Context Protocol)](./docs/architecture/MCP.md) — extensibilidade
- [Database](./docs/architecture/DATABASE.md) — schema SQLite
- [Frontend](./docs/architecture/FRONTEND.md) — componentes e state
- [Tauri](./docs/architecture/TAURI.md) — IPC e Rust backend
- [Especificação MVP](./docs/specs/MVP_SPEC.md) — requisitos completos

---

## Uso Rápido

1. **Abra um Projeto**
   - Use `Ctrl+O` ou menu para abrir uma pasta
   - A árvore de arquivos aparecerá no painel esquerdo

2. **Explore o Editor**
   - Clique em arquivos na árvore para abrir no Monaco Editor
   - Use abas para alternar entre arquivos
   - Salve com `Ctrl+S`

3. **Configure o Agente** (próximas versões)
   - Selecione um provedor de IA
   - Insira sua chave de API
   - Converse com o agente no painel direito

4. **Execute Tarefas com SDD** (próximas versões)
   - Descreva o que deseja em linguagem natural
   - O agente gera especificação → plano → executa
   - Revise e aprove mudanças

---

## Contribuindo

Adoraríamos sua contribuição! Aqui está como começar:

1. Fork o repositório
2. Crie um branch de feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova feature'`)
4. Push para o branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

### Diretrizes de Contribuição
- Siga o padrão de código TypeScript existente
- Execute `pnpm lint` e `pnpm typecheck` antes de commitar
- Adicione testes para novas funcionalidades
- Atualize a documentação conforme necessário

---

## Reportando Bugs

Encontrou um problema? Abra uma [Issue no GitHub](https://github.com/Hyska-Software/Hyscode/issues) com:

- Descrição clara do problema
- Passos para reproduzir
- Screenshots/logs se aplicável
- Informações do sistema (OS, versão do Node.js, etc)

---

## Roadmap

```
M0 (Concluído)   — Fundação + Layout
M1 (Em andamento) — IDE Core (Editor, Terminal, File Tree)
M2 (Próximo)      — Camada de Provedores IA
M3 (Q2 2026)      — Agent Harness v1
M4–M7 (Q2–Q3)     — SDD Engine, MCP, Extensões
```

Veja [MILESTONES.md](./docs/MILESTONES.md) para detalhes completos.

---

## Changelog (v0.1.0)

### Adições
- Primeiro release do HysCode
- Monorepo Turborepo configurado com pnpm
- Tauri v2 desktop app com React 19
- shadcn/ui integrado com tema Zinc
- Tailwind CSS v4 com configuração moderna
- SQLite com suporte a migrações
- Zustand stores para estado global
- GitHub Actions CI (lint, typecheck, build checks)
- Layout base IDE com painel lateral, editor, agente, status bar

### Conhecido
- Monaco Editor ainda é um placeholder (será integrado em M1)
- Terminal integrado não está funcional (será em M1)
- Agente de IA sem funcionalidade (será em M2–M3)
- MCP client ainda não implementado
- Extensões de idioma estão em stub (demo apenas)

---

## Segurança

HysCode foi projetado com segurança em mente:

- **Chaves de API**: Armazenadas no keychain do SO via Tauri (nunca em plaintext)
- **Content Security Policy**: Rigorosamente configurada no Tauri
- **Sandbox**: Código executado em subprocess isolado
- **Capabilities**: Sistema de permissões Tauri v2 gates IPC commands
- **MCP Gating**: Cada servidor MCP recebe grants de capacidade explícitos

Para mais informações, veja [docs/architecture/TAURI.md](./docs/architecture/TAURI.md).

---

## Licença

Este projeto é licenciado sob a **MIT License** — veja o arquivo [LICENSE](./LICENSE) para detalhes.

---

## Comunidade

- Discussões: [GitHub Discussions](https://github.com/Hyska-Software/Hyscode/discussions)
- Issues: [Bug Reports & Features](https://github.com/Hyska-Software/Hyscode/issues)
- Email: [dev@hyscode.io](mailto:dev@hyscode.io) *(em breve)*

---

## Créditos

HysCode foi construído por **Estêvão Bonatto** e contribuidores. Obrigado a:

- **Tauri** — framework desktop Rust
- **React** — biblioteca UI
- **shadcn/ui** — componentes acessíveis
- **Tailwind CSS** — estilo utility-first
- **Anthropic, OpenAI, Google** — provedores de IA
- **Comunidade Open Source** — por ferramentas e inspiração

---

## Próximos Passos

Novo no HysCode? Recomendamos:

1. Clonar e executar `pnpm dev`
2. Ler [OVERVIEW.md](./docs/architecture/OVERVIEW.md)
3. Verificar [MILESTONES.md](./docs/MILESTONES.md) para o que vem next
4. Considere contribuir — achamos great desenvolvedores como você!

**Divirta-se codificando com HysCode!**

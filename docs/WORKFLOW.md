# HysCode — Workflow de Contribuição

> **Spec canônica** do sistema de Issues / Branches / PRs do HysCode.
> Este documento é a fonte de verdade — se houver divergência entre ele
> e `AGENTS.md` / `CONTRIBUTING.md`, este documento vence.

---

## 1. Princípios

1. **Issue-first** — todo trabalho (incluindo chores) começa por issue.
2. **PR title = Conventional Commits** — validado por CI; vira a mensagem do squash-merge.
3. **Branch codifica o issue** — formato `<type>/<issue#>-<scope>-<slug>`; validado por CI.
4. **PR body cita o issue** — `Closes #N` ou `Refs #N`; validado por CI.
5. **Agente nunca auto-merge sem rótulo** `workflow:agent-can-merge` aplicado por humano.
6. **Um PR = um issue = um squash** — nunca misturar escopos.
7. **Tudo em PT-BR para issues/PRs**, código e commits em inglês.

---

## 2. Issues

### 2.1 Tipos disponíveis (template `config.yml`)

| Template             | Quando usar                                       |
|----------------------|---------------------------------------------------|
| `bug_report.md`      | Comportamento incorreto ou regressão              |
| `feature_request.md` | Nova funcionalidade                               |
| `agent_task.md`      | Task autônoma para agente de IA executar sozinho  |

Issues em branco são **desabilitadas** — sempre use um template.

### 2.2 Taxonomia de labels (aplicar ao abrir a issue)

#### `type:*` (obrigatório, exatamente um)
- `type:bug` — comportamento incorreto
- `type:feat` — nova funcionalidade
- `type:chore` — manutenção, build, dependência
- `type:refactor` — refatoração sem mudança de comportamento
- `type:perf` — performance
- `type:docs` — apenas documentação
- `type:test` — apenas testes

#### `area:*` (obrigatório, exatamente um)
- `area:desktop` — `apps/desktop`
- `area:agent-harness` — `packages/agent-harness`
- `area:ai-providers` — `packages/ai-providers`
- `area:mcp-client` — `packages/mcp-client`
- `area:skills` — `packages/skills`
- `area:ui` — `packages/ui`
- `area:extension-api` — `packages/extension-api`
- `area:extension-host` — `packages/extension-host`
- `area:lsp-client` — `packages/lsp-client`
- `area:infra` — CI, build, release, dependências
- `area:docs` — `docs/`, README, AGENTS

#### `priority:*` (opcional, no máx. um)
- `priority:p0` — bloqueia release
- `priority:p1` — alvo da próxima release
- `priority:p2` — médio
- `priority:p3` — nice-to-have

#### `status:*` (gerenciado pelo fluxo)
- `status:needs-triage` — acabou de ser criado
- `status:ready` — triado, pronto para implementação
- `status:in-progress` — atribuído e em andamento
- `status:blocked` — aguardando dependência externa
- `status:needs-review` — PR aberto aguardando review
- `status:ready-to-merge` — aprovado, aguardando merge

#### `milestone:*` (alinhado com `docs/MILESTONES.md`)
- `milestone:m0` … `milestone:m7`

#### `workflow:*` (sinais de processo)
- `workflow:agent-tasks` — task que o agente pode executar sozinho
- `workflow:agent-can-merge` — aprovado para auto-merge por agente
- `workflow:good-first-issue` — apropriado para newcomers
- `workflow:help-wanted` — mantenedor aceita contribuições
- `workflow:breaking-change` — mudança incompatível

### 2.3 Título da issue

- **Bug**: `[BUG] <resumo em uma linha>`
- **Feature**: `[FEATURE] <resumo em uma linha>`
- **Agent task**: `[AGENT] <verbo> <objeto> — <contexto>`

### 2.4 Corpo mínimo (aplicam-se a todos os tipos)

```markdown
## Contexto
Por que este trabalho é necessário.

## Critérios de aceitação
- [ ] ...
- [ ] ...

## Plano de teste
1. ...
2. ...
```

---

## 3. Branches

### 3.1 Formato (regex CI)

```
^(feat|fix|chore|refactor|perf|docs|test)/[0-9]+-[a-z0-9][a-z0-9-]*$
```

### 3.2 Componentes

- `<type>`: `feat` | `fix` | `chore` | `refactor` | `perf` | `docs` | `test`
- `<issue#>`: número inteiro da issue (sem `#`)
- `<scope>`: subsistema curto (`agent-harness`, `desktop-pty`, `docs`, etc)
- `<slug>`: 2-5 palavras separadas por `-` (kebab-case ASCII)

### 3.3 Exemplos

| Válido                                      | Por quê                                            |
|---------------------------------------------|----------------------------------------------------|
| `feat/142-agent-harness-streaming-tools`    | type=feat, issue=142, scope=agent-harness          |
| `fix/87-desktop-pty-leak`                   | type=fix, issue=87, scope=desktop-pty              |
| `docs/205-workflow-spec`                    | type=docs, issue=205, scope=workflow-spec          |
| `chore/300-bump-tauri-v2-5`                 | type=chore, issue=300, scope=bump-tauri-v2-5       |

| Inválido                          | Por quê                                |
|-----------------------------------|----------------------------------------|
| `feature/streaming`               | prefix errado, falta issue#            |
| `feat/streaming-tools`            | falta issue#                           |
| `feat/142-Streaming_Tools`        | uppercase/underscore no slug           |
| `feat/142-`                       | slug vazio                             |
| `feat/abc-streaming-tools`        | issue# não é número                    |

### 3.4 Base e proteção

- Toda branch nasce de `main` atualizado: `git fetch <remote> && git switch -c <branch> main` (substitua `<remote>` por `origin`, `hyska`, etc conforme `git remote -v`)
- `main` é protegida: PR obrigatório, 1 aprovação, status checks verdes
- Apenas squash-merge é permitido (configurar em Settings → General → Pull Requests)

---

## 4. Commits

### 4.1 Conventional Commits (obrigatório)

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **Subject**: imperativo, ≤72 chars, sem ponto final
- **Body**: explica o **porquê**, wrapped em 72 cols
- **Footer**: `Refs #N` ou `Closes #N` no PR; no commit, `Refs #N` é suficiente

### 4.2 Tipos permitidos

`feat`, `fix`, `chore`, `refactor`, `perf`, `docs`, `test`, `style`, `build`, `ci`

### 4.3 Atomicidade

- 1 commit = 1 mudança lógica
- Não misture refactor com feature no mesmo commit
- Se precisar de WIP, use `git commit --fixup=<sha>` e rebase antes do PR

### 4.4 Breaking changes

- Adicione `!` após o tipo/scope: `feat(api)!: remove deprecated v1 endpoint`
- Adicione `BREAKING CHANGE: <descrição>` no footer

---

## 5. Pull Requests

### 5.1 Título (PR title = mensagem do squash)

Pattern (validado por `amannn/action-semantic-pull-request`):

```
^(feat|fix|chore|refactor|perf|docs|test)(\([a-z0-9-]+\))?!?: .{3,72}$
```

- Mesmo formato do commit, mas com **primeira letra maiúscula** opcional
- Quando aprovado, este título vira a mensagem do commit no `main`

### 5.2 Body (template obrigatório)

Ver `.github/PULL_REQUEST_TEMPLATE.md`. Seções obrigatórias:

1. **Tipo de Mudança** — checkbox único `type:*`
2. **Issue** — `Closes #N` ou `Refs #N`
3. **Área** — confirme a label `area:*` aplicada automaticamente
4. **Descrição** — 3-5 bullets
5. **Como Testar** — passos executáveis
6. **Checklist Agente** — 9 itens incluindo lint, typecheck, testes, docs
7. **Comando de merge** — para o humano executar

### 5.3 Referência ao issue

| Keyword      | Comportamento                                              |
|--------------|------------------------------------------------------------|
| `Closes #N`  | Fecha a issue #N automaticamente no merge                  |
| `Fixes #N`   | Igual a `Closes` (alias)                                   |
| `Resolves #N`| Igual a `Closes` (alias)                                   |
| `Refs #N`    | Link bidirecional, **não** fecha a issue                   |

- Use `Closes` quando o PR entrega a issue completamente
- Use `Refs` quando o PR é parte de um trabalho maior

### 5.4 Auto-merge (Squash)

- Squash-merge é a **única** estratégia permitida
- O título do PR vira a mensagem do commit no `main`
- Body do PR vira a descrição do commit (extended)
- **Branch é preservada** após merge (sem `--delete-branch`); limpeza fica a critério do humano
- Comandos prontos:
  ```bash
  gh pr merge <N> --squash \
    --body "$(gh pr view <N> --json title -q .title)"
  ```

> Se quiser deletar a branch pontualmente: `git push <remote> --delete <branch>` (manual).

---

## 6. Releases

Gerenciado por `.github/workflows/release.yml` (existente).

- Push em `main` → auto-bump `v{x.y.z}-build.N` como pre-release
- Manual `workflow_dispatch` → versão estável ou pre-release explícita
- Changelog gerado automaticamente a partir de Conventional Commits

---

## 7. Agentes de IA

Agentes (Kilo, Claude Code, etc) **devem**:

1. Ler `AGENTS.md` na raiz antes de qualquer trabalho
2. Usar `docs/AGENT_PLAYBOOK.md` como manual do loop
3. Chamar `scripts/agent-preflight.sh` (ou `.ps1`) antes de abrir PR
4. Criar issue → branch → PR via `gh` CLI
5. Nunca auto-merge sem `workflow:agent-can-merge`

Agentes **nunca devem**:

- Commitar em `main`
- Usar `git push --force` em `main` ou PR aberta
- Abrir PR sem `Closes/Refs #N`
- Misturar escopos em um PR
- Ignorar falha de CI
- Usar placeholders (`TODO`, `FIXME`, `// implement later`)

---

## 8. Referências

- `AGENTS.md` (raiz) — contrato do agente
- `docs/AGENT_PLAYBOOK.md` — passo-a-passo operacional
- `CONTRIBUTING.md` — guia humano de entrada
- `docs/MILESTONES.md` — roadmap M0–M7
- `.github/PULL_REQUEST_TEMPLATE.md` — template de PR
- `.github/ISSUE_TEMPLATE/` — templates de issue
- `.github/labeler.yml` — auto-aplicação de `area:*` e `type:*`
- `.github/labels.yml` — definição canônica das labels
- `.github/CODEOWNERS` — ownership por package
- `scripts/agent-preflight.{sh,ps1}` — validação local pré-PR

---

## 9. URL Canônico

Todas as referências ao repositório neste workflow devem usar:

- **Repo**: `https://github.com/Hyska-Software/Hyscode`
- **Maintainer**: `@Estevaobonatto`
- **Histórico**: `Estevaobonatto/Hyscode` → `hyskasoftware/Hyscode` (user) → `Hyska-Software/Hyscode` (org, 2026-07-01)

Em caso de migração de owner/org, atualize **todos** os arquivos listados
em `AGENTS.md` § "URL Canônico" em um único PR. Use `git grep -E 'github\.com/[A-Za-z0-9_-]+/Hyscode'` para localizar todas as ocorrências.

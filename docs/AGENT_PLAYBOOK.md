# HysCode — Agent Playbook

> **Manual operacional** do loop Issue → Branch → PR para agentes de IA
> trabalhando em `C:\Users\estev\Hyscode`. Lado a lado com `AGENTS.md` (contrato)
> e `docs/WORKFLOW.md` (spec).

---

## 0. Pré-requisitos (uma vez por máquina)

```bash
# 1. gh CLI autenticado com escopos: repo, write:issues, write:pull_request
gh auth status

# 2. Identifique o nome do seu remote (geralmente 'origin' ou 'hyska')
git remote -v

# 3. Repo clonado e em main atualizado (substitua <remote> abaixo)
git fetch <remote>
git checkout main && git pull --rebase <remote> main

# 4. Node 18+, pnpm 10+, Rust 1.70+
node -v && pnpm -v && cargo --version
```

Para criar o token correto: https://github.com/settings/tokens — escopos
mínimos: `repo`, `workflow`.

---

## 1. Recebendo uma task

Quando o usuário pedir trabalho (ex: "adicione streaming tools no agent harness"):

1. **Procure por issue existente**:
   ```bash
   gh issue list --search "streaming tools" --state all
   gh issue list --label "workflow:agent-tasks" --state open
   ```
2. Se **não existir**, crie (ver §3).
3. Se **existir**, comente `"🤖 claiming"` e atribua-se:
   ```bash
   gh issue comment <N> --body "🤖 claiming"
   gh issue edit <N> --add-assignee @me
   ```
4. Adicione a label `status:in-progress`:
   ```bash
   gh issue edit <N> --add-label "status:in-progress"
   ```

---

## 2. Criando issue do zero

Use `gh issue create` com labels e body consistentes:

```bash
gh issue create \
  --title "[AGENT] add streaming tool calls in agent harness" \
  --label "type:feat,area:agent-harness,workflow:agent-tasks,priority:p2" \
  --body "$(cat <<'EOF'
## Contexto
Agent harness precisa expor streaming de tool calls para a UI exibir
cards de tool call em tempo real.

## Critérios de aceitação
- [ ] `packages/agent-harness` emite eventos de tool call durante execução
- [ ] Eventos carregam `toolName`, `args`, `status`, `startedAt`
- [ ] UI consome via hook `useAgentToolCalls()`
- [ ] Testes unitários cobrem happy path + erro

## Plano de teste
1. `pnpm --filter @hyscode/agent-harness test`
2. Manual: rodar `pnpm dev` e observar agent panel
EOF
)"
```

**Nomenclatura de título**:
- Bug: `[BUG] <verbo> <objeto>`
- Feature: `[FEATURE] <verbo> <objeto>`
- Agent task: `[AGENT] <verbo> <objeto> — <contexto>`

---

## 3. Criando branch

```bash
ISSUE=142
TYPE=feat
SCOPE=agent-harness
SLUG=streaming-tool-calls
BRANCH="${TYPE}/${ISSUE}-${SCOPE}-${SLUG}"
REMOTE=$(git remote | head -1)   # ou 'origin' / 'hyska' explicitamente

git fetch "$REMOTE"
git switch -c "$BRANCH" main
```

**Validação do nome** (regex obrigatória):

```
^(feat|fix|chore|refactor|perf|docs|test)/[0-9]+-[a-z0-9][a-z0-9-]*$
```

O `scripts/agent-preflight.sh` valida automaticamente.

---

## 4. Fazendo commits

```bash
git add <files>
git commit -m "$(cat <<'EOF'
feat(agent-harness): stream tool call events to UI

Adiciona EventEmitter para tool calls no harness. UI consome via
useAgentToolCalls() e renderiza cards em tempo real.

Refs #142
EOF
)"
```

**Regras**:

- Imperativo no subject ("add", "fix", "remove") — não "added", "fixes"
- Sem ponto final no subject
- Wrap do body em 72 colunas
- Footer `Refs #N` (ou `Closes #N` se for a entrega completa)
- Atômico: 1 commit = 1 mudança lógica

---

## 5. Pre-flight

Antes de `git push`, **sempre** rode:

```bash
# Unix
./scripts/agent-preflight.sh

# Windows
pwsh -ExecutionPolicy Bypass -File scripts/agent-preflight.ps1
```

O script valida:
- `gh auth status` ok
- Branch name segue o pattern
- Working tree limpo (ou staged apenas)
- PR title (se já existir) segue Conventional Commits
- PR body contém `Closes #N` ou `Refs #N`

Se falhar, **corrija antes de continuar**.

---

## 6. Abrindo PR

```bash
git push -u "$REMOTE" HEAD

gh pr create \
  --title "feat(agent-harness): stream tool call events to UI" \
  --body-file .github/PULL_REQUEST_TEMPLATE.md \
  --base main
```

**Edite o PR body** para preencher:
- Tipo de mudança (checkbox único)
- `Closes #142` ou `Refs #142`
- Descrição em 3-5 bullets
- Como testar (passos numerados)
- Checklist agente (todos os itens)

---

## 7. Lidando com CI falho

```bash
# Ver checks
gh pr checks <N> --watch

# Re-rodar localmente
npm run lint
npm run typecheck
npm test

# Se Rust mudou
cd apps/desktop/src-tauri
cargo fmt
cargo clippy
cargo test
```

**Nunca ignore CI falho**. Se for flaky, re-rode com:
```bash
gh pr checks <N> --watch --fail-fast
```

Se a falha for de **infra** (labeler, sync-labels), comente no PR e peça ao humano.

### 7.1. CI Failure Recovery Playbook

Quando CI falha, siga esta ordem antes de pedir ajuda:

**1. Identifique qual check falhou**
```bash
gh pr checks <N>           # lista todos os checks
gh run view <run-id> --log-failed   # detalhes do job que falhou
```

**2. Categorize a falha**
| Sintoma | Categoria | Ação |
|---------|-----------|------|
| `npm run lint` errors | código | `npm run lint -- --fix`, commit |
| `npm run typecheck` errors | código | corrigir tipos, commit |
| `npm test` falha | código | adicionar/atualizar teste, commit |
| `cargo fmt` / `cargo clippy` | código Rust | rodar `cargo fmt && cargo clippy --fix`, commit |
| `ci-success` (aggregator) failed | transitório | re-rodar: `gh run rerun <run-id>` |
| `pr-lint` failed (branch/title/body) | workflow do agente | corrigir o que pediu, `git commit --amend` ou novo commit |
| `Sync Labels` / `labeler` failed | infra | ver logs; bug conhecido do workflow |
| `Build & Release` failed (cargo) | código Rust | ver `cd apps/desktop/src-tauri && cargo build --release` |

**3. Re-rodar após correção**
- Correção de código: novo commit na branch (mais simples)
- Correção de metadata (branch name, PR title): `git commit --amend --no-edit` para branch, ou edite o PR title no GitHub

**4. Pular CI quando apropriado**
- Apenas mudança de docs em `.md` apenas → use `[skip ci]` no commit subject
- Apenas mudança de CI workflow em `.github/workflows/` → CI não roda automaticamente mesmo (o push só atualiza o workflow)
- **Nunca** use `[skip ci]` em mudança de código

**5. Escalar**
Se após 2 tentativas o mesmo check continua falhando sem causa óbvia, comente no PR pedindo review humano. Não gaste mais de 30min em CI flaky.

---

## 8. Self-review

Antes de pedir review humano, faça self-review:

1. Re-leia o diff completo: `gh pr diff <N>`
2. Verifique que não há `console.log` esquecido, `TODO`, `FIXME`
3. Verifique que testes foram adicionados
4. Verifique que `docs/` foi atualizado se houve mudança de contrato
5. Verifique que `AGENTS.md` foi atualizado se mudou convenção
6. Confirme que o PR body reflete o que foi feito
7. Adicione screenshots/GIFs se houver mudança de UI

---

## 9. Auto-merge

**Por padrão, NÃO faça auto-merge.** Aguarde revisão humana.

A única exceção é se a issue tiver **explicitamente** a label
`workflow:agent-can-merge` aplicada por um humano:

```bash
# Verificar label
gh issue view <N> --json labels -q '.labels[].name' | grep agent-can-merge

# Se aprovada, auto-merge
gh pr merge <N> --squash \
  --body "$(gh pr view <N> --json title -q .title)"
```

Caso contrário, **comente no PR**:
> "🤖 ready for review. Aguardando aprovação humana."

### 9.1. Self-merge (bootstrap trick) — known gap

Em projeto solo, o autor do PR **não pode** auto-aprovar via API mesmo
sendo bypass user. Limitação documentada do GitHub API. Para
mergear seu próprio PR sem co-owner, use o **bootstrap trick**:

```bash
# 1. Desabilitar enforce_admins e required_pull_request_reviews
gh api --method PUT repos/<owner>/<repo>/branches/main/protection \
  --input scripts/disable-reviews.json

# 2. Merge com --admin
gh pr merge <N> --repo <owner>/<repo> --squash --admin \
  --body "<conventional-commit-message>"

# 3. Re-habilitar tudo
./scripts/set-branch-protection.sh
```

Veja `docs/WORKFLOW.md` §9.2 para detalhes e alternativas (UI,
co-owner).

---

## 10. Cenários end-to-end

### 10.1 Feature (`feat`)

```bash
ISSUE=$(gh issue create --title "[FEATURE] hot reload for monaco" \
  --label "type:feat,area:desktop,workflow:agent-tasks" \
  --body "..." | awk '{print $NF}')
REMOTE=$(git remote | head -1)

git fetch "$REMOTE"
git switch -c "feat/${ISSUE##*#}-desktop-monaco-hot-reload" main

# ... implementar ...
git add . && git commit -m "feat(desktop): add monaco hot reload

Refs #${ISSUE##*#}"
./scripts/agent-preflight.sh
git push -u "$REMOTE" HEAD
gh pr create --title "feat(desktop): add monaco hot reload" \
  --body-file .github/PULL_REQUEST_TEMPLATE.md --base main
```

### 10.2 Bug fix (`fix`)

```bash
ISSUE=$(gh issue create --title "[BUG] PTY terminal leaks on panel close" \
  --label "type:bug,area:desktop,priority:p1" \
  --body "..." | awk '{print $NF}')
REMOTE=$(git remote | head -1)

git fetch "$REMOTE"
git switch -c "fix/${ISSUE##*#}-desktop-pty-leak" main

# ... investigar e corrigir ...
git add . && git commit -m "fix(desktop): close PTY on panel unmount

Refs #${ISSUE##*#}"
./scripts/agent-preflight.sh
git push -u "$REMOTE" HEAD
gh pr create --title "fix(desktop): close PTY on panel unmount" \
  --body-file .github/PULL_REQUEST_TEMPLATE.md --base main
```

### 10.3 Refactor (`refactor`)

```bash
ISSUE=$(gh issue create --title "[AGENT] extract tool router registry" \
  --label "type:refactor,area:agent-harness,workflow:agent-tasks" \
  --body "..." | awk '{print $NF}')
REMOTE=$(git remote | head -1)

git fetch "$REMOTE"
git switch -c "refactor/${ISSUE##*#}-agent-harness-tool-router-registry" main

# ... refatorar ...
git add . && git commit -m "refactor(agent-harness): extract tool router registry

Refs #${ISSUE##*#}"
./scripts/agent-preflight.sh
git push -u "$REMOTE" HEAD
gh pr create --title "refactor(agent-harness): extract tool router registry" \
  --body-file .github/PULL_REQUEST_TEMPLATE.md --base main
```

---

## 11. Troubleshooting

| Sintoma                                       | Causa                                       | Solução                                                  |
|-----------------------------------------------|---------------------------------------------|----------------------------------------------------------|
| `gh: Not Found (HTTP 404)` ao criar PR        | Base branch errada                          | Use `--base main`                                        |
| PR-lint falha: "missing Closes/Refs"          | Body do PR sem referência                   | Adicione `Closes #N` no body                             |
| PR-lint falha: "title invalid"                | PR title não é Conventional Commits         | Ajuste: `feat(scope): subject`                           |
| PR-lint falha: "branch name invalid"          | Branch não segue pattern                    | Renomeie: `git branch -m <novo-nome>` e force-push       |
| Labeler não aplica `area:*`                   | Path não bate                               Veja `.github/labeler.yml` e ajuste o path                       |
| CI falha: "lint"                              | Erro de ESLint                              | Rode `npm run lint -- --fix` localmente                  |
| CI falha: "typecheck"                         | Erro de TypeScript                          | Rode `npm run typecheck` localmente                      |
| CI falha: "rust"                              | `cargo clippy` ou `cargo fmt`               | Rode `cargo fmt && cargo clippy --fix` localmente        |
| Stale bot fecha minha issue                   | Issue parada 30+ dias                       | Comente progresso ou peça para reabrir                   |

---

## 12. Referências rápidas

```bash
# Criar issue
gh issue create --title "..." --label "..." --body "..."

# Atribuir e marcar como em progresso
gh issue edit <N> --add-assignee @me --add-label "status:in-progress"

# Criar branch a partir de main
git fetch <remote> && git switch -c <branch> main

# Pre-flight
./scripts/agent-preflight.sh   # ou pwsh scripts/agent-preflight.ps1

# Push e abrir PR
git push -u "$REMOTE" HEAD
gh pr create --title "..." --body-file .github/PULL_REQUEST_TEMPLATE.md --base main

# Ver CI
gh pr checks <N> --watch

# Self-merge (somente com label workflow:agent-can-merge)
gh pr merge <N> --squash \
  --body "$(gh pr view <N> --json title -q .title)"
```

---

## 13. Repositório

- **URL canônico**: `https://github.com/Hyska-Software/Hyscode`
- **Maintainer**: `@Estevaobonatto`

```bash
# Criar issue
gh issue create --title "..." --label "..." --body "..."

# Atribuir e marcar como em progresso
gh issue edit <N> --add-assignee @me --add-label "status:in-progress"

# Criar branch a partir de main
git fetch <remote> && git switch -c <branch> main

# Pre-flight
./scripts/agent-preflight.sh   # ou pwsh scripts/agent-preflight.ps1

# Push e abrir PR
git push -u "$REMOTE" HEAD
gh pr create --title "..." --body-file .github/PULL_REQUEST_TEMPLATE.md --base main

# Ver CI
gh pr checks <N> --watch

# Self-merge (somente com label workflow:agent-can-merge)
gh pr merge <N> --squash \
  --body "$(gh pr view <N> --json title -q .title)"
```

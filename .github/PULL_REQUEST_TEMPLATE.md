<!--
Este template é obrigatório. O PR title deve seguir Conventional Commits
(verificado por CI) e o body deve citar a issue com Closes/Refs.

PR title = Conventional Commits → vira a mensagem do squash-merge.
PR body   = este template preenchido.

Veja docs/WORKFLOW.md §5 para detalhes.
-->

## Tipo de Mudança

Marque **exatamente uma**:

- [ ] `type:bug` — correção que não quebra API
- [ ] `type:feat` — nova funcionalidade
- [ ] `type:chore` — build, dependência, manutenção
- [ ] `type:refactor` — refatoração sem mudança de comportamento
- [ ] `type:perf` — performance
- [ ] `type:docs` — apenas documentação
- [ ] `type:test` — apenas testes

## Issue

<!-- Uma das duas linhas abaixo. CI falha se nenhuma estiver presente. -->

- Closes #<N>
- Refs #<N>

## Área e Milestone

<!-- O labeler aplica `area:*` automaticamente; confirme abaixo. -->

- **Área** (auto): <!-- area:desktop | area:agent-harness | area:ai-providers | area:mcp-client | area:skills | area:ui | area:extension-api | area:extension-host | area:lsp-client | area:infra | area:docs -->
- **Milestone**: <!-- milestone:m0 … milestone:m7 -->

## Descrição

<!-- 3-5 bullets. Explique o quê e o porquê. -->

- ...
- ...
- ...

## Como Testar

<!-- Passos numerados, executáveis do zero. -->

1. `git fetch <remote> && git switch <branch>`
2. `pnpm install`
3. ...
4. Resultado esperado: ...

## Checklist Agente

- [ ] `gh auth status` ok
- [ ] Branch segue `<type>/<issue#>-<scope>-<slug>`
- [ ] PR title segue Conventional Commits
- [ ] `pnpm lint` passa sem erros
- [ ] `pnpm typecheck` passa sem erros
- [ ] `pnpm test` passa (e adicionados testes para mudança)
- [ ] `cargo fmt --check && cargo clippy -- -D warnings` (se Rust mudou)
- [ ] Sem placeholders (`TODO`, `FIXME`, `// implement later`)
- [ ] Sem `console.log` / `println!` de debug
- [ ] Commits atômicos, sem co-mistura de escopo
- [ ] Sem `git push --force` em main ou PR aberta
- [ ] `docs/` atualizado se houve mudança de contrato/arquitetura
- [ ] `AGENTS.md` / `docs/WORKFLOW.md` atualizado se mudou convenção

## Breaking Changes

- [ ] Esta PR **não** introduz breaking change
- [ ] Esta PR introduz breaking change — descrita em `Descrição` e adicionada nota no CHANGELOG

## Screenshots / Vídeos

<!-- Se houver mudança de UI, anexar antes/depois. -->

## Merge (humano executar)

```bash
gh pr merge <N> --squash \
  --body "$(gh pr view <N> --json title -q .title)"
```

> O título deste PR (validado por CI) será a mensagem do commit de squash.
> A branch **não** é deletada automaticamente — fica a critério do humano.

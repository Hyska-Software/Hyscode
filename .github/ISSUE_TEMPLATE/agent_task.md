---
name: Agent Task
about: Task autônoma para agente de IA executar (issue → branch → PR)
title: "[AGENT] "
labels: "workflow:agent-tasks,status:needs-triage"
assignees: ""
---

> **Use este template** quando quiser que um agente de IA (Kilo, Claude Code,
> etc) execute o trabalho end-to-end: criar branch, commitar, abrir PR.
> O agente seguirá `docs/AGENT_PLAYBOOK.md` automaticamente.

---

## Goal

Uma frase declarativa do resultado esperado. Sem ambiguidade.

**Exemplo**: "Adicionar suporte a streaming de tool calls no agent harness para a UI renderizar cards em tempo real."

## Contexto

Por que este trabalho é necessário. Cite issues, ADRs, ou docs relacionadas.

## Escopo (paths permitidos)

Liste explicitamente os paths que o agente pode tocar. Tudo fora desta lista é **out of scope** e o agente deve recusar.

```
packages/agent-harness/src/harness/
apps/desktop/src/hooks/useAgentToolCalls.ts
apps/desktop/src/components/agent/ToolCallCard.tsx
```

## Out of Scope

Liste explicitamente o que **não** deve ser tocado:

- `apps/desktop/src-tauri/` (mudanças Rust exigem review humano)
- `packages/ai-providers/` (escopo de outro owner)
- `docs/architecture/AGENT_HARNESS.md` (apenas se aprovado)

## Critérios de Aceitação

Checkboxes objetivos, verificáveis:

- [ ] `packages/agent-harness` emite eventos `tool:call:start`, `tool:call:end`
- [ ] Eventos carregam `{ toolName, args, status, startedAt, finishedAt }`
- [ ] `useAgentToolCalls()` hook expõe lista reativa
- [ ] `<ToolCallCard />` renderiza estado, args e timing
- [ ] Cobertura de testes ≥ 80% no novo código
- [ ] Sem warnings de TypeScript
- [ ] `pnpm lint` e `pnpm typecheck` passam

## Plano de Teste

1. `pnpm --filter @hyscode/agent-harness test`
2. `pnpm --filter @hyscode/desktop typecheck`
3. Manual: `pnpm dev`, abrir agent panel, executar tool call, observar streaming

## Definition of Done

- [ ] PR aberto com `Closes #<esta-issue>`
- [ ] CI verde (lint, typecheck, test, rust se aplicável)
- [ ] PR-lint verde (branch name, PR title, body com issue)
- [ ] Self-review do agente anexada no PR
- [ ] `docs/AGENT_PLAYBOOK.md` atualizado se o agente descobriu edge case novo

## Permissões Especiais

- [ ] **Auto-merge permitido?** (humano deve aplicar label `workflow:agent-can-merge` na issue)
- [ ] **Permite mudança de API pública?** (se sim, detalhe abaixo)
- [ ] **Permite mudança de schema SQLite?** (se sim, detalhe abaixo)

## Riscos Conhecidos

- ...
- ...

## Referências

- `docs/architecture/AGENT_HARNESS.md`
- `docs/AGENT_PLAYBOOK.md` §10 (cenários end-to-end)
- Issue #N (se aplicável)

## Checklist do Humano (antes de aplicar `workflow:agent-tasks`)

- [ ] Goal é claro e mensurável
- [ ] Escopo e out-of-scope estão delimitados
- [ ] Critérios de aceitação são verificáveis
- [ ] Plano de teste é executável sem dependências externas
- [ ] Permissões especiais estão marcadas
- [ ] Não é trabalho que exija julgamento arquitetural maior

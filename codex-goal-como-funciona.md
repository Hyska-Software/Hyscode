# Como funciona o `/goal` do Codex

## Análise da implementação oficial e guia para criar algo semelhante em uma IDE de agentes

> Documento baseado na implementação do repositório oficial `openai/codex`, analisada em agosto de 2026. O recurso está distribuído entre a TUI, o App Server, a extensão `codex-rs/ext/goal`, o protocolo e a camada de persistência em SQLite.

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [O que o `/goal` realmente é](#2-o-que-o-goal-realmente-é)
3. [Fluxo completo](#3-fluxo-completo)
4. [Modelo de dados](#4-modelo-de-dados)
5. [Máquina de estados](#5-máquina-de-estados)
6. [Responsabilidade de cada camada](#6-responsabilidade-de-cada-camada)
7. [Integração com o ciclo de vida](#7-integração-com-o-ciclo-de-vida)
8. [Continuação automática](#8-continuação-automática)
9. [Prompt interno de steering](#9-prompt-interno-de-steering)
10. [Ferramentas fornecidas ao modelo](#10-ferramentas-fornecidas-ao-modelo)
11. [Accounting de tokens e tempo](#11-accounting-de-tokens-e-tempo)
12. [Orçamento](#12-orçamento)
13. [Persistência e recuperação](#13-persistência-e-recuperação)
14. [Concorrência](#14-concorrência)
15. [App Server e sincronização](#15-app-server-e-sincronização)
16. [Objetivos longos e anexos](#16-objetivos-longos-e-anexos)
17. [Resume e fork](#17-resume-e-fork)
18. [Conclusão e bloqueio](#18-conclusão-e-bloqueio)
19. [Arquitetura recomendada para sua IDE](#19-arquitetura-recomendada-para-sua-ide)
20. [Modelo de banco sugerido](#20-modelo-de-banco-sugerido)
21. [Interfaces TypeScript](#21-interfaces-typescript)
22. [Pseudocódigo do orquestrador](#22-pseudocódigo-do-orquestrador)
23. [Interface visual](#23-interface-visual)
24. [O que copiar e o que melhorar](#24-o-que-copiar-e-o-que-melhorar)
25. [Plano de implementação](#25-plano-de-implementação)
26. [Referências](#26-referências)

---

# 1. Visão geral

O `/goal` do Codex é um sistema de execução persistente de objetivos. Ele não é somente uma instrução adicionada ao prompt e também não é uma única chamada longa ao modelo.

Quando um goal é criado, o Codex passa a manter uma entidade persistida associada à thread. Essa entidade é observada pelo runtime. Quando um turno termina e a thread fica ociosa, o runtime verifica se o objetivo ainda está ativo. Se estiver, um novo turno é iniciado automaticamente.

Fluxo geral:

```text
Usuário cria um objetivo
        ↓
Objetivo é persistido
        ↓
Agente executa um turno
        ↓
Turno termina
        ↓
Runtime verifica o objetivo
        ↓
Objetivo ainda está ativo?
        ├── Não → encerrar o ciclo
        └── Sim → iniciar outro turno automaticamente
```

O ciclo termina quando ocorre uma condição de parada:

- objetivo concluído;
- objetivo bloqueado;
- objetivo pausado;
- orçamento de tokens atingido;
- limite de uso atingido;
- erro terminal;
- objetivo removido pelo usuário.

---

# 2. O que o `/goal` realmente é

Em uma conversa comum, o fluxo é normalmente:

```text
Mensagem do usuário
    ↓
Um turno do agente
    ↓
Resposta final
```

Com um goal ativo:

```text
Criação do goal
    ↓
Turno 1
    ↓
Turno 2 automático
    ↓
Turno 3 automático
    ↓
...
    ↓
Conclusão ou interrupção
```

Cada execução continua sendo um turno normal do agente. A diferença é que existe um orquestrador persistente decidindo quando criar o próximo turno.

## O `/goal` não é

- uma única chamada de API infinita;
- uma recursão mantida dentro do modelo;
- apenas um system prompt;
- uma lista visual de tarefas;
- um processo sem estado persistente.

## O `/goal` é

- uma entidade persistente associada à thread;
- uma máquina de estados;
- um loop dirigido por eventos;
- um sistema de accounting;
- um mecanismo de continuação automática;
- uma camada de controle sobre o runtime do agente.

---

# 3. Fluxo completo

Na TUI do Codex, o slash command é interpretado localmente. O texto não é enviado literalmente ao modelo como uma mensagem comum.

Fluxo aproximado:

```text
ChatComposer
    ↓
SlashCommand::Goal
    ↓
AppEvent::OpenThreadGoalMenu
ou
AppEvent::SetThreadGoalDraft
    ↓
thread/goal/set
    ↓
ThreadGoalRequestProcessor
    ↓
GoalService
    ↓
GoalStore + GoalRuntimeHandle
```

Quando o usuário digita:

```text
/goal Corrigir todos os testes e concluir a migração
```

uma implementação correta deve transformar isso em uma operação da camada de controle:

```http
POST /threads/{threadId}/goal
Content-Type: application/json

{
  "objective": "Corrigir todos os testes e concluir a migração"
}
```

Não faça apenas:

```ts
agent.sendMessage(`/goal ${objective}`);
```

## Control plane

Responsável por:

- criar o objetivo;
- editar o objetivo;
- pausar;
- retomar;
- remover;
- definir orçamento;
- consultar estado;
- emitir eventos;
- agendar continuações.

## Data plane

Responsável por:

- chamar o modelo;
- executar ferramentas;
- editar arquivos;
- executar comandos;
- chamar subagentes;
- produzir evidências;
- retornar mensagens.

A separação entre control plane e data plane torna o recurso previsível, testável e reutilizável por CLI, IDE, app desktop e integrações externas.

---

# 4. Modelo de dados

A implementação mantém um objetivo por thread.

Estrutura simplificada:

```rust
struct ThreadGoal {
    thread_id: ThreadId,
    goal_id: String,
    objective: String,
    status: ThreadGoalStatus,
    token_budget: Option<i64>,
    tokens_used: i64,
    time_used_seconds: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}
```

## Campos

### `thread_id`

Identifica a conversa à qual o objetivo pertence.

### `goal_id`

Identificador único do objetivo. O Codex utiliza UUID.

Ele também funciona como proteção contra operações atrasadas: uma atualização referente ao objetivo antigo não deve modificar um objetivo novo que já o substituiu.

### `objective`

Descrição persistente do que deve ser alcançado.

### `status`

Estado atual da execução.

### `token_budget`

Orçamento opcional de tokens.

### `tokens_used`

Quantidade acumulada de tokens cobrados do objetivo.

### `time_used_seconds`

Tempo total contabilizado para o goal.

### `created_at` e `updated_at`

Datas usadas para persistência, interface, histórico e telemetria.

---

# 5. Máquina de estados

Os estados atuais são:

```text
active
paused
blocked
usage_limited
budget_limited
complete
```

## `active`

O objetivo está ativo e pode gerar novos turnos.

## `paused`

O usuário pausou o objetivo. Nenhuma continuação automática deve ser criada.

## `blocked`

O agente determinou que não consegue continuar sem intervenção humana ou mudança externa.

## `usage_limited`

A execução foi interrompida porque o serviço ou a conta atingiu um limite de uso.

## `budget_limited`

O orçamento de tokens foi atingido.

## `complete`

O objetivo foi concluído.

## Diagrama

```text
none
 │
 │ criar
 ▼
active ────────────────► complete
 │
 ├──── pausar ─────────► paused
 │                        │
 │                        └──── retomar ──► active
 │
 ├──── bloqueio ───────► blocked
 │                        │
 │                        └──── retomar ──► active
 │
 ├──── limite de uso ──► usage_limited
 │                        │
 │                        └──── retomar ──► active
 │
 └──── orçamento ──────► budget_limited
```

A remoção pode acontecer em qualquer estado:

```text
qualquer estado
      │
      └── clear ──► sem goal
```

---

# 6. Responsabilidade de cada camada

A implementação controla quem pode provocar cada transição.

| Operação | Responsável |
|---|---|
| Criar objetivo | Usuário, cliente ou modelo quando explicitamente solicitado |
| Editar objetivo | Usuário ou cliente |
| Pausar | Usuário ou cliente |
| Retomar | Usuário ou cliente |
| Limpar | Usuário ou cliente |
| Marcar como concluído | Modelo |
| Marcar como bloqueado | Modelo |
| Marcar limite de orçamento | Sistema |
| Marcar limite de uso | Sistema |
| Interromper por erro terminal | Runtime |

Essa divisão impede que o modelo:

- aumente o próprio orçamento;
- pause ou retome arbitrariamente;
- ignore um limite de uso;
- transforme um goal pausado em ativo;
- marque como concluído por conveniência do cliente.

---

# 7. Integração com o ciclo de vida

O recurso é registrado como uma extensão do runtime e observa eventos internos.

## Eventos de thread

```text
on_thread_start
on_thread_resume
on_thread_idle
on_thread_stop
```

## Eventos de turno

```text
on_turn_start
on_turn_stop
on_turn_abort
on_turn_error
```

## Outros eventos

```text
on_token_usage
on_tool_finish
```

## `on_thread_start`

- verifica se goals estão habilitados;
- verifica se a thread é persistente;
- cria o `GoalRuntimeHandle`;
- registra o runtime no `GoalService`;
- inicializa o accounting.

## `on_thread_resume`

- restaura o objetivo persistido;
- reconfigura o estado em memória;
- prepara a continuação.

## `on_thread_idle`

- verifica se existe um objetivo ativo;
- inicia um novo turno automático.

## `on_thread_stop`

- remove o runtime do registro em memória.

## `on_turn_start`

- registra o turno atual;
- associa o turno ao `goal_id`;
- configura o baseline de tokens;
- evita contabilizar turnos de planejamento da mesma forma que turnos de execução.

## `on_turn_stop`

- contabiliza progresso;
- atualiza tokens e tempo;
- limpa o estado temporário do turno.

## `on_turn_abort`

- contabiliza o uso antes da interrupção;
- limpa referências ativas.

## `on_turn_error`

- transforma erro terminal em bloqueio;
- transforma erro de quota em `usage_limited`.

## `on_tool_finish`

- contabiliza uso durante o turno;
- detecta o limite de orçamento mais cedo;
- injeta uma instrução para encerrar quando necessário.

---

# 8. Continuação automática

O coração da implementação é o método equivalente a `continue_if_idle`.

Fluxo:

```text
Thread fica idle
    ↓
Runtime adquire lock
    ↓
Verifica se a continuação está adiada
    ↓
Obtém a thread viva
    ↓
Lê o goal persistido
    ↓
Status é active?
    ├── Não → limpar estado ativo
    └── Sim → criar contexto de continuação
                 ↓
          try_start_turn_if_idle
```

Pseudocódigo:

```ts
async function continueIfIdle(threadId: string) {
  const goal = await goalStore.getForThread(threadId);

  if (!goal || goal.status !== "active") {
    return;
  }

  const thread = await threadManager.getThread(threadId);

  await thread.tryStartTurnIfIdle([
    buildGoalContinuationContext(goal),
  ]);
}
```

## Por que usar novos turnos

- contabilizar uso por execução;
- permitir interrupção;
- permitir resume;
- executar compaction;
- processar mensagens humanas;
- atualizar permissões;
- salvar checkpoints;
- recuperar após crash;
- distribuir trabalho entre workers.

## O que evitar

Não use recursão direta:

```ts
async function executeForever() {
  await runAgent();
  return executeForever();
}
```

Prefira uma fila:

```text
TurnCompleted
    ↓
GoalContinuationRequested
    ↓
Worker adquire lease
    ↓
TurnStarted
```

---

# 9. Prompt interno de steering

Para continuar o trabalho, o runtime cria uma mensagem interna específica. Ela não aparece como uma nova mensagem humana.

O Codex transforma o conteúdo em um fragmento de contexto interno com origem `goal`.

O prompt inclui:

- objetivo atual;
- tokens utilizados;
- orçamento total;
- tokens restantes;
- regras de continuidade;
- regras de fidelidade ao escopo;
- regras de verificação;
- critérios de conclusão;
- critérios de bloqueio.

## Objetivo tratado como dado

O conteúdo é escapado e delimitado:

```xml
<objective>
Objetivo fornecido pelo usuário
</objective>
```

O prompt informa ao modelo que o conteúdo é dado fornecido pelo usuário, não uma instrução com prioridade superior.

Isso reduz riscos de prompt injection dentro da própria descrição do objetivo.

## Templates principais

### Continuação

Usado ao iniciar outro turno automaticamente.

### Limite de orçamento

Usado quando o orçamento é atingido.

### Objetivo atualizado

Usado quando o usuário edita o objetivo durante uma execução ativa.

---

# 10. Ferramentas fornecidas ao modelo

O Codex fornece três ferramentas:

```text
get_goal
create_goal
update_goal
```

## `get_goal`

Consulta:

- objetivo;
- status;
- orçamento;
- tokens usados;
- tempo utilizado;
- tokens restantes.

## `create_goal`

Cria um goal novo.

A descrição da ferramenta proíbe o modelo de transformar tarefas comuns em goals sem solicitação explícita.

## `update_goal`

Aceita apenas:

```json
{
  "status": "complete"
}
```

ou:

```json
{
  "status": "blocked"
}
```

O executor rejeita outros estados.

O modelo não pode usar essa ferramenta para:

- pausar;
- retomar;
- aumentar orçamento;
- marcar `usage_limited`;
- marcar `budget_limited`.

## Sugestão para sua IDE

Uma API mais explícita pode ser melhor:

```text
get_goal
create_goal
report_goal_progress
complete_goal
report_goal_blocker
```

---

# 11. Accounting de tokens e tempo

O sistema contabiliza progresso incrementalmente.

Cada turno mantém:

```text
uso atual de tokens
último uso contabilizado
goal_id associado
se o turno deve contar para o goal
```

Também existe um relógio por goal para medir tempo de parede.

## Cálculo de tokens

A fórmula observada é aproximadamente:

```text
tokens cobrados =
    input_tokens
  - cached_input_tokens
  + output_tokens
```

O sistema utiliza deltas.

Exemplo:

```text
Uso anterior: 20.000
Uso atual:    27.500
Delta:         7.500
```

Apenas `7.500` é adicionado.

## Pontos de accounting

- depois de uma ferramenta;
- no fim do turno;
- no abort;
- antes de editar;
- antes de limpar;
- antes de fork;
- ao concluir;
- ao bloquear.

## Accounting após ferramentas

Um turno pode consumir bastante antes de terminar. O hook `on_tool_finish` permite detectar o orçamento no meio do turno e instruir o agente a encerrar.

---

# 12. Orçamento

O goal pode possuir um `token_budget`.

O armazenamento verifica:

```text
tokens_used + token_delta >= token_budget
```

Ao atingir o limite, o status se torna:

```text
budget_limited
```

O runtime injeta uma mensagem pedindo ao agente para:

- não iniciar novo trabalho substancial;
- encerrar o turno em breve;
- resumir o progresso;
- identificar o que falta;
- informar o próximo passo;
- não marcar como concluído só porque o orçamento terminou.

## Limites recomendados para sua IDE

```text
max_tokens
max_turns
max_duration_seconds
max_cost
max_tool_calls
max_consecutive_errors
max_subagents
```

Exemplo:

```ts
interface GoalBudget {
  maxTokens?: number;
  maxTurns?: number;
  maxDurationSeconds?: number;
  maxCostUsd?: number;
  maxToolCalls?: number;
  maxSubagents?: number;
}
```

---

# 13. Persistência e recuperação

O objetivo é salvo no SQLite, separado do histórico comum da conversa.

## Vantagens

- sobrevive ao reinício;
- pode ser consultado sem carregar todo o transcript;
- orçamento fica transacional;
- a interface acessa o estado rapidamente;
- transições ficam auditáveis;
- o runtime recupera a execução.

## Resume

Ao reabrir uma thread:

1. o runtime lê o goal;
2. se estiver ativo, restaura a associação em memória;
3. a interface recebe o snapshot;
4. depois o evento de idle é emitido;
5. a continuação pode começar.

A ordem evita que o próximo turno comece antes de o cliente conhecer o estado atual.

---

# 14. Concorrência

A implementação usa dois mecanismos de serialização importantes.

## Lock do estado

O `goal_state_lock` protege:

- leitura antes da continuação;
- edição externa;
- limpeza;
- transições;
- resume;
- processamento de erro.

Sem esse lock:

```text
1. Runtime lê o Goal A como ativo.
2. Usuário substitui A por B.
3. Runtime inicia um turno usando A.
```

## Lock de accounting

O `progress_accounting_lock` impede dupla cobrança quando duas ferramentas terminam quase simultaneamente.

## `expected_goal_id`

Atualizações podem verificar o identificador esperado:

```sql
UPDATE goals
SET ...
WHERE thread_id = ?
AND goal_id = ?;
```

Isso funciona como compare-and-set.

## Ambiente distribuído

Considere:

- lease por goal;
- versão incremental;
- idempotency keys;
- lock distribuído;
- fila particionada por thread;
- transações;
- controle otimista de concorrência.

---

# 15. App Server e sincronização

O App Server expõe operações JSON-RPC:

```text
thread/goal/set
thread/goal/get
thread/goal/clear
```

E notificações:

```text
thread/goal/updated
thread/goal/cleared
```

## Exemplo de criação

```json
{
  "method": "thread/goal/set",
  "id": 27,
  "params": {
    "threadId": "thr_123",
    "objective": "Reduzir a latência p95 para menos de 120ms",
    "tokenBudget": 200000
  }
}
```

## Exemplo de resposta

```json
{
  "id": 27,
  "result": {
    "goal": {
      "threadId": "thr_123",
      "objective": "Reduzir a latência p95 para menos de 120ms",
      "status": "active",
      "tokenBudget": 200000,
      "tokensUsed": 0,
      "timeUsedSeconds": 0
    }
  }
}
```

## Evento de atualização

```json
{
  "method": "thread/goal/updated",
  "params": {
    "threadId": "thr_123",
    "goal": {
      "status": "active",
      "tokensUsed": 42000
    }
  }
}
```

Isso permite sincronizar IDE, CLI, app desktop e painel web.

---

# 16. Objetivos longos e anexos

Quando a descrição é grande, a TUI materializa o conteúdo como arquivo.

Estrutura aproximada:

```text
$CODEX_HOME/
└── attachments/
    └── <uuid>/
        ├── goal-objective.md
        ├── pasted-text-1.txt
        └── image-1.png
```

O objetivo persistido passa a referenciar o arquivo:

```text
Read the Codex goal objective file at /caminho/goal-objective.md before continuing.
```

Pastes grandes e imagens também podem ser materializados.

## Estrutura sugerida

```ts
interface GoalDefinition {
  summary: string;
  specificationArtifactId?: string;
  referencedFiles: ArtifactReference[];
  referencedImages: ArtifactReference[];
  acceptanceCriteria: AcceptanceCriterion[];
}
```

Mantenha `summary` curto para a interface e guarde a especificação completa em um artefato versionado.

---

# 17. Resume e fork

## Resume

- `active`: pode continuar automaticamente;
- `paused`: pode exigir confirmação para retomar;
- `blocked`: pode ser retomado pelo usuário;
- `usage_limited`: pode continuar quando houver disponibilidade;
- `complete`: permanece encerrado;
- `budget_limited`: permanece limitado até alteração externa.

## Fork

Antes de copiar uma thread, o runtime faz flush do accounting pendente.

O goal pode ser herdado. Também existe a ideia de adiar a continuação para permitir que o usuário configure o fork antes de iniciar novo trabalho.

Modos sugeridos:

```ts
type ForkGoalMode =
  | "do-not-copy"
  | "copy-paused"
  | "copy-and-continue"
  | "copy-and-defer";
```

---

# 18. Conclusão e bloqueio

## Auditoria de conclusão

O prompt interno exige que o agente:

1. derive requisitos concretos do objetivo;
2. identifique evidências necessárias;
3. inspecione o estado atual;
4. verifique todos os requisitos;
5. mantenha o goal ativo se a evidência for fraca ou incompleta;
6. chame `update_goal("complete")` apenas quando tudo estiver comprovado.

Fluxo:

```text
Objetivo
   ↓
Extrair requisitos
   ↓
Identificar evidências
   ↓
Inspecionar estado atual
   ↓
Todos estão comprovados?
   ├── Sim → complete
   └── Não → continuar
```

## Melhoria recomendada

Não deixe toda a validação sob responsabilidade do modelo.

```ts
interface GoalValidator {
  validate(context: GoalValidationContext): Promise<ValidationResult>;
}
```

Exemplos:

- `CommandValidator`;
- `TestValidator`;
- `BuildValidator`;
- `FileExistsValidator`;
- `CoverageValidator`;
- `GitDiffValidator`;
- `ScreenshotValidator`;
- `IssueCriteriaValidator`.

Regra:

```ts
if (modelClaimsComplete && validatorsPassed) {
  markGoalComplete();
} else {
  keepGoalActive();
}
```

## Bloqueio

O Codex orienta o agente a não marcar `blocked` na primeira dificuldade. O mesmo bloqueio deve ocorrer por pelo menos três turnos consecutivos.

```text
Turno 1: blocker detectado → tentar alternativa
Turno 2: mesmo blocker → tentar contornar
Turno 3: mesmo blocker → marcar blocked
```

Persistência sugerida:

```ts
interface GoalBlocker {
  fingerprint: string;
  description: string;
  consecutiveTurns: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}
```

---

# 19. Arquitetura recomendada para sua IDE

```text
┌─────────────────────────────────────────┐
│                 IDE UI                  │
│ composer, goal card, controles, eventos │
└─────────────────────┬───────────────────┘
                      │ RPC
┌─────────────────────▼───────────────────┐
│              Goal Service               │
│ create, edit, pause, resume, clear, get │
└───────────┬──────────────────┬──────────┘
            │                  │
┌───────────▼──────────┐ ┌─────▼──────────────┐
│     Goal Store       │ │     Event Bus      │
│ SQL + artifacts      │ │ updated, paused... │
└───────────┬──────────┘ └─────┬──────────────┘
            │                  │
┌───────────▼──────────────────▼──────────┐
│            Goal Orchestrator             │
│ leases, fila, orçamento, continuação     │
└─────────────────────┬────────────────────┘
                      │
┌─────────────────────▼────────────────────┐
│              Agent Runtime               │
│ turns, tools, shell, files, subagentes   │
└─────────────────────┬────────────────────┘
                      │
┌─────────────────────▼────────────────────┐
│       Validators and Evidence Store      │
│ testes, build, arquivos, screenshots     │
└──────────────────────────────────────────┘
```

## Componentes

### Goal Service

Opera o domínio e valida transições.

### Goal Store

Persiste o estado atual e o histórico relevante.

### Goal Orchestrator

Decide quando iniciar turnos e quando parar.

### Agent Runtime

Executa modelo e ferramentas.

### Evidence Store

Guarda provas de progresso e conclusão.

### Validator Engine

Valida critérios de aceitação.

### Event Bus

Sincroniza UI, workers e observabilidade.

---

# 20. Modelo de banco sugerido

```sql
CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    specification_artifact_id TEXT,

    status TEXT NOT NULL,

    token_budget INTEGER,
    tokens_used INTEGER NOT NULL DEFAULT 0,

    max_turns INTEGER,
    turns_used INTEGER NOT NULL DEFAULT 0,

    time_budget_seconds INTEGER,
    time_used_seconds INTEGER NOT NULL DEFAULT 0,

    cost_budget_micros INTEGER,
    cost_used_micros INTEGER NOT NULL DEFAULT 0,

    version INTEGER NOT NULL DEFAULT 1,

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

## Execuções

```sql
CREATE TABLE goal_runs (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,
    turn_id TEXT,

    status TEXT NOT NULL,
    continuation_reason TEXT,

    started_at INTEGER,
    completed_at INTEGER,

    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,

    error_code TEXT,
    blocker_fingerprint TEXT,

    FOREIGN KEY(goal_id) REFERENCES goals(id)
);
```

## Critérios

```sql
CREATE TABLE goal_criteria (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,

    description TEXT NOT NULL,
    validator_type TEXT,
    validator_config TEXT,

    status TEXT NOT NULL DEFAULT 'pending',

    FOREIGN KEY(goal_id) REFERENCES goals(id)
);
```

## Evidências

```sql
CREATE TABLE goal_evidence (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,
    criterion_id TEXT,

    evidence_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    passed INTEGER NOT NULL,

    created_at INTEGER NOT NULL,

    FOREIGN KEY(goal_id) REFERENCES goals(id),
    FOREIGN KEY(criterion_id) REFERENCES goal_criteria(id)
);
```

## Bloqueios

```sql
CREATE TABLE goal_blockers (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,

    fingerprint TEXT NOT NULL,
    description TEXT NOT NULL,
    consecutive_turns INTEGER NOT NULL DEFAULT 1,

    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,

    FOREIGN KEY(goal_id) REFERENCES goals(id)
);
```

---

# 21. Interfaces TypeScript

## Goal

```ts
type GoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usage_limited"
  | "budget_limited"
  | "complete"
  | "cancelled";

interface Goal {
  id: string;
  threadId: string;

  objective: string;
  specificationArtifactId?: string;

  status: GoalStatus;

  budget: GoalBudget;
  usage: GoalUsage;

  version: number;

  createdAt: Date;
  updatedAt: Date;
}
```

## Budget

```ts
interface GoalBudget {
  maxTokens?: number;
  maxTurns?: number;
  maxDurationSeconds?: number;
  maxCostUsd?: number;
  maxToolCalls?: number;
  maxSubagents?: number;
}
```

## Usage

```ts
interface GoalUsage {
  tokens: number;
  turns: number;
  durationSeconds: number;
  costUsd: number;
  toolCalls: number;
  subagents: number;
}
```

## Goal Service

```ts
interface GoalService {
  create(input: CreateGoalInput): Promise<Goal>;

  updateObjective(input: UpdateGoalObjectiveInput): Promise<Goal>;

  pause(goalId: string): Promise<Goal>;

  resume(goalId: string): Promise<Goal>;

  cancel(goalId: string): Promise<Goal>;

  clear(goalId: string): Promise<void>;

  getById(goalId: string): Promise<Goal | null>;

  getCurrentForThread(threadId: string): Promise<Goal | null>;
}
```

## Orchestrator

```ts
interface GoalOrchestrator {
  onThreadIdle(threadId: string): Promise<void>;

  onTurnStarted(event: TurnStartedEvent): Promise<void>;

  onTurnCompleted(event: TurnCompletedEvent): Promise<void>;

  onTurnFailed(event: TurnFailedEvent): Promise<void>;

  onToolCompleted(event: ToolCompletedEvent): Promise<void>;

  scheduleContinuation(goalId: string): Promise<void>;
}
```

## Evidência

```ts
interface GoalEvidence {
  id: string;
  goalId: string;
  criterionId?: string;

  type:
    | "command"
    | "test"
    | "build"
    | "file"
    | "screenshot"
    | "review"
    | "runtime";

  source: string;
  passed: boolean;
  summary: string;

  artifactId?: string;
  createdAt: Date;
}
```

---

# 22. Pseudocódigo do orquestrador

## Continuação quando idle

```ts
async function continueGoalWhenIdle(
  threadId: string,
): Promise<void> {
  const goal = await goalStore.getCurrentForThread(threadId);

  if (!goal || goal.status !== "active") {
    return;
  }

  const lease = await goalLeaseService.tryAcquire({
    goalId: goal.id,
    ownerId: workerId,
    ttlSeconds: 120,
  });

  if (!lease) {
    return;
  }

  try {
    const thread = await threadStore.get(threadId);

    if (!thread.isIdle) {
      return;
    }

    const budgetResult = checkGoalBudget(goal);

    if (!budgetResult.allowed) {
      await goalStore.transition({
        goalId: goal.id,
        expectedVersion: goal.version,
        status: budgetResult.status,
      });

      return;
    }

    const context = await buildGoalContinuationContext({
      goal,
      recentEvidence: await evidenceStore.recentForGoal(goal.id),
      lastRun: await goalRunStore.getLast(goal.id),
      blockers: await blockerStore.getActive(goal.id),
    });

    await agentRuntime.startTurn({
      threadId,
      source: "goal-continuation",
      internalContext: context,
      metadata: {
        goalId: goal.id,
        goalVersion: goal.version,
      },
    });
  } finally {
    await lease.release();
  }
}
```

## Fim do turno

```ts
async function onGoalTurnCompleted(
  event: GoalTurnCompletedEvent,
): Promise<void> {
  await accounting.flush(event);

  const goal = await goalStore.getById(event.goalId);

  if (!goal || goal.status !== "active") {
    return;
  }

  const budgetResult = checkGoalBudget(goal);

  if (!budgetResult.allowed) {
    await goalStore.transition({
      goalId: goal.id,
      expectedVersion: goal.version,
      status: budgetResult.status,
    });

    return;
  }

  const validation = await goalValidatorEngine.evaluate(goal);

  if (event.modelClaimedComplete && validation.passed) {
    await goalStore.markComplete({
      goalId: goal.id,
      evidenceIds: validation.evidenceIds,
    });

    return;
  }

  const blockerResult = await blockerPolicy.evaluate({
    goal,
    event,
  });

  if (blockerResult.shouldBlock) {
    await goalStore.markBlocked({
      goalId: goal.id,
      blockerId: blockerResult.blockerId,
    });

    return;
  }

  await continuationQueue.enqueue({
    goalId: goal.id,
    threadId: goal.threadId,
    reason: "goal-still-active",
    idempotencyKey: `${goal.id}:${event.turnId}:continuation`,
  });
}
```

## Accounting após ferramenta

```ts
async function onToolCompleted(
  event: ToolCompletedEvent,
): Promise<void> {
  const goal = await goalStore.getCurrentForThread(event.threadId);

  if (!goal || goal.status !== "active") {
    return;
  }

  const delta = accountingState.calculateDelta(event);

  if (delta.tokens === 0 && delta.seconds === 0) {
    return;
  }

  const updatedGoal = await goalStore.addUsage({
    goalId: goal.id,
    expectedVersion: goal.version,
    tokenDelta: delta.tokens,
    timeDeltaSeconds: delta.seconds,
  });

  if (updatedGoal.status === "budget_limited") {
    await agentRuntime.injectInternalContext({
      threadId: event.threadId,
      context: buildBudgetLimitContext(updatedGoal),
    });
  }
}
```

---

# 23. Interface visual

A interface deve mostrar claramente que existe uma execução persistente.

```text
┌─────────────────────────────────────────┐
│ GOAL ACTIVE                             │
│                                         │
│ Migrar autenticação para OAuth 2.1      │
│                                         │
│ Checkpoint atual                        │
│ Implementando rotação de refresh token  │
│                                         │
│ Progresso                               │
│ 4 de 7 critérios verificados            │
│                                         │
│ Uso                                     │
│ 82.4k / 200k tokens                     │
│ 38 minutos                              │
│ 12 turnos                               │
│                                         │
│ [Pause] [Edit] [Stop] [Evidence]        │
└─────────────────────────────────────────┘
```

## Timeline

```text
✓ Requisitos analisados
✓ Nova estrutura criada
✓ Login implementado
● Atualizando refresh tokens
○ Testes de integração
○ Migração de sessões
○ Auditoria final
```

## Comandos sugeridos

```text
/goal
/goal edit
/goal pause
/goal resume
/goal stop
/goal clear
/goal status
/goal evidence
```

## Mensagens durante o goal

Sugestão:

```text
Mensagem comum
- orienta o trabalho atual
- não substitui o objetivo

/goal edit
- altera o objetivo persistido

/goal pause
- impede novos turnos automáticos

/goal stop
- cancela mantendo o histórico

/goal clear
- remove o objetivo da thread
```

---

# 24. O que copiar e o que melhorar

## O que copiar do Codex

1. Goal como estado persistente.
2. Um goal principal por thread.
3. Continuação por novos turnos.
4. Separação entre UI, serviço, runtime e armazenamento.
5. Ferramentas restritas para o modelo.
6. Accounting incremental.
7. Lock separado para estado e accounting.
8. Identificador único do objetivo.
9. Contexto interno específico para continuação.
10. Objetivo tratado como dado não confiável.
11. Estados distintos para orçamento e limite de uso.
12. Eventos para sincronizar clientes.
13. Flush antes de fork ou mutação.
14. Materialização de objetivos grandes.
15. Recuperação após resume.

## O que melhorar

### Critérios estruturados

```ts
interface AcceptanceCriterion {
  id: string;
  description: string;
  validator?: ValidatorConfig;
}
```

### Evidências persistidas

Ligar cada conclusão a provas concretas.

### Validadores determinísticos

Não deixar a auditoria inteira sob responsabilidade do modelo.

### Limite de custo

Controlar custo monetário além de tokens.

### Limite de turnos

Evitar loops longos sem progresso.

### Estado `cancelled`

Não confundir cancelamento com remoção do registro.

### Detecção de repetição

Identificar:

- mesmo erro;
- mesmo comando;
- mesmo arquivo;
- nenhum diff relevante;
- mesmas ferramentas;
- nenhuma nova evidência.

### Subgoals em DAG

```text
Goal principal
 ├── Subgoal backend
 ├── Subgoal frontend
 ├── Subgoal testes
 └── Subgoal documentação
```

O goal principal continua sendo a fonte de verdade.

### Controle de escopo

Mudanças importantes devem exigir confirmação do usuário.

---

# 25. Plano de implementação

## Fase 1 — MVP

- tabela `goals`;
- `GoalService`;
- slash commands;
- status básicos;
- card na interface;
- continuação automática;
- ferramenta `get_goal`;
- ferramenta `complete_goal`;
- limite de turnos;
- cancelamento.

## Fase 2 — Confiabilidade

- accounting de tokens;
- accounting de tempo;
- leases;
- idempotência;
- recuperação após reinício;
- eventos em tempo real;
- `usage_limited`;
- `budget_limited`;
- tratamento de erros repetidos;
- snapshots de estado.

## Fase 3 — Verificação

- critérios de aceitação;
- evidence store;
- validadores;
- completion gate;
- checkpoints;
- timeline;
- auditoria automática.

## Fase 4 — Multiagentes

- subgoals;
- DAG de dependências;
- agentes especializados;
- supervisor;
- orçamento compartilhado;
- consolidação de evidências;
- execução paralela controlada.

## Princípio final

```text
O orquestrador controla o ciclo.

Os agentes executam o trabalho.

Os validadores verificam as evidências.

O usuário controla objetivo, escopo e orçamento.
```

Essa separação transforma o `/goal` de um prompt persistente em um sistema confiável de execução autônoma.

---

# 26. Referências

## Repositório oficial

- Repositório:  
  https://github.com/openai/codex

- Extensão principal:  
  https://github.com/openai/codex/tree/main/codex-rs/ext/goal

- Entrada da extensão:  
  https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/lib.rs

- Runtime:  
  https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/runtime.rs

- Serviço de domínio:  
  https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/api.rs

- Ferramentas do modelo:  
  https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/tool.rs

- Schemas das ferramentas:  
  https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/spec.rs

- Steering:  
  https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/steering.rs

- Accounting:  
  https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/accounting.rs

- Template de continuação:  
  https://github.com/openai/codex/blob/main/codex-rs/ext/goal/templates/goals/continuation.md

- Template de limite:  
  https://github.com/openai/codex/blob/main/codex-rs/ext/goal/templates/goals/budget_limit.md

- Template de objetivo atualizado:  
  https://github.com/openai/codex/blob/main/codex-rs/ext/goal/templates/goals/objective_updated.md

- Modelo persistido:  
  https://github.com/openai/codex/blob/main/codex-rs/state/src/model/thread_goal.rs

- Armazenamento e SQL:  
  https://github.com/openai/codex/blob/main/codex-rs/state/src/runtime/goals.rs

- Dispatch do slash command:  
  https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/slash_dispatch.rs

- Menu do goal:  
  https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/goal_menu.rs

- Ações da TUI:  
  https://github.com/openai/codex/blob/main/codex-rs/tui/src/app/thread_goal_actions.rs

- Arquivos e anexos:  
  https://github.com/openai/codex/blob/main/codex-rs/tui/src/goal_files.rs

- Processador do App Server:  
  https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/thread_goal_processor.rs

- Documentação do App Server:  
  https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

## Documentação oficial

- Codex Changelog:  
  https://developers.openai.com/codex/changelog

- Follow goals:  
  https://developers.openai.com/codex/use-cases/follow-goals

- Slash commands:  
  https://developers.openai.com/codex/cli/slash-commands

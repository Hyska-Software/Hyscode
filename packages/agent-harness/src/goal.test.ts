import { describe, expect, it } from 'vitest';
import type { ToolCallRecord, ToolExecutionContext } from './types';
import {
  budgetLimitFor,
  createGoalTools,
  extractGoalCompletionRequest,
  GOAL_COMPLETION_ACTION,
  GoalService,
  goalToolError,
  parseGoalBudgetInput,
  type GoalRepository,
  type GoalState,
} from './goal';

function createMemoryRepository(): GoalRepository {
  const states = new Map<string, GoalState>();
  return {
    async load(conversationId) {
      const state = states.get(conversationId);
      return state ? structuredClone(state) : null;
    },
    async save(state, expectedVersion) {
      const current = states.get(state.goal.conversationId);
      if (expectedVersion !== null && (current?.goal.version ?? null) !== expectedVersion) {
        throw new Error('goal version conflict');
      }
      states.set(state.goal.conversationId, structuredClone(state));
      return structuredClone(state);
    },
    async clear(conversationId) {
      states.delete(conversationId);
    },
  };
}

function successfulTool(toolName: string): ToolCallRecord {
  return {
    id: `call-${toolName}`,
    toolName,
    input: { command: 'npm test' },
    output: { success: true, output: 'ok' },
    durationMs: 5,
    approved: true,
    timestamp: new Date().toISOString(),
  };
}

function goalToolContext(conversationId: string, overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    workspacePath: 'D:/workspace',
    conversationId,
    toolCallId: 'goal-tool-call',
    signal: new AbortController().signal,
    invoke: async <T>() => undefined as T,
    ...overrides,
  };
}

describe('GoalService', () => {
  it('exposes only the objective at creation and gives the agent a criteria tool', () => {
    const tools = createGoalTools(new GoalService(createMemoryRepository()));
    const createTool = tools.find((tool) => tool.definition.name === 'create_goal');
    const editTool = tools.find((tool) => tool.definition.name === 'edit_goal');
    const createProperties = createTool?.definition.inputSchema.properties as Record<string, unknown>;
    const editProperties = editTool?.definition.inputSchema.properties as Record<string, unknown>;

    expect(createTool?.definition.inputSchema.required).toEqual(['objective']);
    expect(Object.keys(createProperties)).toEqual(['objective']);
    expect(editTool?.definition.inputSchema.required).toEqual(['criteria']);
    expect(editProperties.criteria).toBeDefined();
    expect(editProperties.budget).toBeUndefined();
  });

  it('rejects every goal tool for sub-agents, including reads', async () => {
    const tools = createGoalTools(new GoalService(createMemoryRepository()));
    const subAgentContext = goalToolContext('conversation-delegation', { agentType: 'build', delegationLevel: 1 });

    for (const tool of tools) {
      const result = await tool.execute({}, subAgentContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Only the main agent');
    }

    expect(goalToolError({ agentType: 'build', delegationLevel: 1 })).toContain('Only the main agent');
    expect(goalToolError({ agentType: 'chat', delegationLevel: 0 })).toContain('Build mode only');
    expect(goalToolError({ agentType: 'build', delegationLevel: 0 })).toBeNull();
  });

  it('rejects goal tools outside Build mode', async () => {
    let buildMode = false;
    const tools = createGoalTools(new GoalService(createMemoryRepository()), undefined, () => buildMode);
    const getTool = tools.find((tool) => tool.definition.name === 'get_goal');

    const unavailable = await getTool?.execute({}, goalToolContext('conversation-gated'));
    expect(unavailable).toMatchObject({
      success: false,
      error: 'Goal mode is available in Build mode only.',
    });

    buildMode = true;
    const available = await getTool?.execute({}, goalToolContext('conversation-gated'));
    expect(available).toMatchObject({ success: true, output: 'No persistent goal is active for this conversation.' });
  });

  it('persists one goal per conversation with a bounded runtime budget', async () => {
    const service = new GoalService(createMemoryRepository());
    const created = await service.createGoal('conversation-1', 'project-1', 'Build the feature');

    expect(created.goal.version).toBe(1);
    expect(created.goal.status).toBe('active');
    expect(created.goal.budget).toEqual({
      maxTokens: null,
      maxTurns: 50,
      maxDurationMs: 300_000,
      maxToolCalls: 200,
      maxCostUsd: null,
      maxConsecutiveErrors: null,
    });

    await expect(service.editGoal('conversation-1', {
      objective: 'Build and verify the feature',
    })).rejects.toThrow('expected paused');

    await service.pauseGoal('conversation-1');
    const edited = await service.editGoal('conversation-1', {
      objective: 'Build and verify the feature',
    });

    expect(edited.goal.version).toBe(3);
    expect(edited.goal.objective).toBe('Build and verify the feature');
    expect(edited.goal.budget.maxTurns).toBe(50);
    expect(edited.events.at(-1)?.type).toBe('updated');
    await expect(service.createGoal('conversation-1', 'project-1', 'Another goal')).rejects.toThrow('already has a goal');
  });

  it('verifies deterministic criteria before completing a goal', async () => {
    const service = new GoalService(createMemoryRepository(), undefined, async (criterion) => ({
      passed: criterion.kind === 'tool_success',
      verified: criterion.kind === 'tool_success',
      summary: 'The required tool succeeded.',
    }));
    await service.createGoal('conversation-2', 'project-1', 'Run the checks');
    await service.defineCriteria('conversation-2', [
      { description: 'The test command succeeds', kind: 'tool_success', config: { toolName: 'run_terminal_command' } },
    ]);
    const run = await service.startRun('conversation-2', 'user');

    const decision = await service.finishTurn('conversation-2', {
      runId: run.id,
      turnId: 'turn-1',
      status: 'complete',
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      toolCalls: [successfulTool('run_terminal_command')],
      durationMs: 25,
      completionRequest: { summary: 'Checks completed.', turnId: 'turn-1' },
    });

    expect(decision.state.goal.status).toBe('complete');
    expect(decision.state.goal.verification).toBe('verified');
    expect(decision.state.criteria[0].status).toBe('passed');
    expect(decision.state.evidence.some((evidence) => evidence.verified)).toBe(true);
    expect(decision.shouldContinue).toBe(false);

    const duplicate = await service.finishTurn('conversation-2', {
      runId: run.id,
      turnId: 'turn-1-duplicate',
      status: 'error',
      tokenUsage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
      toolCalls: [],
      durationMs: 100,
    });
    expect(duplicate.reason).toBe('goal turn was already accounted');
    expect(duplicate.state.goal.usage.turns).toBe(1);
  });

  it('does not account a missing or stale run against the current goal', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-stale-run', 'project-1', 'Keep accounting isolated');

    await expect(service.finishTurn('conversation-stale-run', {
      runId: 'missing-run',
      turnId: 'turn-missing',
      status: 'error',
      tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      toolCalls: [],
      durationMs: 1,
    })).rejects.toThrow('was not found');

    const state = await service.getState('conversation-stale-run');
    expect(state?.goal.usage.turns).toBe(0);
  });

  it('recovers an unfinished persisted run before starting after a runtime restart', async () => {
    const repository = createMemoryRepository();
    const firstService = new GoalService(repository);
    await firstService.createGoal('conversation-recovery', 'project-1', 'Recover safely');
    const unfinished = await firstService.startRun('conversation-recovery', 'continuation');

    const restartedService = new GoalService(repository);
    const resumedRun = await restartedService.startRun('conversation-recovery', 'resume');
    const state = await restartedService.getState('conversation-recovery');
    const recovered = state?.runs.find((run) => run.id === unfinished.id);

    expect(recovered?.status).toBe('failed');
    expect(recovered?.error).toContain('Recovered an unfinished goal run');
    expect(resumedRun.id).not.toBe(unfinished.id);
    expect(state?.goal.currentRunId).toBe(resumedRun.id);
  });

  it('requires three distinct turns with the same blocker before blocking', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-3', 'project-1', 'Resolve the issue');

    const first = await service.reportBlocker('conversation-3', 'The service is unavailable', 'service-down', undefined, 'turn-1');
    const second = await service.reportBlocker('conversation-3', 'The service is unavailable', 'service-down', undefined, 'turn-2');
    const third = await service.reportBlocker('conversation-3', 'The service is unavailable', 'service-down', undefined, 'turn-3');

    expect(first.goal.status).toBe('active');
    expect(second.goal.status).toBe('active');
    expect(third.goal.status).toBe('blocked');
    expect(third.blockers[0].consecutiveTurns).toBe(3);
  });

  it('does not count repeated blocker reports inside one Harness turn twice', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-duplicate', 'project-1', 'Avoid false blockers');

    const first = await service.reportBlocker('conversation-duplicate', 'Same turn failure', 'same-turn', undefined, 'turn-1');
    const duplicate = await service.reportBlocker('conversation-duplicate', 'Same turn failure', 'same-turn', undefined, 'turn-1');

    expect(first.blockers[0].consecutiveTurns).toBe(1);
    expect(duplicate.blockers[0].consecutiveTurns).toBe(1);
    expect(duplicate.goal.status).toBe('active');
  });

  it('keeps agent evidence visible without treating it as deterministic proof', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-evidence', 'project-1', 'Collect evidence');
    const configured = await service.defineCriteria('conversation-evidence', [
      { description: 'The final review passes' },
    ]);

    const updated = await service.reportProgress(
      'conversation-evidence',
      'Reviewer checked the changed files.',
      'The review is recorded for the next validation turn.',
      configured.criteria[0]?.id,
      'The review is recorded for the next validation turn.',
      'turn-evidence',
    );

    expect(updated.evidence[0]).toMatchObject({ source: 'agent', passed: true, verified: false });
    expect(updated.criteria[0]?.status).toBe('unproven');
    expect(updated.events.some((event) => event.type === 'evidence')).toBe(true);
  });

  it('keeps autonomous continuation active across turns within budget', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-4', 'project-1', 'Keep working');
    for (const turnId of ['turn-1', 'turn-2']) {
      const run = await service.startRun('conversation-4', 'continuation');
      const decision = await service.finishTurn('conversation-4', {
        runId: run.id,
        turnId,
        status: 'complete',
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        toolCalls: [],
        durationMs: 1000,
      });

      expect(decision.state.goal.status).toBe('active');
      expect(decision.shouldContinue).toBe(true);
    }
  });

  it('stops autonomous continuation when the duration budget is reached', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-4b', 'project-1', 'Keep working');
    const run = await service.startRun('conversation-4b', 'continuation');
    const decision = await service.finishTurn('conversation-4b', {
      runId: run.id,
      turnId: 'turn-1',
      status: 'complete',
      tokenUsage: { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 },
      toolCalls: [],
      durationMs: 7_200_000,
    });

    expect(decision.shouldContinue).toBe(false);
  });

  it('does not complete until the agent defines acceptance criteria', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-no-criteria', 'project-1', 'Define the work first');
    const run = await service.startRun('conversation-no-criteria', 'user');
    const decision = await service.finishTurn('conversation-no-criteria', {
      runId: run.id,
      turnId: 'turn-1',
      status: 'complete',
      tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      toolCalls: [],
      durationMs: 1,
      completionRequest: { summary: 'The work is complete.', turnId: 'turn-1' },
    });

    expect(decision.state.goal.status).toBe('active');
    expect(decision.state.goal.checkpoint).toContain('define acceptance criteria');
    expect(decision.shouldContinue).toBe(true);
  });

  it('does not let a finishing turn override a user pause', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-5', 'project-1', 'Respect pause control');
    const run = await service.startRun('conversation-5', 'user');
    await service.pauseGoal('conversation-5');

    const decision = await service.finishTurn('conversation-5', {
      runId: run.id,
      turnId: 'turn-1',
      status: 'complete',
      tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      toolCalls: [],
      durationMs: 1,
      completionRequest: { summary: 'The model tried to finish.', turnId: 'turn-1' },
    });

    expect(decision.state.goal.status).toBe('paused');
    expect(decision.shouldContinue).toBe(false);
    expect(decision.state.events.at(-1)?.type).toBe('completion_denied');
  });

  it('lets the user edit the execution budget without pausing first', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-budget', 'project-1', 'Stay within limits');

    const edited = await service.editGoal('conversation-budget', {
      budget: { maxTurns: 100, maxDurationMs: 600_000, maxCostUsd: null },
    });

    expect(edited.goal.budget.maxTurns).toBe(100);
    expect(edited.goal.budget.maxDurationMs).toBe(600_000);
    // Untouched fields keep their defaults.
    expect(edited.goal.budget.maxToolCalls).toBe(200);
    expect(edited.events.at(-1)?.type).toBe('updated');
  });

  it('recovers a budget-limited goal through a budget edit and resume', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-recover', 'project-1', 'Recover the budget');
    const run = await service.startRun('conversation-recover', 'user');
    const limited = await service.finishTurn('conversation-recover', {
      runId: run.id,
      turnId: 'turn-1',
      status: 'complete',
      tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      toolCalls: [],
      durationMs: 400_000,
    });
    expect(limited.state.goal.status).toBe('budget_limited');

    await expect(service.resumeGoal('conversation-recover')).rejects.toThrow('Edit the goal budget');

    const edited = await service.editGoal('conversation-recover', { budget: { maxDurationMs: 3_600_000 } });
    expect(edited.goal.status).toBe('budget_limited');
    const resumed = await service.resumeGoal('conversation-recover');
    expect(resumed.goal.status).toBe('active');
    // A fresh run can start again after the budget was raised.
    await expect(service.startRun('conversation-recover', 'user')).resolves.toBeDefined();
  });

  it('validates budget edits and keeps objective edits pause-gated', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-budget-rules', 'project-1', 'Validate edits');

    await expect(service.editGoal('conversation-budget-rules', {
      budget: { maxTurns: -5 },
    })).rejects.toThrow('non-negative');
    await expect(service.editGoal('conversation-budget-rules', {
      budget: { maxTurns: Number.NaN },
    })).rejects.toThrow('non-negative');
    await expect(service.editGoal('conversation-budget-rules', {
      budget: { unknownField: 1 } as never,
    })).rejects.toThrow('Unknown budget field');

    // Objective edits still require a paused goal.
    await expect(service.editGoal('conversation-budget-rules', {
      objective: 'Changed while running',
    })).rejects.toThrow('expected paused');
    await expect(service.editGoal('conversation-budget-rules', {})).rejects.toThrow(
      'At least one goal field must be changed',
    );
  });

  it('maps budget exhaustion to budget_limited and error storms to usage_limited', async () => {
    const service = new GoalService(createMemoryRepository());
    const created = await service.createGoal('conversation-limits', 'project-1', 'Classify limits');

    expect(budgetLimitFor(created.goal.budget, created.goal.usage)).toBeNull();
    expect(budgetLimitFor(created.goal.budget, { ...created.goal.usage, turns: 50 }))
      .toMatchObject({ status: 'budget_limited', reason: 'turn budget reached' });
    // The consecutive-error budget defaults to unlimited: error storms alone
    // do not trip a limit unless the user configures one.
    expect(budgetLimitFor(created.goal.budget, { ...created.goal.usage, consecutiveErrors: 10 })).toBeNull();
    expect(budgetLimitFor(
      { ...created.goal.budget, maxConsecutiveErrors: 3 },
      { ...created.goal.usage, consecutiveErrors: 3 },
    )).toMatchObject({ status: 'usage_limited', reason: 'consecutive error limit reached' });
  });

  it('parses user budget edits with minute durations and unlimited sentinels', () => {
    expect(parseGoalBudgetInput('turns=100 duration=10 tools=none')).toEqual({
      maxTurns: 100,
      maxDurationMs: 600_000,
      maxToolCalls: null,
    });
    expect(parseGoalBudgetInput('tokens=off, cost=unlimited errors=2')).toEqual({
      maxTokens: null,
      maxCostUsd: null,
      maxConsecutiveErrors: 2,
    });
    expect(() => parseGoalBudgetInput('')).toThrow('Provide budget edits');
    expect(() => parseGoalBudgetInput('turns')).toThrow('key=value');
    expect(() => parseGoalBudgetInput('bogus=3')).toThrow('Unknown budget field');
    expect(() => parseGoalBudgetInput('turns=-2')).toThrow('positive number');
  });

  it('extracts the newest completion request onto the real turn id', () => {
    const stale = {
      id: 'call-1',
      toolName: 'complete_goal',
      input: {},
      output: {
        success: true,
        output: 'ok',
        metadata: { action: GOAL_COMPLETION_ACTION, summary: 'Stale claim.', evidence: 'stale', toolCallId: 'wrong-id' },
      },
      durationMs: 1,
      approved: true,
      timestamp: new Date().toISOString(),
    };
    const fresh = {
      ...stale,
      id: 'call-2',
      output: {
        success: true,
        output: 'ok',
        metadata: { action: GOAL_COMPLETION_ACTION, summary: 'Fresh claim.', evidence: 'fresh', toolCallId: 'wrong-id' },
      },
    };
    const request = extractGoalCompletionRequest('turn-real', [stale, fresh]);

    expect(request).toEqual({ summary: 'Fresh claim.', evidence: 'fresh', turnId: 'turn-real' });
    expect(extractGoalCompletionRequest('turn-real', [successfulTool('write_file')])).toBeNull();
  });
});

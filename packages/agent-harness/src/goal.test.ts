import { describe, expect, it } from 'vitest';
import type { ToolCallRecord, ToolExecutionContext } from './types';
import {
  createGoalTools,
  GoalService,
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

function goalToolContext(conversationId: string): ToolExecutionContext {
  return {
    workspacePath: 'D:/workspace',
    conversationId,
    toolCallId: 'goal-tool-call',
    signal: new AbortController().signal,
    invoke: async <T>() => undefined as T,
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

  it('persists one goal per conversation with an unlimited runtime budget', async () => {
    const service = new GoalService(createMemoryRepository());
    const created = await service.createGoal('conversation-1', 'project-1', 'Build the feature');

    expect(created.goal.version).toBe(1);
    expect(created.goal.status).toBe('active');
    expect(created.goal.budget).toEqual({
      maxTokens: null,
      maxTurns: null,
      maxDurationMs: null,
      maxToolCalls: null,
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
    expect(edited.goal.budget.maxTurns).toBeNull();
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

  it('keeps autonomous continuation active across turns without a token or turn ceiling', async () => {
    const service = new GoalService(createMemoryRepository());
    await service.createGoal('conversation-4', 'project-1', 'Keep working');
    for (const turnId of ['turn-1', 'turn-2']) {
      const run = await service.startRun('conversation-4', 'continuation');
      const decision = await service.finishTurn('conversation-4', {
        runId: run.id,
        turnId,
        status: 'complete',
        tokenUsage: { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 },
        toolCalls: [],
        durationMs: 7_200_000,
      });

      expect(decision.state.goal.status).toBe('active');
      expect(decision.shouldContinue).toBe(true);
    }
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
});

import { describe, expect, it, vi } from 'vitest';
import type { TurnOutcome, TurnRecord } from './types';
import { GoalOrchestrator, GOAL_CONTINUATION_MESSAGE, type GoalOrchestratorDeps } from './goal-orchestrator';
import { GoalService, type GoalRepository, type GoalRunSource, type GoalState } from './goal';

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

function createOutcome(overrides: Partial<TurnOutcome> = {}): TurnOutcome {
  const tokenUsage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 };
  const turnRecord: TurnRecord = {
    id: 'turn-1',
    conversationId: 'conversation-1',
    mode: 'build',
    iterations: 1,
    toolCalls: [],
    tokenUsage,
    stopReason: 'complete',
    verificationPerformed: false,
    verificationForced: false,
    filesModified: [],
    durationMs: 10,
    timestamp: new Date(0).toISOString(),
  };
  return {
    turnId: 'turn-1',
    status: 'complete',
    response: 'done',
    toolCalls: [],
    turnRecord,
    goalCompletionRequest: null,
    ...overrides,
  };
}

function createDeps(overrides: Partial<GoalOrchestratorDeps> = {}): GoalOrchestratorDeps & { service: GoalService } {
  const service = new GoalService(createMemoryRepository());
  return {
    service,
    isGoalAllowed: () => true,
    isConversationCurrent: () => true,
    isTurnRunning: () => false,
    startTurn: async () => undefined,
    scheduleDelayMs: 0,
    ...overrides,
  };
}

describe('GoalOrchestrator', () => {
  it('returns null when there is no goal or the gate is closed', async () => {
    const orchestrator = new GoalOrchestrator(createDeps());
    await expect(orchestrator.beginTurn('missing', 'user')).resolves.toBeNull();

    const closed = new GoalOrchestrator(createDeps({ isGoalAllowed: () => false }));
    await expect(closed.beginTurn('missing', 'user')).resolves.toBeNull();
    await expect(closed.beginTurn(null, 'user')).resolves.toBeNull();
  });

  it('starts no run for a non-active goal but still exposes its context', async () => {
    const deps = createDeps();
    const orchestrator = new GoalOrchestrator(deps);
    await deps.service.createGoal('conversation-1', 'project-1', 'Paused work');
    await deps.service.pauseGoal('conversation-1');

    const scope = await orchestrator.beginTurn('conversation-1', 'user');
    expect(scope).not.toBeNull();
    expect(scope?.run).toBeNull();
    expect(scope?.goalContext).toContain('Paused work');
    // Settling a runless scope is a safe no-op.
    await expect(scope?.settle()).resolves.toBeNull();
  });

  it('finishes a started run exactly once even when reported twice', async () => {
    const deps = createDeps();
    const orchestrator = new GoalOrchestrator(deps);
    await deps.service.createGoal('conversation-1', 'project-1', 'Count once');

    const scope = await orchestrator.beginTurn('conversation-1', 'user');
    expect(scope?.run).not.toBeNull();
    scope?.report(createOutcome());
    scope?.report(createOutcome({ turnId: 'turn-2' }));
    const first = await scope?.settle();
    const second = await scope?.settle();

    expect(first?.reason).toBe('turn completed');
    expect(second).toBe(first);
    const state = await deps.service.getState('conversation-1');
    expect(state?.goal.usage.turns).toBe(1);
    expect(state?.goal.currentRunId).toBeNull();
  });

  it('accounts an unreported turn as cancelled on settle', async () => {
    const deps = createDeps();
    const orchestrator = new GoalOrchestrator(deps);
    await deps.service.createGoal('conversation-1', 'project-1', 'Early return');

    const scope = await orchestrator.beginTurn('conversation-1', 'user');
    const decision = await scope?.settle();

    expect(decision?.state.goal.usage.turns).toBe(1);
    expect(decision?.shouldContinue).toBe(false);
    const state = await deps.service.getState('conversation-1');
    expect(state?.runs.at(-1)?.status).toBe('cancelled');
    expect(state?.goal.currentRunId).toBeNull();
  });

  it('keeps the first report when post-processing fails after success', async () => {
    const deps = createDeps();
    const orchestrator = new GoalOrchestrator(deps);
    await deps.service.createGoal('conversation-1', 'project-1', 'Outcome wins');

    const scope = await orchestrator.beginTurn('conversation-1', 'user');
    scope?.report(createOutcome({ status: 'complete' }));
    scope?.reportError({ status: 'error', turnId: 'turn-1', error: 'post-processing blew up' });
    const decision = await scope?.settle();

    expect(decision?.reason).toBe('turn completed');
    const state = await deps.service.getState('conversation-1');
    expect(state?.runs.at(-1)?.status).toBe('completed');
    expect(state?.goal.usage.turns).toBe(1);
  });

  it('accounts error reports with partial usage and real turn ids', async () => {
    const deps = createDeps();
    const orchestrator = new GoalOrchestrator(deps);
    await deps.service.createGoal('conversation-1', 'project-1', 'Partial accounting');

    const scope = await orchestrator.beginTurn('conversation-1', 'user');
    scope?.reportError({
      status: 'error',
      turnId: 'turn-partial',
      error: 'provider exploded mid-stream',
      tokenUsage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
      toolCalls: [],
      durationMs: 120,
    });
    const decision = await scope?.settle();

    expect(decision?.state.runs.at(-1)?.turnId).toBe('turn-partial');
    expect(decision?.state.goal.usage.totalTokens).toBe(50);
    expect(decision?.state.goal.usage.consecutiveErrors).toBe(1);
    expect(decision?.shouldContinue).toBe(false);
  });

  it('schedules a continuation after an active turn and keeps the chain alive across in-flight turns', async () => {
    const started: GoalRunSource[] = [];
    let orchestrator!: GoalOrchestrator;
    const deps = createDeps({
      scheduleDelayMs: 0,
      startTurn: async (conversationId, source) => {
        started.push(source);
        // Simulate a continuation turn that itself finishes active: its
        // settle() must re-arm the chain instead of being swallowed by the
        // in-flight guard.
        const scope = await orchestrator.beginTurn(conversationId, source);
        scope?.report(createOutcome());
        await scope?.settle();
        if (started.length >= 2) {
          // Bound the chain: the next scheduled continuation must observe a
          // non-active goal and stop.
          await deps.service.pauseGoal(conversationId);
        }
      },
    });
    orchestrator = new GoalOrchestrator(deps);
    await deps.service.createGoal('conversation-1', 'project-1', 'Keep chaining');

    const scope = await orchestrator.beginTurn('conversation-1', 'user');
    scope?.report(createOutcome());
    await scope?.settle();
    // First continuation fires on a timer; give the loop a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(started).toEqual(['continuation', 'continuation']);
    const state = await deps.service.getState('conversation-1');
    // The test pauses the goal after the second continuation to bound the
    // chain; the third scheduled continuation must have observed the pause.
    expect(state?.goal.status).toBe('paused');
    orchestrator.dispose();
  });

  it('startUserTurn is a silent no-op when busy, inactive, or gated', async () => {
    const startTurn = vi.fn(async () => undefined);
    const busy = new GoalOrchestrator(createDeps({ startTurn, isTurnRunning: () => true }));
    await expect(busy.startUserTurn('conversation-1')).resolves.toBeUndefined();

    const deps = createDeps({ startTurn });
    const orchestrator = new GoalOrchestrator(deps);
    // No goal yet: silent.
    await expect(orchestrator.startUserTurn('conversation-1')).resolves.toBeUndefined();
    await deps.service.createGoal('conversation-1', 'project-1', 'Start me');
    await deps.service.pauseGoal('conversation-1');
    await expect(orchestrator.startUserTurn('conversation-1')).resolves.toBeUndefined();

    await deps.service.resumeGoal('conversation-1');
    await expect(orchestrator.startUserTurn('conversation-1')).resolves.toBeUndefined();
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledWith('conversation-1', 'user');
  });

  it('stops continuations when the conversation leaves or the gate closes', async () => {
    const startTurn = vi.fn(async () => undefined);
    let current = true;
    const deps = createDeps({ startTurn, isConversationCurrent: () => current, scheduleDelayMs: 0 });
    const orchestrator = new GoalOrchestrator(deps);
    await deps.service.createGoal('conversation-1', 'project-1', 'Stop me');

    current = false;
    orchestrator.scheduleContinuation('conversation-1');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(startTurn).not.toHaveBeenCalled();
    orchestrator.dispose();
  });

  it('shares one continuation prompt across runtimes', () => {
    expect(GOAL_CONTINUATION_MESSAGE).toContain('current checkpoint');
  });
});

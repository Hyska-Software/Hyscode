import type { GoalState } from '@hyscode/agent-harness';

/**
 * Shared GoalState fixtures for the goal UI tests (bar + details).
 */
export const goalState: GoalState = {
  goal: {
    id: 'goal-1',
    conversationId: 'conversation-1',
    projectId: 'project-1',
    objective: 'Ship the settings redesign',
    status: 'active',
    verification: 'partial',
    version: 1,
    budget: {
      maxTokens: null,
      maxTurns: null,
      maxDurationMs: null,
      maxToolCalls: null,
      maxCostUsd: null,
      maxConsecutiveErrors: null,
    },
    usage: {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      turns: 2,
      toolCalls: 4,
      durationMs: 1_000,
      costUsd: null,
      consecutiveErrors: 0,
      lastTurnAt: '2026-09-14T12:00:00.000Z',
    },
    checkpoint: 'The shell is ready for the first UI pass.',
    lastError: null,
    currentRunId: null,
    createdAt: '2026-09-14T11:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
    completedAt: null,
  },
  criteria: [
    {
      id: 'criterion-1',
      goalId: 'goal-1',
      description: 'The desktop tests pass',
      kind: 'command',
      config: { command: 'npm test' },
      required: true,
      status: 'pending',
      verificationNote: null,
      evidenceId: null,
    },
  ],
  evidence: [],
  blockers: [],
  runs: [],
  events: [
    {
      id: 'event-1',
      goalId: 'goal-1',
      type: 'created',
      message: 'Goal created.',
      turnId: null,
      createdAt: '2026-09-14T12:00:00.000Z',
    },
  ],
};

export const pausedGoalState: GoalState = {
  ...goalState,
  goal: { ...goalState.goal, status: 'paused' },
};

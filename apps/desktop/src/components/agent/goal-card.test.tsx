/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalState } from '@hyscode/agent-harness';
import { GoalCard } from './goal-card';
import { useAgentStore } from '@/stores/agent-store';

const bridgeMocks = vi.hoisted(() => ({
  cancelActiveGoal: vi.fn().mockResolvedValue(undefined),
  clearActiveGoal: vi.fn().mockResolvedValue(undefined),
  createActiveGoal: vi.fn().mockResolvedValue(undefined),
  editActiveGoal: vi.fn().mockResolvedValue(undefined),
  pauseActiveGoal: vi.fn().mockResolvedValue(undefined),
  resumeActiveGoal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/active-agent-bridge', () => bridgeMocks);
vi.mock('@/components/ui/dialogs', () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
}));

const goalState: GoalState = {
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

const pausedGoalState: GoalState = {
  ...goalState,
  goal: { ...goalState.goal, status: 'paused' },
};

describe('GoalCard', () => {
  beforeEach(() => {
    useAgentStore.setState({ goal: null });
  });

  afterEach(() => {
    cleanup();
    useAgentStore.setState({ goal: null });
    vi.clearAllMocks();
  });

  it('creates a goal from the inline empty state', async () => {
    render(<GoalCard enabled />);

    fireEvent.click(screen.getByRole('button', { name: 'New goal' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Verify the release workflow' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start goal' }));

    await waitFor(() => {
      expect(bridgeMocks.createActiveGoal).toHaveBeenCalledWith('Verify the release workflow');
    });
  });

  it('edits the objective inline and reports action feedback', async () => {
    useAgentStore.setState({ goal: pausedGoalState });
    render(<GoalCard enabled />);

    expect(screen.queryByText('Acceptance criteria')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand goal details' }));
    expect(screen.getByText('Acceptance criteria')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Criteria' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Budget' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit objective' }));

    const editor = screen.getByRole('textbox', { name: 'Edit objective' });
    fireEvent.change(editor, { target: { value: 'Verify the release workflow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(bridgeMocks.editActiveGoal).toHaveBeenCalledWith({ objective: 'Verify the release workflow' });
      expect(screen.getByText('Goal updated.')).toBeTruthy();
    });
  });

  it('locks objective editing while the goal is running', () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalCard enabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand goal details' }));

    const editButton = screen.getByRole('button', { name: 'Edit objective' });
    expect((editButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Pause the goal to unlock objective editing.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Edit objective' })).toBeNull();
    expect(bridgeMocks.editActiveGoal).not.toHaveBeenCalled();
  });

  it('shows a success notice after pausing a running goal', async () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalCard enabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand goal details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => {
      expect(bridgeMocks.pauseActiveGoal).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Goal paused.')).toBeTruthy();
    });
  });

  it('stays hidden until Goal mode is enabled', () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalCard enabled={false} />);

    expect(screen.queryByText('Ship the settings redesign')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Expand goal details' })).toBeNull();
  });
});

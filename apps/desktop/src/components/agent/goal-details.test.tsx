/* @vitest-environment jsdom */

/**
 * GoalDetails is rendered inline by GoalBar when expanded, so these tests
 * drive the details body through the bar's expand toggle.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalBar } from './goal-bar';
import { budgetLimitedGoalState, goalState, pausedGoalState } from './goal-test-fixtures';
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

function expandDetails(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Expand goal details' }));
}

describe('GoalDetails', () => {
  beforeEach(() => {
    useAgentStore.setState({ goal: null });
  });

  afterEach(() => {
    cleanup();
    useAgentStore.setState({ goal: null });
    vi.clearAllMocks();
  });

  it('edits the objective inline and reports action feedback', async () => {
    useAgentStore.setState({ goal: pausedGoalState });
    render(<GoalBar />);

    expect(screen.queryByText('Acceptance criteria')).toBeNull();
    expandDetails();
    expect(screen.getByText('Acceptance criteria')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Criteria' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Budget' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit objective' }));

    const editor = screen.getByRole('textbox', { name: 'Edit objective' });
    fireEvent.change(editor, { target: { value: 'Verify the release workflow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(bridgeMocks.editActiveGoal).toHaveBeenCalledWith({
        objective: 'Verify the release workflow',
      });
      expect(screen.getByText('Goal updated.')).toBeTruthy();
    });
  });

  it('locks objective editing while the goal is running', () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalBar />);

    expandDetails();

    const editButton = screen.getByRole('button', { name: 'Edit objective' });
    expect((editButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Pause the goal to unlock objective editing.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Edit objective' })).toBeNull();
    expect(bridgeMocks.editActiveGoal).not.toHaveBeenCalled();
  });

  it('shows a success notice after pausing a running goal', async () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalBar />);

    expandDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => {
      expect(bridgeMocks.pauseActiveGoal).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Goal paused.')).toBeTruthy();
    });
  });

  it('stops the goal after confirmation', async () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalBar />);

    expandDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => {
      expect(bridgeMocks.cancelActiveGoal).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Goal stopped.')).toBeTruthy();
    });
  });

  it('edits the budget inline and recovers a budget-limited goal', async () => {
    useAgentStore.setState({ goal: budgetLimitedGoalState });
    render(<GoalBar />);

    expandDetails();
    expect(
      screen.getByText('Execution stopped after reaching the configured budget. Edit the budget, then resume.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit budget' }));

    const turns = screen.getByLabelText('Turns budget limit, empty for unlimited');
    expect((turns as HTMLInputElement).value).toBe('50');
    expect(
      (screen.getByLabelText('Minutes budget limit, empty for unlimited') as HTMLInputElement).value,
    ).toBe('5');
    fireEvent.change(turns, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(bridgeMocks.editActiveGoal).toHaveBeenCalledWith({
        budget: {
          maxTurns: 100,
          maxDurationMs: 300_000,
          maxToolCalls: 200,
          maxTokens: null,
          maxCostUsd: null,
          maxConsecutiveErrors: null,
        },
      });
      expect(screen.getByText('Goal budget updated.')).toBeTruthy();
    });
  });

  it('rejects invalid budget input without calling the bridge', async () => {
    useAgentStore.setState({ goal: pausedGoalState });
    render(<GoalBar />);

    expandDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Edit budget' }));
    fireEvent.change(screen.getByLabelText('Turns budget limit, empty for unlimited'), {
      target: { value: '-5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(
        screen.getByText('Budget "Turns" must be a positive number or empty for unlimited.'),
      ).toBeTruthy();
    });
    expect(bridgeMocks.editActiveGoal).not.toHaveBeenCalled();
  });

  it('offers budget editing while the goal is running', () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalBar />);

    expandDetails();

    expect((screen.getByRole('button', { name: 'Edit budget' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

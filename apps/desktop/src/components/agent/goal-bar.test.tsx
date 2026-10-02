/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalBar } from './goal-bar';
import { EmptyGoalState } from './goal-card-controls';
import { goalState, pausedGoalState } from './goal-test-fixtures';
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

describe('GoalBar', () => {
  beforeEach(() => {
    useAgentStore.setState({ goal: null });
  });

  afterEach(() => {
    cleanup();
    useAgentStore.setState({ goal: null });
    vi.clearAllMocks();
  });

  it('renders nothing when there is no goal', () => {
    render(<GoalBar />);

    expect(screen.queryByText('Goal in progress')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Expand goal details' })).toBeNull();
  });

  it('renders the compact bar whenever a goal exists, regardless of mode', () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalBar />);

    expect(screen.getByText('Goal in progress')).toBeTruthy();
    expect(screen.getByText('Ship the settings redesign')).toBeTruthy();
    expect(screen.getByTitle('Elapsed time')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause goal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear goal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand goal details' })).toBeTruthy();
  });

  it('shows a resume action for a paused goal', () => {
    useAgentStore.setState({ goal: pausedGoalState });
    render(<GoalBar />);

    expect(screen.getByText('Goal paused')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume goal' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause goal' })).toBeNull();
  });

  it('pauses the goal from the bar', async () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Pause goal' }));

    await waitFor(() => {
      expect(bridgeMocks.pauseActiveGoal).toHaveBeenCalledTimes(1);
    });
  });

  it('resumes the goal from the bar', async () => {
    useAgentStore.setState({ goal: pausedGoalState });
    render(<GoalBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Resume goal' }));

    await waitFor(() => {
      expect(bridgeMocks.resumeActiveGoal).toHaveBeenCalledTimes(1);
    });
  });

  it('clears the goal after confirmation', async () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear goal' }));

    await waitFor(() => {
      expect(bridgeMocks.clearActiveGoal).toHaveBeenCalledTimes(1);
    });
  });

  it('toggles the inline details panel', () => {
    useAgentStore.setState({ goal: goalState });
    render(<GoalBar />);

    expect(screen.queryByText('Acceptance criteria')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand goal details' }));
    expect(screen.getByText('Acceptance criteria')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse goal details' }));
    expect(screen.queryByText('Acceptance criteria')).toBeNull();
  });

  it('creates a goal from the inline empty state', async () => {
    render(<EmptyGoalState />);

    fireEvent.click(screen.getByRole('button', { name: 'New goal' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Verify the release workflow' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start goal' }));

    await waitFor(() => {
      expect(bridgeMocks.createActiveGoal).toHaveBeenCalledWith('Verify the release workflow');
    });
  });
});

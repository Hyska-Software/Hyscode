import { describe, expect, it } from 'vitest';
import { syntheticSubAgentState } from './sub-agent-card';

const input = { task: 'Analyze the project', mode: 'review' };

describe('syntheticSubAgentState', () => {
  it('maps a successful tool call to a done entry with its output', () => {
    const state = syntheticSubAgentState('call-1', input, {
      id: 'call-1',
      name: 'spawn_subagent',
      input,
      status: 'success',
      output: 'Review complete.',
      startedAt: 1000,
      completedAt: 2000,
    });

    expect(state).toMatchObject({
      id: 'call-1',
      task: 'Analyze the project',
      mode: 'review',
      status: 'done',
      output: 'Review complete.',
      startedAt: 1000,
      completedAt: 2000,
    });
  });

  it('maps error and cancelled tool calls to terminal entries', () => {
    const failed = syntheticSubAgentState('call-2', input, {
      id: 'call-2',
      name: 'spawn_subagent',
      input,
      status: 'error',
      error: 'Tool timed out after 600000ms.',
      startedAt: 1000,
    });
    expect(failed).toMatchObject({ status: 'error', output: 'Tool timed out after 600000ms.' });

    const cancelled = syntheticSubAgentState('call-3', input, {
      id: 'call-3',
      name: 'spawn_subagent',
      input,
      status: 'cancelled',
      error: 'Tool call cancelled.',
      startedAt: 1000,
    });
    expect(cancelled).toMatchObject({ status: 'cancelled' });
  });

  it('stays running when no tool call was recorded', () => {
    const state = syntheticSubAgentState('call-4', input, undefined);
    expect(state.status).toBe('running');
    expect(state.output).toBe('');
  });
});

import { describe, expect, it } from 'vitest';

import type { TerminalProgress } from '@hyscode/agent-harness';
import type { ToolCallDisplay } from '@/stores/agent-store';

import { projectTerminalProgress } from './terminal-progress';

function progress(overrides: Partial<TerminalProgress> = {}): TerminalProgress {
  return {
    toolCallId: 'tool-1',
    terminalId: 'term-1',
    sequence: 1,
    chunk: 'new',
    state: 'running',
    ...overrides,
  };
}

function current(overrides: Partial<ToolCallDisplay> = {}): ToolCallDisplay {
  return {
    id: 'tool-1',
    name: 'run_terminal_command',
    input: { command: 'echo hi' },
    status: 'running',
    liveOutput: 'old',
    terminalState: 'running',
    outputSequence: 1,
    ...overrides,
  };
}

describe('projectTerminalProgress', () => {
  it('appends only chunks with a newer sequence', () => {
    expect(projectTerminalProgress(current(), progress({ sequence: 2, chunk: '!' }))).toMatchObject({
      liveOutput: 'old!',
      outputSequence: 2,
      terminalState: 'running',
    });
    expect(projectTerminalProgress(current(), progress({ sequence: 1, chunk: 'duplicate' }))).toBeNull();
    expect(projectTerminalProgress(current(), progress({ sequence: 0, chunk: 'stale' }))).toBeNull();
  });

  it('accepts a final state even when its sequence is older, without appending stale output', () => {
    expect(projectTerminalProgress(current(), progress({ sequence: 0, chunk: 'stale', state: 'error' }))).toMatchObject({
      terminalState: 'error',
      outputSequence: 1,
      liveOutput: 'old',
    });
  });

  it('does not reopen a finalized terminal call from a late running event', () => {
    expect(projectTerminalProgress(current({ terminalState: 'complete' }), progress({ sequence: 2 }))).toBeNull();
  });
});

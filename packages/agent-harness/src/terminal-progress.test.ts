import { describe, expect, it } from 'vitest';

import {
  projectTerminalProgress,
  projectTerminalRuntimeSummary,
} from './terminal-progress';

const baseProgress = {
  toolCallId: 'tool-1',
  terminalId: 'terminal-1',
};

describe('terminal progress projection', () => {
  it('allows an initial started state without a sequence advance', () => {
    expect(projectTerminalProgress(undefined, {
      ...baseProgress,
      sequence: 0,
      chunk: '',
      state: 'started',
    })).toMatchObject({ terminalState: 'started', outputSequence: 0 });
  });
  it('allows an initial started state for a zero-sequence placeholder', () => {
    expect(projectTerminalProgress({
      terminalState: undefined,
      outputSequence: 0,
      liveOutput: '',
      failure: null,
      provisional: false,
      canonical: false,
    }, {
      ...baseProgress,
      sequence: 0,
      chunk: '',
      state: 'started',
    })).toMatchObject({ terminalState: 'started', outputSequence: 0 });
  });

  it('rejects stale non-final progress while retaining the current projection', () => {
    expect(projectTerminalProgress({
      terminalId: 'terminal-1',
      terminalState: 'running',
      outputSequence: 4,
      liveOutput: 'new',
      failure: null,
      provisional: false,
      canonical: false,
    }, {
      ...baseProgress,
      sequence: 4,
      chunk: 'stale',
      state: 'running',
    })).toBeNull();
  });

  it('accepts a final state at the current sequence and marks provisional output', () => {
    expect(projectTerminalProgress({
      terminalId: 'terminal-1',
      terminalState: 'running',
      outputSequence: 4,
      liveOutput: 'output',
      failure: null,
      provisional: false,
      canonical: false,
    }, {
      ...baseProgress,
      sequence: 4,
      chunk: '',
      state: 'complete',
    }, { provisional: true })).toMatchObject({
      terminalState: 'complete',
      outputSequence: 4,
      provisional: true,
      canonical: false,
    });
  });

  it('preserves runtime failures across later progress without a replacement failure', () => {
    expect(projectTerminalProgress({
      terminalId: 'terminal-1',
      terminalState: 'running',
      outputSequence: 2,
      liveOutput: 'output',
      failure: { operation: 'reader', message: 'reader failed' },
      provisional: false,
      canonical: false,
    }, {
      ...baseProgress,
      sequence: 3,
      chunk: 'more',
      state: 'running',
    })).toMatchObject({
      outputSequence: 3,
      liveOutput: 'outputmore',
      failure: { operation: 'reader', message: 'reader failed' },
    });
  });

  it('does not allow progress to overwrite canonical terminal state', () => {
    expect(projectTerminalProgress({
      terminalId: 'terminal-1',
      terminalState: 'complete',
      outputSequence: 5,
      liveOutput: 'done',
      failure: null,
      provisional: false,
      canonical: true,
    }, {
      ...baseProgress,
      sequence: 6,
      chunk: 'late',
      state: 'running',
    })).toBeNull();
  });

  it('projects dead runtime summaries as provisional errors', () => {
    expect(projectTerminalRuntimeSummary(undefined, {
      terminalId: 'terminal-1',
      sequence: 7,
      alive: false,
      exitCode: 2,
      failure: null,
    })).toMatchObject({
      terminalState: 'error',
      outputSequence: 7,
      provisional: true,
      failure: {
        operation: 'event',
        message: 'Terminal exited with code 2 before the command completed.',
      },
    });
  });
  it('projects a live runtime failure as a provisional error', () => {
    expect(projectTerminalRuntimeSummary({
      terminalId: 'terminal-1',
      terminalState: 'running',
      outputSequence: 3,
      liveOutput: 'partial',
      failure: null,
      provisional: false,
      canonical: false,
    }, {
      terminalId: 'terminal-1',
      sequence: 3,
      alive: true,
      exitCode: null,
      failure: { operation: 'reader', message: 'reader failed' },
    })).toMatchObject({
      terminalState: 'error',
      provisional: true,
      failure: { operation: 'reader', message: 'reader failed' },
    });
  });
});

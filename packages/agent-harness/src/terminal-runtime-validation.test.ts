import { describe, expect, it } from 'vitest';

import {
  validateTerminalExitEvent,
  validateTerminalSnapshot,
  validateTerminalStopResult,
  TerminalValidationError,
} from './terminal-runtime-validation';

describe('terminal runtime validation', () => {
  it('requires the failure field on full snapshots', () => {
    expect(() => validateTerminalSnapshot({
      data: '',
      fromSequence: 0,
      toSequence: 0,
      truncated: false,
      alive: true,
      exitCode: null,
    })).toThrow(TerminalValidationError);
  });

  it('rejects undefined required failure values', () => {
    expect(() => validateTerminalSnapshot({
      data: '',
      fromSequence: 0,
      toSequence: 0,
      truncated: false,
      alive: true,
      exitCode: null,
      failure: undefined,
    })).toThrow(/failure must be present/);
  });

  it('rejects stop results with an invalid status or failure list', () => {
    expect(() => validateTerminalStopResult({ status: 'stopped', failures: [{}] })).toThrow(TerminalValidationError);
    expect(() => validateTerminalStopResult({ status: 'running', failures: [] })).toThrow(TerminalValidationError);
  });

  it('rejects inherited operation names', () => {
    expect(() => validateTerminalSnapshot({
      data: '',
      fromSequence: 0,
      toSequence: 0,
      truncated: false,
      alive: true,
      exitCode: null,
      failure: { operation: 'toString', message: 'invalid' },
    })).toThrow(/supported terminal operation/);
  });

  it('rejects exit events without an explicit nullable failure', () => {
    expect(() => validateTerminalExitEvent({
      pty_id: 'pty-1',
      sequence: 1,
      code: 0,
    })).toThrow(/failure must be present/);
  });

  it('normalizes valid nullable failures', () => {
    expect(validateTerminalSnapshot({
      data: 'output',
      fromSequence: 1,
      toSequence: 2,
      truncated: false,
      alive: false,
      exitCode: 0,
      failure: null,
    })).toEqual({
      data: 'output',
      fromSequence: 1,
      toSequence: 2,
      truncated: false,
      alive: false,
      exitCode: 0,
      failure: null,
    });
  });
});

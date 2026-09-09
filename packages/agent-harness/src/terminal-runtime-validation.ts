import type {
  TerminalFailureOperation,
  TerminalRuntimeFailure,
  TerminalSnapshot,
  TerminalStopResult,
} from './types';

const FAILURE_OPERATION_FLAGS: Record<TerminalFailureOperation, true> = {
  acquire: true,
  authorize: true,
  subscribe: true,
  snapshot: true,
  write: true,
  interrupt: true,
  kill: true,
  reader: true,
  wait: true,
  protocol: true,
  event: true,
  release: true,
  timeout: true,
};

export class TerminalValidationError extends Error {
  readonly failure: TerminalRuntimeFailure;

  constructor(failure: TerminalRuntimeFailure) {
    super(`[${failure.operation}] ${failure.message}`);
    this.name = 'TerminalValidationError';
    this.failure = failure;
  }
}

export type NormalizedTerminalDataEvent = {
  ptyId: string;
  sequence: number;
  data: string;
};

export type NormalizedTerminalExitEvent = {
  ptyId: string;
  sequence: number;
  code: number | null;
  failure: TerminalRuntimeFailure | null;
};

export function asTerminalRuntimeFailure(
  error: unknown,
  operation: TerminalFailureOperation = 'event',
): TerminalRuntimeFailure {
  if (error instanceof TerminalValidationError) return error.failure;
  if (isTerminalRecord(error) && isTerminalFailure(error.failure)) return error.failure;
  return { operation, message: error instanceof Error ? error.message : String(error) };
}

export function validateTerminalSequence(
  value: unknown,
  field = 'sequence',
  operation: TerminalFailureOperation = 'event',
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throwValidation(operation, `${field} must be a finite non-negative integer.`);
  }
  return value;
}

export function validateTerminalString(
  value: unknown,
  field: string,
  operation: TerminalFailureOperation = 'event',
): string {
  if (typeof value !== 'string') throwValidation(operation, `${field} must be a string.`);
  return value;
}

export function validateTerminalExitCode(
  value: unknown,
  field = 'exitCode',
  operation: TerminalFailureOperation = 'event',
): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throwValidation(operation, `${field} must be null or a finite integer.`);
  }
  return value;
}

export function validateTerminalFailure(
  value: unknown,
  operation: TerminalFailureOperation = 'event',
): TerminalRuntimeFailure | null {
  if (value === undefined || value === null) return null;
  if (!isTerminalRecord(value)) throwValidation(operation, 'failure must be an object or null.');
  const failureOperation = value.operation;
  const message = value.message;
  if (
    typeof failureOperation !== 'string'
    || !Object.prototype.hasOwnProperty.call(FAILURE_OPERATION_FLAGS, failureOperation)
  ) {
    throwValidation(operation, 'failure.operation is not a supported terminal operation.');
  }
  if (typeof message !== 'string' || message.length === 0) {
    throwValidation(operation, 'failure.message must be a non-empty string.');
  }
  return {
    operation: failureOperation as TerminalFailureOperation,
    message,
  };
}

export function validateTerminalSnapshot(value: unknown): TerminalSnapshot {
  if (!isTerminalRecord(value)) throwValidation('snapshot', 'Terminal snapshot must be an object.');
  if (!('failure' in value) || value.failure === undefined) throwValidation('snapshot', 'failure must be present on a terminal snapshot.');
  const data = validateTerminalString(value.data, 'data', 'snapshot');
  const fromSequence = validateTerminalSequence(value.fromSequence, 'fromSequence', 'snapshot');
  const toSequence = validateTerminalSequence(value.toSequence, 'toSequence', 'snapshot');
  if (fromSequence > toSequence) {
    throwValidation('snapshot', 'fromSequence cannot exceed toSequence.');
  }
  if (typeof value.truncated !== 'boolean') {
    throwValidation('snapshot', 'truncated must be a boolean.');
  }
  if (typeof value.alive !== 'boolean') {
    throwValidation('snapshot', 'alive must be a boolean.');
  }
  return {
    data,
    fromSequence,
    toSequence,
    truncated: value.truncated,
    alive: value.alive,
    exitCode: validateTerminalExitCode(value.exitCode, 'exitCode', 'snapshot'),
    failure: validateTerminalFailure(value.failure, 'snapshot'),
  };
}

export function validateTerminalStopResult(value: unknown): TerminalStopResult {
  if (!isTerminalRecord(value)) throwValidation('kill', 'Terminal stop result must be an object.');
  if (value.status !== 'stopped' && value.status !== 'still_running' && value.status !== 'unknown') {
    throwValidation('kill', 'status must be stopped, still_running, or unknown.');
  }
  if (!Array.isArray(value.failures)) {
    throwValidation('kill', 'failures must be an array.');
  }
  return {
    status: value.status,
    failures: value.failures.map((failure) => {
      const normalized = validateTerminalFailure(failure, 'kill');
      if (!normalized) throwValidation('kill', 'failures cannot contain null values.');
      return normalized;
    }),
  };
}

export function validateTerminalDataEvent(value: unknown): NormalizedTerminalDataEvent {
  if (!isTerminalRecord(value)) throwValidation('event', 'PTY data event must be an object.');
  return {
    ptyId: validateTerminalString(value.pty_id, 'pty_id', 'event'),
    sequence: validateTerminalSequence(value.sequence, 'sequence', 'event'),
    data: validateTerminalString(value.data, 'data', 'event'),
  };
}
export function validateTerminalExitEvent(value: unknown): NormalizedTerminalExitEvent {
  if (!isTerminalRecord(value)) throwValidation('event', 'PTY exit event must be an object.');
  if (!('failure' in value) || value.failure === undefined) throwValidation('event', 'failure must be present on a PTY exit event.');
  return {
    ptyId: validateTerminalString(value.pty_id, 'pty_id', 'event'),
    sequence: validateTerminalSequence(value.sequence, 'sequence', 'event'),
    code: validateTerminalExitCode(value.code, 'code', 'event'),
    failure: validateTerminalFailure(value.failure, 'event'),
  };
}

function throwValidation(operation: TerminalFailureOperation, message: string): never {
  throw new TerminalValidationError({ operation, message });
}

export function isTerminalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTerminalFailure(value: unknown): value is TerminalRuntimeFailure {
  if (!isTerminalRecord(value)) return false;
  return typeof value.operation === 'string'
    && Object.prototype.hasOwnProperty.call(FAILURE_OPERATION_FLAGS, value.operation)
    && typeof value.message === 'string'
    && value.message.length > 0;
}

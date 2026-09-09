import type { TerminalProgress, TerminalRuntimeFailure } from './types';

const LIVE_OUTPUT_LIMIT = 65_536;
const FINAL_TERMINAL_STATES: Record<'complete' | 'error' | 'cancelled' | 'background', true> = {
  complete: true,
  error: true,
  cancelled: true,
  background: true,
};

export type TerminalProgressProjectionCurrent = {
  terminalId?: string;
  terminalState?: string;
  outputSequence?: number;
  liveOutput?: string;
  failure?: TerminalRuntimeFailure | null;
  provisional?: boolean;
  canonical?: boolean;
};

export type TerminalProgressProjection = {
  terminalId: string;
  terminalState: TerminalProgress['state'];
  outputSequence: number;
  liveOutput: string;
  failure: TerminalRuntimeFailure | null;
  provisional: boolean;
  canonical: boolean;
};

export type TerminalRuntimeProjectionInput = {
  terminalId: string;
  sequence: number;
  alive: boolean;
  exitCode: number | null;
  failure: TerminalRuntimeFailure | null;
};

/** Project progress while preserving final-state and sequence precedence. */
export function projectTerminalProgress(
  current: TerminalProgressProjectionCurrent | undefined,
  progress: TerminalProgress,
  options: { provisional?: boolean } = {},
): TerminalProgressProjection | null {
  const previousState = current?.terminalState;
  const previousSequence = current?.outputSequence ?? 0;
  const currentIsFinal = isFinalTerminalState(previousState);
  const nextIsFinal = isFinalTerminalState(progress.state);
  const nextIsProvisional = options.provisional === true;
  if (current?.canonical) return null;
  if (currentIsFinal && !nextIsFinal) return null;
  if (currentIsFinal && current?.provisional === false && nextIsProvisional) return null;

  const isInitialStarted =
    progress.state === 'started'
    && current?.terminalState === undefined
    && (current?.outputSequence === undefined || current.outputSequence === 0);
  if (!nextIsFinal && progress.sequence <= previousSequence && !isInitialStarted) return null;

  const chunk = progress.chunk;
  const acceptsChunk = progress.sequence > previousSequence || isInitialStarted;
  const failure = progress.failure ?? current?.failure ?? null;
  return {
    terminalId: progress.terminalId,
    terminalState: progress.state,
    outputSequence: Math.max(previousSequence, progress.sequence),
    liveOutput: `${current?.liveOutput ?? ''}${acceptsChunk ? chunk : ''}`.slice(-LIVE_OUTPUT_LIMIT),
    failure,
    provisional: nextIsProvisional,
    canonical: false,
  };
}

/** Project an exit/failure summary before the canonical tool result arrives. */
export function projectTerminalRuntimeSummary(
  current: TerminalProgressProjectionCurrent | undefined,
  summary: TerminalRuntimeProjectionInput,
): TerminalProgressProjection | null {
  if (summary.alive && !summary.failure) return null;
  const failure = summary.failure ?? {
    operation: 'event' as const,
    message: summary.exitCode === null
      ? 'Terminal exited before the command completed.'
      : `Terminal exited with code ${summary.exitCode} before the command completed.`,
  };
  return projectTerminalProgress(
    current,
    {
      toolCallId: '',
      terminalId: summary.terminalId,
      sequence: summary.sequence,
      chunk: '',
      state: 'error',
      failure,
    },
    { provisional: true },
  );
}

function isFinalTerminalState(state: string | undefined): boolean {
  return state !== undefined && Object.prototype.hasOwnProperty.call(FINAL_TERMINAL_STATES, state);
}

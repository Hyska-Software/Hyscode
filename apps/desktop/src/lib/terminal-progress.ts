import type { TerminalProgress } from '@hyscode/agent-harness';

import type { ToolCallDisplay } from '@/stores/agent-store';

const LIVE_OUTPUT_LIMIT = 65_536;
const FINAL_TERMINAL_STATES = new Set<TerminalProgress['state']>([
  'complete',
  'error',
  'cancelled',
  'background',
]);

/** Project terminal progress without allowing stale events to mutate the UI. */
export function projectTerminalProgress(
  current: Pick<ToolCallDisplay, 'terminalState' | 'outputSequence' | 'liveOutput'> | undefined,
  progress: TerminalProgress,
): Pick<ToolCallDisplay, 'terminalId' | 'terminalState' | 'outputSequence' | 'liveOutput'> | null {
  const previousState = current?.terminalState;
  const previousSequence = current?.outputSequence ?? 0;
  const currentIsFinal = previousState !== undefined && FINAL_TERMINAL_STATES.has(previousState);
  const nextIsFinal = FINAL_TERMINAL_STATES.has(progress.state);

  if (currentIsFinal && !nextIsFinal) return null;
  const isInitialStarted =
    progress.state === 'started' && current?.terminalState === undefined && current?.outputSequence === undefined;
  if (!nextIsFinal && progress.sequence <= previousSequence && !isInitialStarted) return null;

  const chunk = progress.sequence > previousSequence ? progress.chunk : '';
  return {
    terminalId: progress.terminalId,
    terminalState: progress.state,
    outputSequence: Math.max(previousSequence, progress.sequence),
    liveOutput: `${current?.liveOutput ?? ''}${chunk}`.slice(-LIVE_OUTPUT_LIMIT),
  };
}

import { StringDecoder } from 'node:string_decoder';
import type { TerminalRuntimeFailure } from '@hyscode/agent-harness';
import type { TerminalHandoff } from '@hyscode/tui-runtime';
import { normalizeTerminalViewport, sameTerminalViewport, type TerminalViewport } from '@hyscode/tui-runtime';
import { enterAlternateScreen, leaveAlternateScreen } from './input';

const DETACH_BYTE = '\u001d';

export type TerminalHandoffIo = {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  pauseOuter: () => void;
  resumeOuter: () => void;
};

export type TerminalHandoffOutcome =
  | { kind: 'detached' }
  | { kind: 'exited'; exitCode: number | null; failure: TerminalRuntimeFailure | null };

export async function runTerminalHandoff(
  terminal: TerminalHandoff,
  io: TerminalHandoffIo,
): Promise<TerminalHandoffOutcome> {
  if (io.stdin.isTTY !== true || io.stdout.isTTY !== true) {
    throw new Error('Interactive terminal handoff requires a TTY for stdin and stdout.');
  }

  let restored = false;
  let finishPromise: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;
  let handoffError: Error | null = null;
  let resolveCompletion: (() => void) | null = null;
  let writeQueue = Promise.resolve();
  let outcome: TerminalHandoffOutcome | null = null;
  const inputDecoder = new StringDecoder('utf8');
  let pendingViewport: TerminalViewport | null = null;
  let lastRequestedViewport: TerminalViewport | null = null;
  let resizing = false;
  const signals: NodeJS.Signals[] = process.platform === 'win32'
    ? ['SIGINT', 'SIGTERM']
    : ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });

  const recordCleanupError = (action: () => void): void => {
    try {
      action();
    } catch (error: unknown) {
      handoffError ??= toError(error);
    }
  };

  const finish = (
    detachTerminal: boolean,
    exitCode: number | null = null,
    failure: TerminalRuntimeFailure | null = null,
  ): Promise<void> => {
    if (finishPromise) return finishPromise;
    outcome = detachTerminal
      ? { kind: 'detached' }
      : { kind: 'exited', exitCode, failure };
    restored = true;
    finishPromise = (async () => {
      try {
        recordCleanupError(() => io.stdin.off('data', onInput));
        recordCleanupError(() => io.stdout.off('resize', resize));
        recordCleanupError(() => io.stdin.setRawMode?.(false));
        recordCleanupError(() => io.stdin.pause());
        recordCleanupError(() => { inputDecoder.end(); });
        try {
          unsubscribe?.();
        } catch (error: unknown) {
          handoffError ??= toError(error);
        }
        unsubscribe = null;
        for (const signal of signals) {
          recordCleanupError(() => process.off(signal, onSignal));
        }
        await writeQueue.catch((error: unknown) => {
          handoffError ??= toError(error);
        });
        if (detachTerminal) {
          try {
            await terminal.detach();
          } catch (error: unknown) {
            handoffError ??= toError(error);
          }
        }
        recordCleanupError(() => enterAlternateScreen(io.stdout));
        recordCleanupError(() => io.resumeOuter());
      } finally {
        resolveCompletion?.();
      }
    })();
    return finishPromise;
  };

  const resize = (): void => {
    if (restored) return;
    const viewport = normalizeTerminalViewport(io.stdout.columns, io.stdout.rows);
    if (lastRequestedViewport && sameTerminalViewport(lastRequestedViewport, viewport)) return;
    lastRequestedViewport = viewport;
    pendingViewport = viewport;
    if (resizing) return;
    resizing = true;
    void (async () => {
      while (pendingViewport && !restored) {
        const next = pendingViewport;
        pendingViewport = null;
        try {
          await terminal.resize(next);
        } catch (error: unknown) {
          handoffError = toError(error);
          await finish(true);
        }
      }
      resizing = false;
    })();
  };

  const onInput = (chunk: Buffer | string): void => {
    if (restored) return;
    const data = inputDecoder.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const detachIndex = data.indexOf(DETACH_BYTE);
    const forwarded = detachIndex >= 0 ? data.slice(0, detachIndex) : data;
    if (forwarded) {
      writeQueue = writeQueue
        .then(() => terminal.write(forwarded))
        .catch((error: unknown) => {
          handoffError = toError(error);
          void finish(true);
        });
    }
    if (detachIndex >= 0) void finish(true);
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    handoffError = new Error(`Terminal handoff interrupted by ${signal}.`);
    void finish(true);
  };

  try {
    io.pauseOuter();
    leaveAlternateScreen(io.stdout);
    const subscribed = await terminal.subscribe(
      (data) => {
        try {
          io.stdout.write(data);
        } catch (error: unknown) {
          handoffError = toError(error);
          void finish(true);
        }
      },
      (exitCode, failure) => {
        void finish(false, exitCode, failure ?? null);
      },
    );
    if (restored) {
      recordCleanupError(() => subscribed());
    } else {
      unsubscribe = subscribed;
      io.stdin.setRawMode?.(true);
      io.stdin.resume();
      io.stdin.on('data', onInput);
      io.stdout.on('resize', resize);
      for (const signal of signals) process.on(signal, onSignal);
      if (!restored) resize();
    }
    await completion;
  } catch (error) {
    handoffError = toError(error);
    await finish(true);
  } finally {
    if (!restored) await finish(true);
  }

  if (handoffError) throw handoffError;
  if (!outcome) throw new Error('Terminal handoff completed without an outcome.');
  return outcome;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

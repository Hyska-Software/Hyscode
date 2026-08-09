import { StringDecoder } from 'node:string_decoder';
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

export async function runTerminalHandoff(terminal: TerminalHandoff, io: TerminalHandoffIo): Promise<void> {
  if (io.stdin.isTTY !== true || io.stdout.isTTY !== true) {
    throw new Error('Interactive terminal handoff requires a TTY for stdin and stdout.');
  }

  let restored = false;
  let unsubscribe: (() => void) | null = null;
  let handoffError: Error | null = null;
  let resolveCompletion: (() => void) | null = null;
  let writeQueue = Promise.resolve();
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

  const finish = async (detachTerminal: boolean): Promise<void> => {
    if (restored) return;
    restored = true;
    io.stdin.off('data', onInput);
    io.stdout.off('resize', resize);
    io.stdin.setRawMode?.(false);
    io.stdin.pause();
    inputDecoder.end();
    unsubscribe?.();
    unsubscribe = null;
    for (const signal of signals) process.off(signal, onSignal);
    await writeQueue.catch(() => undefined);
    if (detachTerminal) await terminal.detach().catch(() => undefined);
    enterAlternateScreen(io.stdout);
    io.resumeOuter();
    resolveCompletion?.();
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

  io.pauseOuter();
  leaveAlternateScreen(io.stdout);
  try {
    unsubscribe = await terminal.subscribe(
      (data) => io.stdout.write(data),
      () => { void finish(false); },
    );
    io.stdin.setRawMode?.(true);
    io.stdin.resume();
    io.stdin.on('data', onInput);
    io.stdout.on('resize', resize);
    for (const signal of signals) process.on(signal, onSignal);
    resize();
    await completion;
  } catch (error) {
    handoffError = toError(error);
    await finish(true);
  } finally {
    if (!restored) await finish(true);
  }

  if (handoffError) throw handoffError;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

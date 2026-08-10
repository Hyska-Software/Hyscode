import { describe, expect, it, vi } from 'vitest';
import type * as monacoEditor from 'monaco-editor';
import { waitForInlineCompletionDelay } from './inline-completion-controller';

function createToken() {
  let listener: (() => void) | null = null;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested(next: (...args: never[]) => unknown) {
      listener = () => {
        next();
      };
      return { dispose: () => (listener = null) };
    },
  } as unknown as monacoEditor.CancellationToken;

  return {
    token,
    cancel: () => listener?.(),
  };
}

describe('inline completion controller helpers', () => {
  it('waits for the configured debounce delay', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createToken();
      const promise = waitForInlineCompletionDelay(300, fixture.token, new AbortController().signal);

      await vi.advanceTimersByTimeAsync(299);
      expect(await Promise.race([promise, Promise.resolve('pending')])).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops waiting when Monaco cancels the request', async () => {
    const fixture = createToken();
    const promise = waitForInlineCompletionDelay(10_000, fixture.token, new AbortController().signal);

    fixture.cancel();

    await expect(promise).resolves.toBe(false);
  });
});

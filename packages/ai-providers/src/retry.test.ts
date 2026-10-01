import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from './types';
import { normalizeProviderError, parseNDJSONStream, parseSSEStream, withRetry } from './retry';

describe('withRetry cost safety', () => {
  it('does not retry unknown errors that may follow an accepted request', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('connection lost'));
    await expect(withRetry(operation, { maxRetries: 3 })).rejects.toThrow('connection lost');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries explicit pre-response retryable statuses', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('overloaded', 'test', 503))
      .mockResolvedValue('ok');
    await expect(withRetry(operation, { maxRetries: 1, baseDelayMs: 0 })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('retries explicitly retryable pre-response transport failures', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        normalizeProviderError(
          new Error('HTTP request failed: connection refused'),
          'test',
          'connecting',
        ),
      )
      .mockResolvedValue('ok');

    await expect(withRetry(operation, { maxRetries: 1, baseDelayMs: 0 })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('respects provider retry-after and reports the scheduled attempt', async () => {
    const onRetry = vi.fn();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('limited', 'test', 429, true, 0))
      .mockResolvedValue('ok');
    await expect(withRetry(operation, { maxRetries: 1, onRetry })).resolves.toBe('ok');
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(ProviderError), 0);
  });

  it('aborts each timed-out attempt before starting the next one', async () => {
    const attemptSignals: AbortSignal[] = [];
    const operation = vi.fn(
      (signal?: AbortSignal) =>
        new Promise<never>((_, reject) => {
          if (!signal) throw new Error('Attempt signal was not provided');
          attemptSignals.push(signal);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );

    await expect(
      withRetry(operation, {
        maxRetries: 1,
        baseDelayMs: 0,
        requestTimeoutMs: 5,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });

    expect(operation).toHaveBeenCalledTimes(2);
    expect(new Set(attemptSignals).size).toBe(2);
    expect(attemptSignals.map((signal) => signal.aborted)).toEqual([true, true]);
  });

  it('classifies connection failures by phase', () => {
    const connecting = normalizeProviderError(new Error('connection reset'), 'test', 'connecting');
    const streaming = normalizeProviderError(new Error('connection reset'), 'test', 'streaming');
    expect(connecting.retryable).toBe(true);
    expect(streaming.retryable).toBe(false);
    expect(streaming.kind).toBe('stream_interrupted');
  });

  it('rejects malformed NDJSON instead of silently dropping it', async () => {
    const response = new Response('{bad json}\n');
    const consume = async () => {
      for await (const _value of parseNDJSONStream(response)) void _value;
    };
    await expect(consume()).rejects.toMatchObject({ kind: 'invalid_response', phase: 'parsing' });
  });

  it('closes the SSE response body when its async iterator is returned early', async () => {
    let bodyCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: first\n\n'));
      },
      cancel() {
        bodyCancelled = true;
      },
    });
    const iterator = parseSSEStream(new Response(body))[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ value: 'first', done: false });
    await iterator.return?.();

    expect(bodyCancelled).toBe(true);
  });

  it('closes an NDJSON response body when the signal aborts during a pending read', async () => {
    let bodyCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        bodyCancelled = true;
      },
    });
    const controller = new AbortController();
    const iterator = parseNDJSONStream(new Response(body), controller.signal)[
      Symbol.asyncIterator
    ]();
    const pendingRead = iterator.next();

    controller.abort();

    await expect(pendingRead).resolves.toMatchObject({ done: true });
    expect(bodyCancelled).toBe(true);
  });
});

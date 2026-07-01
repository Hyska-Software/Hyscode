import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from './types';
import { normalizeProviderError, parseNDJSONStream, withRetry } from './retry';

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

  it('respects provider retry-after and reports the scheduled attempt', async () => {
    const onRetry = vi.fn();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('limited', 'test', 429, true, 0))
      .mockResolvedValue('ok');
    await expect(withRetry(operation, { maxRetries: 1, onRetry })).resolves.toBe('ok');
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(ProviderError), 0);
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
});

import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from './types';
import { withRetry } from './retry';

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
});

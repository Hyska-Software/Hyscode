import { describe, expect, it } from 'vitest';
import type { TokenUsage } from '@hyscode/ai-providers';
import { getContextUsageMetrics } from './token-usage';

describe('getContextUsageMetrics', () => {
  it('uses peak request input instead of cumulative turn input', () => {
    const usage: TokenUsage = {
      inputTokens: 540_768,
      outputTokens: 10_747,
      totalTokens: 551_515,
      cacheReadTokens: 493_312,
      requestCount: 5,
      lastInputTokens: 118_000,
      peakInputTokens: 122_100,
    };

    expect(getContextUsageMetrics(usage, 1_000_000)).toEqual({
      contextInputTokens: 122_100,
      effectiveInputTokens: 47_456,
      percentage: 0.1221,
    });
  });

  it('falls back to cumulative input for legacy usage records', () => {
    const usage: TokenUsage = {
      inputTokens: 64_000,
      outputTokens: 1_000,
      totalTokens: 65_000,
    };

    expect(getContextUsageMetrics(usage, 128_000).percentage).toBe(0.5);
  });
});

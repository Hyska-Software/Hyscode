import { describe, expect, it } from 'vitest';
import type { TokenUsage } from './types';
import {
  applyPromptCacheAggregate,
  aggregatePromptCacheObservations,
  createPromptCacheObservation,
} from './prompt-cache';

describe('prompt cache metrics', () => {
  it('computes weighted hit rate from the eligible prefix without double counting reads', () => {
    const observations = [
      createPromptCacheObservation({
        cacheEnabled: true,
        providerSupportsCache: true,
        eligiblePrefixTokens: 2_000,
        usage: {
          inputTokens: 2_100,
          outputTokens: 10,
          totalTokens: 2_110,
          cacheReadTokens: 1_900,
          cacheWriteTokens: 100,
        },
      }),
      createPromptCacheObservation({
        cacheEnabled: true,
        providerSupportsCache: true,
        eligiblePrefixTokens: 2_000,
        usage: {
          inputTokens: 2_200,
          outputTokens: 10,
          totalTokens: 2_210,
          cacheReadTokens: 2_000,
          cacheWriteTokens: 0,
        },
      }),
    ];

    const aggregate = aggregatePromptCacheObservations(observations);
    expect(aggregate).toMatchObject({
      eligibleRequests: 2,
      observedRequests: 2,
      hitRequests: 2,
      eligiblePrefixTokens: 4_000,
      measuredEligiblePrefixTokens: 4_000,
      cacheReadTokens: 3_900,
      weightedHitRate: 0.975,
      inputCacheReadRatio: 3_900 / 4_300,
    });

    const usage: TokenUsage = { inputTokens: 4_300, outputTokens: 20, totalTokens: 4_320 };
    applyPromptCacheAggregate(usage, aggregate);
    expect(usage.cacheMeasuredReadTokens).toBe(3_900);
  });

  it('does not let raw reads from unsupported or ineligible requests inflate the measured rate', () => {
    const aggregate = aggregatePromptCacheObservations([
      createPromptCacheObservation({
        cacheEnabled: true,
        providerSupportsCache: false,
        eligiblePrefixTokens: 2_000,
        usage: {
          inputTokens: 2_000,
          outputTokens: 1,
          totalTokens: 2_001,
          cacheReadTokens: 2_000,
        },
      }),
      createPromptCacheObservation({
        cacheEnabled: true,
        providerSupportsCache: true,
        eligiblePrefixTokens: 2_000,
        usage: {
          inputTokens: 2_000,
          outputTokens: 1,
          totalTokens: 2_001,
          cacheReadTokens: 2_000,
        },
      }),
    ]);

    expect(aggregate).toMatchObject({
      cacheReadTokens: 2_000,
      measuredEligiblePrefixTokens: 2_000,
      weightedHitRate: 1,
      unknownRequests: 1,
    });
  });

  it('keeps unsupported, ineligible and unreported requests out of the hit denominator', () => {
    const observations = [
      createPromptCacheObservation({
        cacheEnabled: true,
        providerSupportsCache: false,
        eligiblePrefixTokens: 2_000,
        usage: { inputTokens: 2_000, outputTokens: 1, totalTokens: 2_001 },
      }),
      createPromptCacheObservation({
        cacheEnabled: true,
        providerSupportsCache: true,
        eligiblePrefixTokens: 512,
        usage: { inputTokens: 512, outputTokens: 1, totalTokens: 513 },
      }),
      createPromptCacheObservation({
        cacheEnabled: true,
        providerSupportsCache: true,
        eligiblePrefixTokens: 2_000,
        usage: { inputTokens: 2_000, outputTokens: 1, totalTokens: 2_001 },
      }),
    ];

    expect(aggregatePromptCacheObservations(observations)).toMatchObject({
      totalRequests: 3,
      eligibleRequests: 1,
      observedRequests: 0,
      ineligibleRequests: 1,
      unknownRequests: 2,
      weightedHitRate: null,
      requestHitRate: null,
      unknownRate: 2 / 3,
    });
  });
});

import type {
  PromptCacheAggregate,
  PromptCacheObservation,
  PromptCacheObservationStatus,
  TokenUsage,
} from './types';

const MIN_CACHEABLE_PREFIX_TOKENS = 1_024;

export function createPromptCacheObservation(input: {
  usage?: TokenUsage;
  eligiblePrefixTokens?: number;
  cacheEnabled: boolean;
  providerSupportsCache: boolean;
  prefixHash?: string;
  promptCacheKeyHash?: string;
  attempt?: number;
}): PromptCacheObservation {
  const usage = input.usage;
  const inputTokens = Math.max(0, usage?.inputTokens ?? 0);
  const eligiblePrefixTokens = Math.max(
    0,
    input.eligiblePrefixTokens ?? inputTokens,
  );
  const reportedCacheReadTokens = clampTokens(usage?.cacheReadTokens ?? 0, inputTokens);
  const reportedCacheWriteTokens = clampTokens(usage?.cacheWriteTokens ?? 0, inputTokens);
  const providerReported =
    usage?.cacheReadTokens !== undefined || usage?.cacheWriteTokens !== undefined;
  const eligible =
    input.cacheEnabled &&
    input.providerSupportsCache &&
    eligiblePrefixTokens >= MIN_CACHEABLE_PREFIX_TOKENS;
  const cacheReadTokens = eligible
    ? Math.min(reportedCacheReadTokens, eligiblePrefixTokens)
    : reportedCacheReadTokens;
  const cacheWriteTokens = eligible
    ? Math.min(reportedCacheWriteTokens, eligiblePrefixTokens)
    : reportedCacheWriteTokens;

  const status = resolveStatus({
    eligible,
    providerReported,
    providerSupportsCache: input.providerSupportsCache,
    cacheReadTokens,
  });

  return {
    status,
    eligible,
    providerReported,
    inputTokens,
    eligiblePrefixTokens: eligible ? eligiblePrefixTokens : 0,
    cacheReadTokens,
    cacheWriteTokens,
    prefixHash: input.prefixHash,
    promptCacheKeyHash: input.promptCacheKeyHash,
    attempt: input.attempt,
  };
}

export function aggregatePromptCacheObservations(
  observations: PromptCacheObservation[],
): PromptCacheAggregate {
  const aggregate: PromptCacheAggregate = {
    totalRequests: observations.length,
    eligibleRequests: 0,
    observedRequests: 0,
    hitRequests: 0,
    missRequests: 0,
    ineligibleRequests: 0,
    unknownRequests: 0,
    inputTokens: 0,
    eligiblePrefixTokens: 0,
    measuredEligiblePrefixTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    weightedHitRate: null,
    inputCacheReadRatio: null,
    requestHitRate: null,
    unknownRate: observations.length === 0 ? 0 : 0,
  };

  for (const observation of observations) {
    aggregate.inputTokens += observation.inputTokens;

    if (!observation.eligible) {
      if (observation.status === 'ineligible') aggregate.ineligibleRequests++;
      else aggregate.unknownRequests++;
      continue;
    }

    aggregate.eligibleRequests++;
    aggregate.eligiblePrefixTokens += observation.eligiblePrefixTokens;

    if (!observation.providerReported) {
      aggregate.unknownRequests++;
      continue;
    }

    aggregate.observedRequests++;
    aggregate.measuredEligiblePrefixTokens += observation.eligiblePrefixTokens;
    aggregate.cacheReadTokens += observation.cacheReadTokens;
    aggregate.cacheWriteTokens += observation.cacheWriteTokens;
    if (observation.cacheReadTokens > 0) aggregate.hitRequests++;
    else aggregate.missRequests++;
  }

  if (aggregate.measuredEligiblePrefixTokens > 0) {
    aggregate.weightedHitRate =
      aggregate.cacheReadTokens / aggregate.measuredEligiblePrefixTokens;
  }
  if (aggregate.inputTokens > 0) {
    aggregate.inputCacheReadRatio = aggregate.cacheReadTokens / aggregate.inputTokens;
  }
  if (aggregate.observedRequests > 0) {
    aggregate.requestHitRate = aggregate.hitRequests / aggregate.observedRequests;
  }
  if (aggregate.totalRequests > 0) {
    aggregate.unknownRate = aggregate.unknownRequests / aggregate.totalRequests;
  }

  return aggregate;
}

export function applyPromptCacheAggregate(
  usage: TokenUsage,
  aggregate: PromptCacheAggregate,
): void {
  usage.cacheMeasuredReadTokens = aggregate.cacheReadTokens;
  usage.cacheEligibleTokens = aggregate.eligiblePrefixTokens;
  usage.cacheMeasuredEligibleTokens = aggregate.measuredEligiblePrefixTokens;
  usage.cacheHitRequests = aggregate.hitRequests;
  usage.cacheObservedRequests = aggregate.observedRequests;
  usage.cacheTotalRequests = aggregate.totalRequests;
  usage.cacheUnknownRequests = aggregate.unknownRequests;
  if (aggregate.weightedHitRate !== null) usage.cacheHitRate = aggregate.weightedHitRate;
  if (aggregate.inputCacheReadRatio !== null) {
    usage.cacheInputReadRatio = aggregate.inputCacheReadRatio;
  }
  if (aggregate.requestHitRate !== null) usage.cacheRequestHitRate = aggregate.requestHitRate;
  usage.cacheUnknownRate = aggregate.unknownRate;
}

export { MIN_CACHEABLE_PREFIX_TOKENS };

function resolveStatus(input: {
  eligible: boolean;
  providerReported: boolean;
  providerSupportsCache: boolean;
  cacheReadTokens: number;
}): PromptCacheObservationStatus {
  if (!input.providerSupportsCache) return 'unsupported';
  if (!input.eligible) return 'ineligible';
  if (!input.providerReported) return 'not-reported';
  return input.cacheReadTokens > 0 ? 'hit' : 'miss';
}

function clampTokens(value: number, inputTokens: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), inputTokens);
}

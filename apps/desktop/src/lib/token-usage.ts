import type { TokenUsage } from '@hyscode/ai-providers';

export type ContextUsageMetrics = {
  contextInputTokens: number;
  effectiveInputTokens: number;
  percentage: number;
};

export function getEffectiveInputTokens(usage: TokenUsage): number {
  return Math.max(usage.inputTokens - (usage.cacheReadTokens ?? 0), 0);
}

export function getContextUsageMetrics(
  usage: TokenUsage | null,
  contextWindow: number | null,
): ContextUsageMetrics {
  if (!usage) {
    return {
      contextInputTokens: 0,
      effectiveInputTokens: 0,
      percentage: 0,
    };
  }

  const contextInputTokens = usage.peakInputTokens ?? usage.lastInputTokens ?? usage.inputTokens;
  return {
    contextInputTokens,
    effectiveInputTokens: getEffectiveInputTokens(usage),
    percentage: contextWindow && contextWindow > 0 ? contextInputTokens / contextWindow : 0,
  };
}

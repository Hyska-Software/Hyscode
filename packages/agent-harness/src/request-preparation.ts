import {
  estimateMessageTokens,
  estimateToolDefinitionTokens,
  type AIModel,
  type AIProvider,
  type ChatParams,
  type Message,
  type PromptCacheMode,
  type ThinkingConfig,
  type TokenUsage,
} from '@hyscode/ai-providers';
import type { ContextSnapshot } from './types';

export type RequestCostBreakdown = {
  estimatedInputTokens: number;
  calibratedInputTokens: number;
  reservedOutputTokens: number;
  reasoningReplayTokens: number;
  imageTokens: number;
  estimatedInputCostUsd: number;
  estimatedMaxOutputCostUsd: number;
};

export type PreparedChatRequest = {
  params: Omit<ChatParams, 'signal'>;
  stablePrefixHash: string;
  promptCacheKey?: string;
  promptCache: PromptCachePlan;
  cost: RequestCostBreakdown;
  optimizations: string[];
};

export type PromptCachePlan = {
  mode: PromptCacheMode;
  enabled: boolean;
  providerSupportsCache: boolean;
  eligiblePrefixTokens: number;
  stablePrefixHash: string;
  promptCacheKey?: string;
};

type PrepareRequestInput = {
  snapshot: ContextSnapshot;
  provider?: AIProvider;
  model?: AIModel;
  modelId: string;
  mode?: string;
  maxOutputTokens: number;
  thinking?: ThinkingConfig;
  enabled: boolean;
  cacheEnabled?: boolean;
  cacheScope?: string;
};

const CACHE_PREFIX_VERSION = 'v2';

export class RequestPreparation {
  private calibration = new Map<string, { ratio: number; samples: number }>();

  prepare(input: PrepareRequestInput): PreparedChatRequest {
    const capabilities = input.provider?.capabilities;
    const cacheEnabled = input.cacheEnabled ?? input.enabled;
    const shouldReplayReasoning =
      capabilities?.reasoningReplay === 'required' ||
      (capabilities?.reasoningReplay === 'model-dependent' &&
        input.model?.thinkingVariants?.kind === 'kimi');
    const messages =
      input.enabled && !shouldReplayReasoning
        ? stripReasoningReplay(input.snapshot.messages)
        : input.snapshot.messages;
    const tools = canonicalizeTools(input.snapshot.tools);
    const stablePrefixHash = hashStablePrefix(input.snapshot.systemPrompt, tools);
    const promptCacheMode =
      capabilities?.promptCacheModeForModel?.(input.modelId) ?? capabilities?.promptCache ?? 'none';
    const acceptsPromptCacheKey =
      capabilities?.acceptsPromptCacheKeyForModel?.(input.modelId) ??
      capabilities?.acceptsPromptCacheKey ??
      false;
    const promptCacheKey =
      cacheEnabled && acceptsPromptCacheKey
        ? `hyscode:${CACHE_PREFIX_VERSION}:${input.provider?.id}:${input.modelId}:${hashText(input.cacheScope ?? 'global')}:${stablePrefixHash}`
        : undefined;
    const explicitCache = cacheEnabled && promptCacheMode === 'explicit-breakpoints';
    const eligiblePrefixTokens =
      input.snapshot.tokenBreakdown.system + estimateToolDefinitionTokens(tools);
    const estimatedInputTokens =
      input.snapshot.tokenBreakdown.system +
      input.snapshot.tokenBreakdown.tools +
      estimateMessageTokens(messages);
    const calibrationKey = `${input.provider?.id ?? 'unknown'}:${input.modelId}`;
    const ratio = Math.max(1, this.calibration.get(calibrationKey)?.ratio ?? 1);
    const calibratedInputTokens = Math.ceil(estimatedInputTokens * ratio);
    const reasoningReplayTokens = countContentTokens(messages, 'thinking');
    const imageTokens = countImages(messages) * 1500;

    return {
      params: {
        model: input.modelId,
        messages,
        systemPrompt: input.snapshot.systemPrompt,
        tools,
        maxTokens: input.maxOutputTokens,
        thinking: input.thinking,
        cachePrompt: explicitCache,
        promptCacheKey,
        promptCacheOptions:
          cacheEnabled && promptCacheMode !== 'none'
            ? {
                mode: explicitCache ? 'explicit' : 'implicit',
                key: promptCacheKey,
                stablePrefixHash,
                ...(explicitCache ? { breakpoint: 'stable-prefix' as const } : {}),
              }
            : undefined,
        agentMode: input.mode,
      },
      promptCache: {
        mode: promptCacheMode,
        enabled: cacheEnabled && promptCacheMode !== 'none',
        providerSupportsCache: promptCacheMode !== 'none',
        eligiblePrefixTokens,
        stablePrefixHash,
        promptCacheKey,
      },
      stablePrefixHash,
      promptCacheKey,
      cost: {
        estimatedInputTokens,
        calibratedInputTokens,
        reservedOutputTokens: input.maxOutputTokens,
        reasoningReplayTokens,
        imageTokens,
        estimatedInputCostUsd: tokenCost(calibratedInputTokens, input.model?.inputPricePerMToken),
        estimatedMaxOutputCostUsd: tokenCost(
          input.maxOutputTokens,
          input.model?.outputPricePerMToken,
        ),
      },
      optimizations: input.enabled || cacheEnabled
        ? [
            ...(messages !== input.snapshot.messages ? ['reasoning-replay-pruned'] : []),
            ...(promptCacheKey ? ['prompt-cache-key'] : []),
            ...(explicitCache ? ['cache-breakpoints'] : []),
          ]
        : [],
    };
  }

  recordUsage(
    providerId: string,
    modelId: string,
    estimatedInputTokens: number,
    usage: TokenUsage,
  ): void {
    if (estimatedInputTokens <= 0 || usage.inputTokens <= 0) return;
    const key = `${providerId}:${modelId}`;
    const previous = this.calibration.get(key);
    const observed = usage.inputTokens / estimatedInputTokens;
    const samples = Math.min(20, (previous?.samples ?? 0) + 1);
    const ratio = previous ? previous.ratio + (observed - previous.ratio) / samples : observed;
    this.calibration.set(key, { ratio: Math.max(0.5, Math.min(2, ratio)), samples });
  }
}

export function estimateActualCost(usage: TokenUsage, model?: AIModel): number {
  const uncachedInput = Math.max(0, usage.inputTokens - (usage.cacheReadTokens ?? 0));
  const cachedPrice = model?.cachedInputPricePerMToken ?? model?.inputPricePerMToken;
  return (
    tokenCost(uncachedInput, model?.inputPricePerMToken) +
    tokenCost(usage.cacheReadTokens ?? 0, cachedPrice) +
    tokenCost(usage.outputTokens, model?.outputPricePerMToken)
  );
}

export function recordRequestUsageMetrics(total: TokenUsage, request: TokenUsage): void {
  const effectiveInput = Math.max(0, request.inputTokens - (request.cacheReadTokens ?? 0));
  total.requestCount = (total.requestCount ?? 0) + 1;
  total.lastInputTokens = request.inputTokens;
  total.lastEffectiveInputTokens = effectiveInput;
  total.peakInputTokens = Math.max(total.peakInputTokens ?? 0, request.inputTokens);
  total.peakEffectiveInputTokens = Math.max(total.peakEffectiveInputTokens ?? 0, effectiveInput);
}

function stripReasoningReplay(messages: Message[]): Message[] {
  let changed = false;
  const result = messages.map((message) => {
    const content = message.content.filter((item) => item.type !== 'thinking');
    if (content.length !== message.content.length) changed = true;
    return content.length === message.content.length ? message : { ...message, content };
  });
  return changed ? result : messages;
}

function countContentTokens(messages: Message[], type: 'thinking'): number {
  return messages.reduce(
    (total, message) =>
      total +
      message.content.reduce((sum, item) => {
        return sum + (item.type === type ? Math.ceil(item.thinking.length / 4) : 0);
      }, 0),
    0,
  );
}

function countImages(messages: Message[]): number {
  return messages.reduce(
    (total, message) => total + message.content.filter((item) => item.type === 'image').length,
    0,
  );
}

function hashStablePrefix(systemPrompt: string, tools: ContextSnapshot['tools']): string {
  const text = stableStringify({ version: CACHE_PREFIX_VERSION, systemPrompt, tools });
  return hashText(text);
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function canonicalizeTools(tools: ContextSnapshot['tools']): ContextSnapshot['tools'] {
  return [...tools]
    .map((tool) => ({
      ...tool,
      inputSchema: canonicalizeObject(tool.inputSchema) as Record<string, unknown>,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function canonicalizeObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeObject);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalizeObject(record[key])]),
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function tokenCost(tokens: number, pricePerMillion?: number): number {
  return pricePerMillion === undefined ? 0 : (tokens / 1_000_000) * pricePerMillion;
}

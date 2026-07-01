import {
  estimateMessageTokens,
  type AIModel,
  type AIProvider,
  type ChatParams,
  type Message,
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
  cost: RequestCostBreakdown;
  optimizations: string[];
};

type PrepareRequestInput = {
  snapshot: ContextSnapshot;
  provider?: AIProvider;
  model?: AIModel;
  modelId: string;
  maxOutputTokens: number;
  thinking?: ThinkingConfig;
  enabled: boolean;
};

export class RequestPreparation {
  private calibration = new Map<string, { ratio: number; samples: number }>();

  prepare(input: PrepareRequestInput): PreparedChatRequest {
    const capabilities = input.provider?.capabilities;
    const shouldReplayReasoning =
      capabilities?.reasoningReplay === 'required' ||
      (capabilities?.reasoningReplay === 'model-dependent' &&
        input.model?.thinkingVariants?.kind === 'kimi');
    const messages =
      input.enabled && !shouldReplayReasoning
        ? stripReasoningReplay(input.snapshot.messages)
        : input.snapshot.messages;
    const stablePrefixHash = hashStablePrefix(input.snapshot.systemPrompt, input.snapshot.tools);
    const promptCacheKey =
      input.enabled && capabilities?.acceptsPromptCacheKey
        ? `hyscode:${input.provider?.id}:${input.modelId}:${stablePrefixHash}`
        : undefined;
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
        tools: input.snapshot.tools,
        maxTokens: input.maxOutputTokens,
        thinking: input.thinking,
        cachePrompt: input.enabled && capabilities?.promptCache === 'explicit-breakpoints',
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
      optimizations: input.enabled
        ? [
            ...(messages !== input.snapshot.messages ? ['reasoning-replay-pruned'] : []),
            ...(promptCacheKey ? ['prompt-cache-key'] : []),
            ...(capabilities?.promptCache === 'explicit-breakpoints' ? ['cache-breakpoints'] : []),
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
  const text = `${systemPrompt}\n${JSON.stringify(tools)}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function tokenCost(tokens: number, pricePerMillion?: number): number {
  return pricePerMillion === undefined ? 0 : (tokens / 1_000_000) * pricePerMillion;
}

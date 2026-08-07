import { describe, expect, it } from 'vitest';
import type {
  AIModel,
  AIProvider,
  Message,
  ProviderCapabilities,
  ToolDefinition,
} from '@hyscode/ai-providers';
import {
  RequestPreparation,
  estimateActualCost,
  recordRequestUsageMetrics,
} from './request-preparation';
import { ContextManager } from './context-manager';

function provider(capabilities: ProviderCapabilities): AIProvider {
  return {
    id: 'test-provider',
    name: 'Test',
    models: [],
    capabilities,
    chat: async function* () {
      return;
    },
    listModels: async () => [],
    isConfigured: () => true,
  };
}

function snapshot(messages: Message[]) {
  const context = new ContextManager();
  context.setHistory(messages);
  return context.buildSnapshot([], 32_000, 4_000);
}

function snapshotWithTools(tools: ToolDefinition[]) {
  const context = new ContextManager();
  context.setHistory([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]);
  return context.buildSnapshot(tools, 32_000, 4_000);
}

const model: AIModel = {
  id: 'model',
  name: 'Model',
  provider: 'test-provider',
  contextWindow: 32_000,
  maxOutputTokens: 4_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsVision: true,
  inputPricePerMToken: 2,
  cachedInputPricePerMToken: 0.5,
  outputPricePerMToken: 8,
};

describe('RequestPreparation', () => {
  it('prunes reasoning replay when the provider does not require it', () => {
    const preparation = new RequestPreparation();
    const prepared = preparation.prepare({
      snapshot: snapshot([
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'private reasoning' },
            { type: 'text', text: 'result' },
          ],
        },
      ]),
      provider: provider({
        promptCache: 'automatic',
        reasoningReplay: 'none',
        nativeTokenCounting: false,
        acceptsPromptCacheKey: false,
      }),
      model,
      modelId: model.id,
      maxOutputTokens: 4_000,
      enabled: true,
    });
    expect(prepared.params.messages[0].content).toEqual([{ type: 'text', text: 'result' }]);
    expect(prepared.optimizations).toContain('reasoning-replay-pruned');
  });

  it('creates a stable cache key only for capable providers', () => {
    const preparation = new RequestPreparation();
    const prepared = preparation.prepare({
      snapshot: snapshot([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]),
      provider: provider({
        promptCache: 'automatic-keyed',
        reasoningReplay: 'none',
        nativeTokenCounting: false,
        acceptsPromptCacheKey: true,
      }),
      model,
      modelId: model.id,
      maxOutputTokens: 4_000,
      enabled: true,
    });
    expect(prepared.promptCacheKey).toMatch(/^hyscode:v2:test-provider:model:/);
  });

  it('creates an explicit cache policy for models with breakpoint support', () => {
    const preparation = new RequestPreparation();
    const prepared = preparation.prepare({
      snapshot: snapshot([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]),
      provider: provider({
        promptCache: 'automatic-keyed',
        promptCacheModeForModel: () => 'explicit-breakpoints',
        acceptsPromptCacheKeyForModel: () => true,
        reasoningReplay: 'none',
        nativeTokenCounting: false,
        acceptsPromptCacheKey: true,
      }),
      model,
      modelId: model.id,
      maxOutputTokens: 4_000,
      enabled: true,
    });

    expect(prepared.params).toMatchObject({
      cachePrompt: true,
      promptCacheOptions: {
        mode: 'explicit',
        breakpoint: 'stable-prefix',
      },
    });
    expect(prepared.promptCache).toMatchObject({
      mode: 'explicit-breakpoints',
      providerSupportsCache: true,
    });
  });

  it('canonicalizes tool order and schema keys before hashing the stable prefix', () => {
    const preparation = new RequestPreparation();
    const capabilities: ProviderCapabilities = {
      promptCache: 'automatic-keyed',
      reasoningReplay: 'none',
      nativeTokenCounting: false,
      acceptsPromptCacheKey: true,
    };
    const left = preparation.prepare({
      snapshot: snapshotWithTools([
        {
          name: 'z_tool',
          description: 'z',
          inputSchema: { properties: { z: { type: 'string' } }, type: 'object' },
        },
        {
          name: 'a_tool',
          description: 'a',
          inputSchema: { type: 'object', properties: { a: { type: 'string' } } },
        },
      ]),
      provider: provider(capabilities),
      model,
      modelId: model.id,
      maxOutputTokens: 4_000,
      enabled: true,
      cacheScope: 'project-a',
    });
    const right = preparation.prepare({
      snapshot: snapshotWithTools([
        {
          name: 'a_tool',
          description: 'a',
          inputSchema: { properties: { a: { type: 'string' } }, type: 'object' },
        },
        {
          name: 'z_tool',
          description: 'z',
          inputSchema: { type: 'object', properties: { z: { type: 'string' } } },
        },
      ]),
      provider: provider(capabilities),
      model,
      modelId: model.id,
      maxOutputTokens: 4_000,
      enabled: true,
      cacheScope: 'project-a',
    });

    expect(left.stablePrefixHash).toBe(right.stablePrefixHash);
    expect(left.promptCacheKey).toBe(right.promptCacheKey);
    expect(left.params.tools?.map((tool) => tool.name)).toEqual(['a_tool', 'z_tool']);
  });

  it('prices cached input separately from uncached input', () => {
    expect(
      estimateActualCost(
        {
          inputTokens: 1_000_000,
          outputTokens: 100_000,
          totalTokens: 1_100_000,
          cacheReadTokens: 500_000,
        },
        model,
      ),
    ).toBeCloseTo(2.05);
  });

  it('tracks the last and peak input for individual API requests', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    recordRequestUsageMetrics(usage, {
      inputTokens: 120_000,
      outputTokens: 1_000,
      totalTokens: 121_000,
      cacheReadTokens: 100_000,
    });
    recordRequestUsageMetrics(usage, {
      inputTokens: 90_000,
      outputTokens: 2_000,
      totalTokens: 92_000,
      cacheReadTokens: 40_000,
    });

    expect(usage).toMatchObject({
      requestCount: 2,
      lastInputTokens: 90_000,
      lastEffectiveInputTokens: 50_000,
      peakInputTokens: 120_000,
      peakEffectiveInputTokens: 50_000,
    });
  });
});

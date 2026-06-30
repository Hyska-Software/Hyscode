import { describe, expect, it } from 'vitest';
import type { AIModel, AIProvider, Message, ProviderCapabilities } from '@hyscode/ai-providers';
import { RequestPreparation, estimateActualCost } from './request-preparation';
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
    expect(prepared.promptCacheKey).toMatch(/^hyscode:test-provider:model:/);
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
});

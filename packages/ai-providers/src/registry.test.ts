import { describe, expect, it } from 'vitest';
import { ProviderError } from './types';
import { ProviderRegistry } from './registry';
import type { AIModel, AIProvider } from './types';

const model: AIModel = {
  id: 'completion-model',
  name: 'Completion model',
  provider: 'test-provider',
  contextWindow: 128_000,
  maxOutputTokens: 512,
  supportsTools: false,
  supportsStreaming: true,
  supportsVision: false,
};

describe('ProviderRegistry per-request retry policy', () => {
  it('allows latency-sensitive callers to disable initial-request retries', async () => {
    let attempts = 0;
    const provider: AIProvider = {
      id: 'test-provider',
      name: 'Test provider',
      models: [model],
      capabilities: {
        promptCache: 'none',
        reasoningReplay: 'none',
        nativeTokenCounting: false,
        acceptsPromptCacheKey: false,
      },
      isConfigured: () => true,
      listModels: async () => [model],
      async *chat() {
        attempts += 1;
        throw new ProviderError('temporary failure', 'test-provider', 503, true);
      },
    };
    const registry = new ProviderRegistry();
    registry.register(provider);

    const stream = registry.chat({
      providerId: 'test-provider',
      model: model.id,
      messages: [],
      retry: { maxRetries: 0 },
    });

    await expect(
      (async () => {
        for await (const _chunk of stream) {
          return;
        }
      })(),
    ).rejects.toThrow('temporary failure');
    expect(attempts).toBe(1);
  });
});

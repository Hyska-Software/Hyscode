import { describe, expect, it } from 'vitest';
import {
  ProviderRegistry,
  type AIModel,
  type AIProvider,
} from '@hyscode/ai-providers';
import { resolveInlineCompletionTarget } from './inline-completion-target';

function createModel(provider: string, id: string): AIModel {
  return {
    id,
    name: id,
    provider,
    contextWindow: 128_000,
    maxOutputTokens: 512,
    supportsTools: false,
    supportsStreaming: true,
    supportsVision: false,
  };
}

function createProvider(options: {
  id: string;
  name?: string;
  modelId: string;
  agentic?: boolean;
}): AIProvider {
  const models = [createModel(options.id, options.modelId)];
  return {
    id: options.id,
    name: options.name ?? options.id,
    models,
    capabilities: {
      promptCache: 'none',
      reasoningReplay: 'none',
      nativeTokenCounting: false,
      acceptsPromptCacheKey: false,
      agenticToolExecution: options.agentic,
    },
    isConfigured: () => true,
    listModels: async () => models,
    async *chat() {
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

describe('resolveInlineCompletionTarget', () => {
  it('uses the exact active pair instead of the registry default', async () => {
    const registry = new ProviderRegistry();
    registry.register(createProvider({ id: 'openai', modelId: 'openai-model' }));
    registry.register(createProvider({ id: 'anthropic', modelId: 'anthropic-model' }));
    registry.setDefault('openai', 'openai-model');

    const result = await resolveInlineCompletionTarget({
      inlineProviderId: null,
      inlineModelId: null,
      activeProviderId: 'anthropic',
      activeModelId: 'anthropic-model',
      registry,
    });

    expect(result).toMatchObject({
      status: 'ready',
      target: { providerId: 'anthropic', modelId: 'anthropic-model', source: 'active' },
    });
  });

  it('rejects a provider/model pair assembled across providers', async () => {
    const registry = new ProviderRegistry();
    registry.register(createProvider({ id: 'openai', modelId: 'openai-model' }));
    registry.register(createProvider({ id: 'anthropic', modelId: 'anthropic-model' }));

    const result = await resolveInlineCompletionTarget({
      inlineProviderId: 'anthropic',
      inlineModelId: null,
      activeProviderId: 'openai',
      activeModelId: 'openai-model',
      registry,
    });

    expect(result).toMatchObject({ status: 'unavailable' });
  });

  it('rejects agentic providers and accepts explicit OpenRouter models', async () => {
    const registry = new ProviderRegistry();
    registry.register(createProvider({ id: 'codex', modelId: 'codex-model', agentic: true }));
    registry.register(createProvider({ id: 'openrouter', modelId: 'known-model' }));

    const codexResult = await resolveInlineCompletionTarget({
      inlineProviderId: 'codex',
      inlineModelId: 'codex-model',
      activeProviderId: null,
      activeModelId: null,
      registry,
    });
    const customResult = await resolveInlineCompletionTarget({
      inlineProviderId: 'openrouter',
      inlineModelId: 'vendor/custom-model',
      activeProviderId: null,
      activeModelId: null,
      registry,
    });

    expect(codexResult).toMatchObject({ status: 'unavailable' });
    expect(customResult).toMatchObject({
      status: 'ready',
      target: { providerId: 'openrouter', modelId: 'vendor/custom-model' },
    });
  });
});

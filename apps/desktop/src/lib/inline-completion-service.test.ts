import { describe, expect, it } from 'vitest';
import {
  ProviderRegistry,
  type AIModel,
  type AIProvider,
  type ChatParams,
} from '@hyscode/ai-providers';
import { fetchInlineCompletion } from './inline-completion-service';

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

function createProvider(chunks: Array<{ type: 'text_delta'; text: string } | { type: 'thinking_delta'; text: string }>): {
  provider: AIProvider;
  getParams: () => ChatParams | null;
} {
  let params: ChatParams | null = null;
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
    async *chat(nextParams) {
      params = nextParams;
      for (const chunk of chunks) yield chunk;
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
  return { provider, getParams: () => params };
}

const context = {
  prefix: 'const answer = ',
  suffix: '\nreturn answer;',
  language: 'typescript',
  filePath: 'src/example.ts',
};

describe('fetchInlineCompletion', () => {
  it('uses the systemPrompt contract and a single non-agentic turn', async () => {
    const fixture = createProvider([{ type: 'text_delta', text: '42' }]);
    const registry = new ProviderRegistry();
    registry.register(fixture.provider);

    const result = await fetchInlineCompletion(context, {
      activeProviderId: 'test-provider',
      activeModelId: 'completion-model',
      registry,
      initialize: async () => {},
    });

    expect(result).toEqual({ status: 'ready', text: '42' });
    expect(fixture.getParams()).toMatchObject({
      model: 'completion-model',
      maxTurns: 1,
      thinking: { enabled: false, type: 'disabled' },
    });
    expect(fixture.getParams()?.systemPrompt).toContain('raw code');
    expect(fixture.getParams()?.messages).toHaveLength(1);
    expect(fixture.getParams()?.messages[0]?.role).toBe('user');
  });

  it('never inserts a reasoning-only stream', async () => {
    const fixture = createProvider([{ type: 'thinking_delta', text: 'internal reasoning' }]);
    const registry = new ProviderRegistry();
    registry.register(fixture.provider);

    const result = await fetchInlineCompletion(context, {
      activeProviderId: 'test-provider',
      activeModelId: 'completion-model',
      registry,
      initialize: async () => {},
    });

    expect(result).toEqual({ status: 'empty', text: '' });
  });

  it('returns an actionable unavailable result without calling the provider', async () => {
    const fixture = createProvider([{ type: 'text_delta', text: 'unused' }]);
    const registry = new ProviderRegistry();
    registry.register(fixture.provider);

    const result = await fetchInlineCompletion(context, {
      activeProviderId: null,
      activeModelId: null,
      registry,
      initialize: async () => {},
    });

    expect(result.status).toBe('unavailable');
    expect(fixture.getParams()).toBeNull();
  });
});

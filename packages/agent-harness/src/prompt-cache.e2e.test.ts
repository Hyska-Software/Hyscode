import { afterEach, describe, expect, it } from 'vitest';
import {
  getProviderRegistry,
  type AIProvider,
  type ChatParams,
  type StreamChunk,
} from '@hyscode/ai-providers';
import { Harness } from './harness';

const model = {
  id: 'cache-e2e-model',
  name: 'Cache E2E Model',
  provider: 'cache-e2e-provider',
  contextWindow: 128_000,
  maxOutputTokens: 4_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsVision: false,
};

afterEach(() => getProviderRegistry().unregister('cache-e2e-provider'));

describe('Harness prompt-cache E2E', () => {
  it('preserves the stable key while user turns vary and records measured hits', async () => {
    const requests: ChatParams[] = [];
    let call = 0;
    const provider: AIProvider = {
      id: 'cache-e2e-provider',
      name: 'Cache E2E Provider',
      models: [model],
      capabilities: {
        promptCache: 'automatic-keyed',
        reasoningReplay: 'none',
        nativeTokenCounting: true,
        acceptsPromptCacheKey: true,
      },
      isConfigured: () => true,
      listModels: async () => [model],
      async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
        requests.push(params);
        const systemTokens = Math.ceil((params.systemPrompt?.length ?? 0) / 4);
        const toolTokens = JSON.stringify(params.tools ?? []).length;
        const eligiblePrefixTokens = systemTokens + toolTokens;
        const cacheReadTokens = call++ === 0 ? 0 : eligiblePrefixTokens;
        yield {
          type: 'usage',
          usage: {
            inputTokens: eligiblePrefixTokens + 64,
            outputTokens: 12,
            totalTokens: eligiblePrefixTokens + 76,
            cacheReadTokens,
            cacheWriteTokens: cacheReadTokens > 0 ? 0 : eligiblePrefixTokens,
          },
        };
        yield { type: 'text_delta', text: 'ok' };
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    getProviderRegistry().register(provider);

    const harness = new Harness({
      workspacePath: 'C:/cache-e2e-workspace',
      projectId: 'cache-e2e-project',
      invoke: async () => undefined as never,
      config: {
        providerId: provider.id,
        modelId: model.id,
        approval: { mode: 'yolo' },
        costOptimization: false,
        promptCaching: true,
      },
    });
    harness.setAgentType('chat');
    harness.setConversationId('cache-e2e-conversation');
    harness.getContextManager().setSystemPrompt('Stable system contract '.repeat(400));

    const traces = [];
    for (let index = 0; index < 100; index++) {
      const result = await harness.run(`Question ${index}`, []);
      expect(result.status).toBe('complete');
      expect(result.turnRecord.trace?.promptCache?.weightedHitRate).toBe(index === 0 ? 0 : 1);
      traces.push(result.turnRecord.trace!);
    }

    const cacheKeys = requests.map((request) => request.promptCacheKey);
    expect(new Set(cacheKeys).size).toBe(1);
    expect(requests.every((request) => request.promptCacheOptions?.mode === 'implicit')).toBe(true);

    const observed = traces.flatMap((trace) => (trace.promptCache ? [trace.promptCache] : []));
    const measuredTokens = observed.reduce(
      (total, aggregate) => total + aggregate.measuredEligiblePrefixTokens,
      0,
    );
    const readTokens = observed.reduce((total, aggregate) => total + aggregate.cacheReadTokens, 0);
    expect(observed).toHaveLength(100);
    expect(readTokens / measuredTokens).toBeGreaterThanOrEqual(0.96);
    expect(traces[0]?.promptCache?.missRequests).toBe(1);
    expect(traces[99]?.promptCache?.hitRequests).toBe(1);
  });
});

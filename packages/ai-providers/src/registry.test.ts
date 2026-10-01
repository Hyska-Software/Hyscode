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

  it('retries a connection failure before the provider yields content', async () => {
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
        if (attempts === 1) throw new Error('HTTP request failed: connection refused');
        yield { type: 'text_delta', text: 'recovered' };
      },
    };
    const registry = new ProviderRegistry();
    registry.register(provider);

    const chunks = [];
    for await (const chunk of registry.chat({
      providerId: 'test-provider',
      model: model.id,
      messages: [],
      retry: { maxRetries: 1, baseDelayMs: 0 },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ type: 'text_delta', text: 'recovered' }]);
    expect(attempts).toBe(2);
  });

  it('does not retry a connection failure after semantic output was delivered', async () => {
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
        yield { type: 'text_delta', text: 'partial answer' };
        throw new ProviderError(
          'stream interrupted',
          'test-provider',
          undefined,
          false,
          undefined,
          'stream_interrupted',
          'streaming',
        );
      },
    };
    const registry = new ProviderRegistry();
    registry.register(provider);
    const chunks: unknown[] = [];

    await expect(
      (async () => {
        for await (const chunk of registry.chat({
          providerId: 'test-provider',
          model: model.id,
          messages: [],
          retry: { maxRetries: 1, baseDelayMs: 0 },
        })) {
          chunks.push(chunk);
        }
      })(),
    ).rejects.toMatchObject({ kind: 'stream_interrupted' });

    expect(chunks).toEqual([{ type: 'text_delta', text: 'partial answer' }]);
    expect(attempts).toBe(1);
  });

  it('passes a distinct abort signal to each timed-out provider attempt', async () => {
    const attemptSignals: AbortSignal[] = [];
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
      async *chat(params) {
        const signal = params.signal;
        if (!signal) throw new Error('Attempt signal was not provided');
        attemptSignals.push(signal);
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw signal.reason;
      },
    };
    const registry = new ProviderRegistry();
    registry.register(provider);

    await expect(
      (async () => {
        for await (const _chunk of registry.chat({
          providerId: 'test-provider',
          model: model.id,
          messages: [],
          retry: { maxRetries: 1, baseDelayMs: 0, requestTimeoutMs: 10 },
        })) {
          void _chunk;
        }
      })(),
    ).rejects.toMatchObject({ kind: 'timeout' });

    expect(attemptSignals).toHaveLength(2);
    expect(new Set(attemptSignals).size).toBe(2);
    expect(attemptSignals.map((signal) => signal.aborted)).toEqual([true, true]);
  });
});

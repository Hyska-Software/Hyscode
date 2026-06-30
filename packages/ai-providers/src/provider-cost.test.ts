import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './providers/openai';
import { GeminiProvider } from './providers/gemini';
import type { StreamChunk } from './types';

function sseResponse(payload: unknown): Response {
  return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('provider cost metadata', () => {
  it('sends OpenAI cache keys and captures cached/reasoning tokens', async () => {
    let body: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return sseResponse({
        choices: [],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 100,
          total_tokens: 1300,
          prompt_tokens_details: { cached_tokens: 900 },
          completion_tokens_details: { reasoning_tokens: 40 },
        },
      });
    });
    const provider = new OpenAIProvider('key', undefined, undefined, fetchMock);
    const chunks = await collect(
      provider.chat({
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        promptCacheKey: 'stable-key',
      }),
    );
    expect(body.prompt_cache_key).toBe('stable-key');
    expect(chunks.find((chunk) => chunk.type === 'usage')).toMatchObject({
      type: 'usage',
      usage: { cacheReadTokens: 900, reasoningTokens: 40 },
    });
  });

  it('captures Gemini implicit-cache and thought token usage', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 80,
          totalTokenCount: 1080,
          cachedContentTokenCount: 700,
          thoughtsTokenCount: 30,
        },
      }),
    );
    const provider = new GeminiProvider('key', undefined, fetchMock);
    const chunks = await collect(
      provider.chat({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      }),
    );
    expect(chunks.find((chunk) => chunk.type === 'usage')).toMatchObject({
      type: 'usage',
      usage: { cacheReadTokens: 700, reasoningTokens: 30 },
    });
  });
});

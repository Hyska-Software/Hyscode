import { describe, expect, it } from 'vitest';
import type { FetchImpl, StreamChunk } from './types';
import { aggregatePromptCacheObservations, createPromptCacheObservation } from './prompt-cache';
import { chatResponsesAPI } from './providers/openai-responses';

function responseFor(call: number, eligiblePrefixTokens: number): Response {
  const cacheReadTokens = call === 0 ? 0 : eligiblePrefixTokens;
  const cacheWriteTokens = call === 0 ? eligiblePrefixTokens : 0;
  const body = [
    `data: ${JSON.stringify({
      type: 'response.completed',
      response: {
        usage: {
          input_tokens: eligiblePrefixTokens + 64,
          output_tokens: 16,
          total_tokens: eligiblePrefixTokens + 80,
          input_tokens_details: {
            cached_tokens: cacheReadTokens,
            cache_write_tokens: cacheWriteTokens,
          },
        },
      },
    })}\n\n`,
  ].join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('prompt-cache Responses replay', () => {
  it('keeps a stable explicit prefix above the 96% weighted hit target', async () => {
    const eligiblePrefixTokens = 6_000;
    const bodies: Array<Record<string, unknown>> = [];
    let call = 0;

    const fetchImpl: FetchImpl = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return responseFor(call++, eligiblePrefixTokens);
    };

    const observations = [];
    for (let index = 0; index < 100; index++) {
      const chunks: StreamChunk[] = [];
      for await (const chunk of chatResponsesAPI(
        {
          model: 'gpt-5.6-luna',
          systemPrompt: 'Stable system contract '.repeat(300),
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: `Question ${index}` }],
            },
          ],
          promptCacheKey: 'hyscode:v2:replay:stable',
          cachePrompt: true,
          promptCacheOptions: {
            mode: 'explicit',
            key: 'hyscode:v2:replay:stable',
            stablePrefixHash: 'replay-prefix',
            breakpoint: 'stable-prefix',
          },
        },
        {
          providerId: 'openai',
          providerName: 'OpenAI',
          apiKey: 'test-key',
          baseUrl: 'https://api.openai.com/v1',
          fetchImpl,
          supportsExplicitPromptCaching: true,
        },
      )) {
        chunks.push(chunk);
      }

      const usage = chunks.find((chunk) => chunk.type === 'usage');
      expect(usage?.type).toBe('usage');
      if (usage?.type === 'usage') {
        observations.push(
          createPromptCacheObservation({
            usage: usage.usage,
            eligiblePrefixTokens,
            cacheEnabled: true,
            providerSupportsCache: true,
            prefixHash: 'replay-prefix',
          }),
        );
      }
    }

    const aggregate = aggregatePromptCacheObservations(observations);
    expect(aggregate.weightedHitRate).toBeGreaterThanOrEqual(0.96);
    expect(aggregate.requestHitRate).toBe(0.99);
    expect(aggregate.unknownRate).toBe(0);
    expect(bodies).toHaveLength(100);
    for (const body of bodies) {
      expect(body.prompt_cache_key).toBe('hyscode:v2:replay:stable');
      expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
      expect(body.instructions).toBeUndefined();
      expect((body.input as Array<Record<string, unknown>>)[0]).toMatchObject({
        role: 'system',
        content: [
          {
            type: 'input_text',
            prompt_cache_breakpoint: { mode: 'explicit' },
          },
        ],
      });
    }
  });
});

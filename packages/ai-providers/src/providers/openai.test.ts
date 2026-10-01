import { describe, expect, it } from 'vitest';
import type { FetchImpl, StreamChunk } from '../types';
import { OpenAIProvider } from './openai';

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('OpenAI Chat Completions streaming', () => {
  it('closes the response stream when the provider iterator is returned early', async () => {
    let bodyCancelled = false;
    const event = {
      choices: [{ delta: { content: 'partial' }, finish_reason: null }],
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
      },
      cancel() {
        bodyCancelled = true;
      },
    });
    const fetchImpl: FetchImpl = async () => new Response(body);
    const provider = new OpenAIProvider('key', undefined, undefined, fetchImpl);
    const iterator = provider
      .chat({
        model: 'gpt-5.6-luna',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Start a stream' }] }],
      })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'text_delta', text: 'partial' },
    });
    await iterator.return?.();

    expect(bodyCancelled).toBe(true);
  });

  it('assembles interleaved parallel tool-call deltas by index and ID', async () => {
    const events = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-a',
                  type: 'function',
                  function: { name: 'alpha', arguments: '' },
                },
                {
                  index: 1,
                  id: 'call-b',
                  type: 'function',
                  function: { name: 'beta', arguments: '' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, function: { arguments: '{"b":' } },
                { index: 0, function: { arguments: '{"a":' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '1}' } },
                { index: 1, function: { arguments: '"two"}' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const fetchImpl: FetchImpl = async () => sseResponse(events);
    const provider = new OpenAIProvider('key', undefined, undefined, fetchImpl);
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.chat({
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Call both tools' }] }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'call-a', name: 'alpha' },
      { type: 'tool_call_start', id: 'call-b', name: 'beta' },
      { type: 'tool_call_delta', id: 'call-b', input: '{"b":' },
      { type: 'tool_call_delta', id: 'call-a', input: '{"a":' },
      { type: 'tool_call_delta', id: 'call-a', input: '1}' },
      { type: 'tool_call_delta', id: 'call-b', input: '"two"}' },
      { type: 'tool_call_end', id: 'call-a' },
      { type: 'tool_call_end', id: 'call-b' },
      { type: 'done', stopReason: 'tool_use' },
    ]);
  });
});

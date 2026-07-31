import { describe, expect, it } from 'vitest';
import type { FetchImpl, Message, StreamChunk } from './types';
import { chatResponsesAPI, parseResponsesChunk, toResponsesInput } from './providers/openai-responses';

function sseResponse(events: string[]): Response {
  const body = events.map((event) => `data: ${event}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function captureFetch(bodyCapture: (body: Record<string, unknown>) => void): FetchImpl {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodyCapture(body);
    return sseResponse([
      JSON.stringify({ type: 'response.reasoning_summary_text.delta', delta: 'Plan first. ' }),
      JSON.stringify({ type: 'response.output_text.delta', delta: 'Hello' }),
      JSON.stringify({ type: 'response.output_text.delta', delta: ' world' }),
      JSON.stringify({
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
            output_tokens_details: { reasoning_tokens: 3 },
          },
        },
      }),
    ]);
  };
}

const history: Message[] = [
  { role: 'system', content: [{ type: 'text', text: 'Be concise.' }] },
  { role: 'user', content: [{ type: 'text', text: 'Add numbers' }] },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'I should call sum(1, 2)' },
      {
        type: 'tool_call',
        id: 'call_1',
        name: 'sum',
        input: { a: 1, b: 2 },
      },
    ],
  },
  { role: 'tool', content: [{ type: 'tool_result', toolCallId: 'call_1', output: '3' }] },
  { role: 'user', content: [{ type: 'text', text: 'Now triple it' }] },
];

describe('toResponsesInput', () => {
  it('maps system prompts to instructions and messages to Responses API items', () => {
    const { instructions, input } = toResponsesInput(history, 'System root');

    expect(instructions).toBe('System root\n\nBe concise.');
    expect(input).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Add numbers' }],
      },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'sum',
        arguments: '{"a":1,"b":2}',
      },
      { type: 'function_call_output', call_id: 'call_1', output: '3' },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Now triple it' }],
      },
    ]);
  });

  it('omits instructions when there is no system content', () => {
    const { instructions, input } = toResponsesInput([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
    expect(instructions).toBeUndefined();
    expect(input).toHaveLength(1);
  });

  it('omits provider-specific thinking while preserving assistant text', () => {
    const { input } = toResponsesInput([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'think step 1' },
          { type: 'text', text: 'answer' },
        ],
      },
    ]);
    expect(input).toEqual([
      {
        role: 'assistant',
        content: 'answer',
      },
    ]);
  });
});

describe('chatResponsesAPI', () => {
  it('builds a valid Responses API payload (instructions, items, flat tools, no stop)', async () => {
    let captured: Record<string, unknown> | null = null;

    const chunks: StreamChunk[] = [];
    for await (const chunk of chatResponsesAPI(
      {
        model: 'gpt-5.6-luna',
        systemPrompt: 'System root',
        messages: history,
        tools: [
          {
            name: 'sum',
            description: 'Add two numbers',
            inputSchema: {
              type: 'object',
              properties: { a: { type: 'number' }, b: { type: 'number' } },
              required: ['a', 'b'],
            },
          },
        ],
        maxTokens: 1024,
        temperature: 0.7,
        thinking: { enabled: true, level: 'high', mode: 'pro' },
      },
      {
        providerId: 'opencode-go',
        providerName: 'OpenCode Go',
        apiKey: 'key',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        fetchImpl: captureFetch((body) => {
          captured = body;
        }),
      },
    )) {
      chunks.push(chunk);
    }

    expect(captured).toMatchObject({
      model: 'gpt-5.6-luna',
      stream: true,
      instructions: 'System root\n\nBe concise.',
      max_output_tokens: 1024,
      temperature: 0.7,
      reasoning: { effort: 'high', summary: 'auto', mode: 'pro' },
    });
    const body = captured!;
    expect(body.stop).toBeUndefined();
    expect(body.tools).toEqual([
      {
        type: 'function',
        name: 'sum',
        description: 'Add two numbers',
        parameters: {
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'number' } },
          required: ['a', 'b'],
        },
        strict: false,
      },
    ]);
    const input = body.input as Array<Record<string, unknown>>;
    expect(input[0]).toEqual({ role: 'user', content: [{ type: 'input_text', text: 'Add numbers' }] });
    expect(input[1]).toEqual({
      type: 'function_call',
      call_id: 'call_1',
      name: 'sum',
      arguments: '{"a":1,"b":2}',
    });
    expect(input[2]).toEqual({ type: 'function_call_output', call_id: 'call_1', output: '3' });

    // Stream chunks: deltas + usage + done
    expect(chunks).toEqual([
      { type: 'thinking_delta', text: 'Plan first. ' },
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ' world' },
      {
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, reasoningTokens: 3 },
      },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('throws a classified ProviderError on HTTP 400 without reading the error body text', async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'invalid_prompt',
            message: 'Upstream request failed: Invalid Responses API request',
          },
        }),
        { status: 400, headers: { 'content-type': 'text/plain' } },
      );

    const consume = async () => {
      for await (const _ of chatResponsesAPI(
        { model: 'gpt-5.6-luna', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        {
          providerId: 'opencode-go',
          providerName: 'OpenCode Go',
          apiKey: 'key',
          baseUrl: 'https://opencode.ai/zen/go/v1',
          fetchImpl,
        },
      )) {
        void _;
      }
    };

    await expect(consume()).rejects.toMatchObject({
      kind: 'invalid_response',
      statusCode: 400,
      retryable: false,
      provider: 'opencode-go',
    });
  });
});

describe('parseResponsesChunk', () => {
  it('parses function call events with argument deltas and completion', () => {
    const start = parseResponsesChunk(
      JSON.stringify({
        type: 'response.output_item.added',
        item: { type: 'function_call', id: 'fc_1', call_id: 'fc_1', name: 'read_file' },
      }),
      '',
      'opencode-go',
    );
    expect(start).toEqual([{ type: 'tool_call_start', id: 'fc_1', name: 'read_file' }]);

    const delta = parseResponsesChunk(
      JSON.stringify({ type: 'response.function_call_arguments.delta', delta: '{"path":' }),
      'fc_1',
      'opencode-go',
    );
    expect(delta).toEqual([{ type: 'tool_call_delta', id: 'fc_1', input: '{"path":' }]);

    const end = parseResponsesChunk(
      JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'fc_1' }),
      'fc_1',
      'opencode-go',
    );
    expect(end).toEqual([{ type: 'tool_call_end', id: 'fc_1' }]);
  });

  it('parses reasoning summary deltas as thinking chunks', () => {
    expect(
      parseResponsesChunk(
        JSON.stringify({ type: 'response.reasoning_summary_text.delta', delta: 'Plan first.' }),
        '',
        'opencode-go',
      ),
    ).toEqual([{ type: 'thinking_delta', text: 'Plan first.' }]);
  });

  it('throws on malformed JSON events', () => {
    expect(() => parseResponsesChunk('not json', '', 'opencode-go')).toThrow();
  });
});

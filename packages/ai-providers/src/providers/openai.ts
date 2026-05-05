import type {
  AIProvider,
  AIModel,
  ChatParams,
  StreamChunk,
  Message,
  ToolDefinition,
  StopReason,
  FetchImpl,
} from '../types';
import { ProviderError } from '../types';
import { parseSSEStream } from '../retry';

// ─── OpenAI Message Formatting ──────────────────────────────────────────────

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  /** Kimi / MiMo extended thinking — must be round-tripped in assistant messages with tool calls */
  reasoning_content?: string;
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

function toOpenAIMessages(messages: Message[], systemPrompt?: string, alwaysReasoningContent = false): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({ role: 'system', content: msg.content.map(c => c.type === 'text' ? c.text : '').join('') });
      continue;
    }

    if (msg.role === 'tool') {
      for (const c of msg.content) {
        if (c.type === 'tool_result') {
          result.push({ role: 'tool', content: c.output, tool_call_id: c.toolCallId });
        }
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: OpenAIToolCall[] = [];

      for (const c of msg.content) {
        if (c.type === 'text') textParts.push(c.text);
        if (c.type === 'thinking') thinkingParts.push(c.thinking);
        if (c.type === 'tool_call') {
          toolCalls.push({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.input) },
          });
        }
      }

      const assistantMsg: OpenAIMessage = { role: 'assistant' };
      if (textParts.length) assistantMsg.content = textParts.join('');
      if (toolCalls.length) assistantMsg.tool_calls = toolCalls;
      // Always include reasoning_content for Kimi/MiMo providers — even empty string
      // prevents "reasoning_content is missing" 400 errors on multi-turn tool calls
      const reasoningContent = thinkingParts.join('');
      const shouldAddReasoning = reasoningContent || (alwaysReasoningContent && toolCalls.length);
      if (shouldAddReasoning) {
        // Moonshot API rejects empty string for reasoning_content when thinking is enabled.
        // Use a single space as minimal non-empty placeholder to satisfy validation.
        assistantMsg.reasoning_content = reasoningContent || ' ';
      }
      console.log('[toOpenAIMessages] assistant msg:', { textLen: textParts.join('').length, toolCount: toolCalls.length, thinkingLen: reasoningContent.length, alwaysReasoningContent, shouldAddReasoning, hasReasoning: 'reasoning_content' in assistantMsg });
      if (!textParts.length && !toolCalls.length) assistantMsg.content = '';
      result.push(assistantMsg);
      continue;
    }

    // user message
    const contentParts: OpenAIContentPart[] = [];
    for (const c of msg.content) {
      if (c.type === 'text') contentParts.push({ type: 'text', text: c.text });
      if (c.type === 'image') {
        contentParts.push({
          type: 'image_url',
          image_url: { url: `data:${c.mediaType};base64,${c.base64}` },
        });
      }
    }
    result.push({
      role: 'user',
      content: contentParts.length === 1 && contentParts[0].type === 'text'
        ? contentParts[0].text
        : contentParts,
    });
  }

  return result;
}

function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

// ─── SSE Parsing ────────────────────────────────────────────────────────────

function parseOpenAIChunk(data: string): StreamChunk[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage = parsed.usage as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const choices = parsed.choices as any[];
  if (!choices?.length) {
    // Usage-only chunk (no choices).
    if (usage) {
      return [{
        type: 'usage',
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
        },
      }];
    }
    return [];
  }

  const choice = choices[0];
  const delta = choice.delta;
  const finishReason = choice.finish_reason;

  if (finishReason) {
    const reasonMap: Record<string, StopReason> = {
      stop: 'end_turn',
      tool_calls: 'tool_use',
      length: 'max_tokens',
    };
    const chunks: StreamChunk[] = [];
    // OpenAI may include usage in the same chunk as finish_reason — emit it first.
    if (usage) {
      chunks.push({
        type: 'usage',
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
        },
      });
    }
    chunks.push({ type: 'done', stopReason: reasonMap[finishReason] ?? 'end_turn' });
    return chunks;
  }

  if (delta?.reasoning_content) {
    return [{ type: 'thinking_delta', text: delta.reasoning_content }];
  }

  if (delta?.content) {
    return [{ type: 'text_delta', text: delta.content }];
  }

  if (delta?.tool_calls) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tc = delta.tool_calls[0] as any;
    if (tc.function?.name) {
      return [{ type: 'tool_call_start', id: tc.id ?? '', name: tc.function.name }];
    }
    if (tc.function?.arguments) {
      return [{ type: 'tool_call_delta', id: tc.id ?? '', input: tc.function.arguments }];
    }
  }

  return [];
}

// ─── Provider Implementation ────────────────────────────────────────────────

const OPENAI_MODELS: AIModel[] = [
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    contextWindow: 300_000, // actual: 1M, capped at 300k
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 15,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'openai',
    contextWindow: 300_000, // actual: 400k, capped at 300k
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.75,
    outputPricePerMToken: 4.5,
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    provider: 'openai',
    contextWindow: 300_000, // actual: 400k, capped at 300k
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.2,
    outputPricePerMToken: 1.25,
  },
];

export class OpenAIProvider implements AIProvider {
  readonly id: string = 'openai';
  readonly name: string = 'OpenAI';
  models: AIModel[] = [...OPENAI_MODELS];

  protected apiKey: string;
  protected baseUrl: string;
  protected defaultHeaders: Record<string, string>;
  protected fetchImpl: FetchImpl;
  /** Set to true for providers routing Kimi/MiMo models — forces reasoning_content
   *  on every assistant+tool_calls message even when the proxy strips thinking deltas. */
  protected requiresReasoningContent = false;

  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1', extraHeaders: Record<string, string> = {}, fetchImpl?: FetchImpl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.defaultHeaders = extraHeaders;
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async listModels(): Promise<AIModel[]> {
    return this.models;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const messages = toOpenAIMessages(params.messages, params.systemPrompt, this.requiresReasoningContent);
    console.log('[OpenAIProvider] requiresReasoningContent=', this.requiresReasoningContent, 'model=', params.model);
    console.log('[OpenAIProvider] toOpenAIMessages output:', JSON.stringify(messages.map(m => ({ role: m.role, hasToolCalls: !!m.tool_calls, hasReasoning: 'reasoning_content' in m, reasoningLength: m.reasoning_content?.length }))));

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;
    if (params.stopSequences?.length) body.stop = params.stopSequences;
    if (params.tools?.length) body.tools = toOpenAITools(params.tools);
    if (params.thinking?.enabled) {
      const isKimi = params.model.startsWith('kimi-') || params.model.startsWith('mimo-');
      if (isKimi) {
        // Kimi/MiMo uses thinking: { type: 'enabled' | 'disabled' }
        body.thinking = { type: params.thinking.level === 'disabled' ? 'disabled' : 'enabled' };
      } else if (params.thinking.level && params.thinking.level !== 'disabled') {
        body.reasoning_effort = params.thinking.level;
      }
    }

    const requestBody = JSON.stringify(body);
    const bodyMessages = body.messages as Array<{ role?: string; tool_calls?: unknown[]; reasoning_content?: string }> | undefined;
    const assistantMsgIdx = bodyMessages?.findIndex(m => m.role === 'assistant' && m.tool_calls);
    if (assistantMsgIdx !== undefined && assistantMsgIdx >= 0) {
      const am = bodyMessages![assistantMsgIdx];
      console.log('[OpenAIProvider] request body assistant msg raw:', JSON.stringify({ role: am.role, tool_calls: am.tool_calls, reasoning_content: am.reasoning_content }));
    }
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...this.defaultHeaders,
      },
      body: requestBody,
      signal: params.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterMs = retryAfterHeader
        ? parseFloat(retryAfterHeader) * 1_000
        : undefined;
      throw new ProviderError(
        `${this.name} API error: ${response.status} ${errorBody}`,
        this.id,
        response.status,
        [429, 500, 502, 503].includes(response.status),
        retryAfterMs,
      );
    }

    console.log('[OpenAIProvider] response status:', response.status, 'ok:', response.ok);

    // Track tool call IDs across delta chunks.
    // OpenAI never sends tool_call_end — we must synthesize it when a new
    // tool starts or the stream finishes with stopReason 'tool_use'.
    let currentToolCallId = '';

    for await (const data of parseSSEStream(response, params.signal)) {
      console.log('[OpenAIProvider] raw SSE data:', data);
      const chunks = parseOpenAIChunk(data);
      console.log('[OpenAIProvider] parsed chunk:', chunks);

      for (const chunk of chunks) {
        if (chunk.type === 'tool_call_start' && chunk.id) {
          // A new tool call starting means the previous one is done
          if (currentToolCallId) {
            yield { type: 'tool_call_end' as const, id: currentToolCallId };
          }
          currentToolCallId = chunk.id;
        } else if (chunk.type === 'tool_call_delta' && !chunk.id) {
          yield { ...chunk, id: currentToolCallId };
          continue;
        } else if (chunk.type === 'done' && chunk.stopReason === 'tool_use') {
          // Emit tool_call_end for the last active tool before the done signal
          if (currentToolCallId) {
            yield { type: 'tool_call_end' as const, id: currentToolCallId };
            currentToolCallId = '';
          }
        }

        yield chunk;
      }
    }
  }
}

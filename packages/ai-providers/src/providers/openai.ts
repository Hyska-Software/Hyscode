import type {
  AIProvider,
  AIModel,
  ChatParams,
  StreamChunk,
  Message,
  ToolDefinition,
  StopReason,
  FetchImpl,
  ProviderCapabilities,
  ThinkingVariants,
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

export function toOpenAIMessages(
  messages: Message[],
  systemPrompt?: string,
  alwaysReasoningContent = false,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({
        role: 'system',
        content: msg.content.map((c) => (c.type === 'text' ? c.text : '')).join(''),
      });
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
      content:
        contentParts.length === 1 && contentParts[0].type === 'text'
          ? contentParts[0].text
          : contentParts,
    });
  }

  return result;
}

export function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
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
  } catch (error) {
    throw new ProviderError(
      `Malformed OpenAI SSE event: ${error instanceof Error ? error.message : String(error)}`,
      'openai',
      undefined,
      false,
      undefined,
      'invalid_response',
      'parsing',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage = parsed.usage as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const choices = parsed.choices as any[];
  if (!choices?.length) {
    // Usage-only chunk (no choices).
    if (usage) {
      return [
        {
          type: 'usage',
          usage: normalizeOpenAIUsage(usage),
        },
      ];
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
        usage: normalizeOpenAIUsage(usage),
      });
    }
    chunks.push({ type: 'done', stopReason: reasonMap[finishReason] ?? 'end_turn' });
    return chunks;
  }

  if (delta?.reasoning_content) {
    return [{ type: 'thinking_delta', text: delta.reasoning_content }];
  }

  // Some proxies (e.g., Xiaomi/MiMo via OpenRouter) return reasoning in delta.reasoning
  // instead of the OpenAI-standard delta.reasoning_content.
  if (delta?.reasoning) {
    return [{ type: 'thinking_delta', text: delta.reasoning }];
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

function normalizeOpenAIUsage(usage: Record<string, unknown>): import('../types').TokenUsage {
  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const completionDetails = usage.completion_tokens_details as Record<string, unknown> | undefined;
  return {
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0),
    cacheReadTokens: Number(promptDetails?.cached_tokens ?? 0),
    reasoningTokens: Number(completionDetails?.reasoning_tokens ?? 0),
  };
}

// ─── Thinking variant presets ────────────────────────────────────────────────
// Per docs/MODELS_REFERENCE.md §5 — reasoning.effort ladders per model tier.
// GPT-5.6 additionally supports reasoning.mode = standard (default) | pro.

/** none/low/medium/high/xhigh/max — GPT-5.5, 5.5 Pro, 5.4, 5.4 Pro, 5.3 Codex */
export const OPENAI_THINKING_FULL: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
};

/** Full ladder + standard/pro reasoning mode — GPT-5.6 Sol/Terra/Luna */
export const OPENAI_THINKING_FULL_PRO: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
  modes: ['standard', 'pro'],
  defaultMode: 'standard',
};

/** none/low/medium/high/xhigh — GPT-5.2, 5.1, 5 */
export const OPENAI_THINKING_XHIGH: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh'],
  defaultLevel: 'medium',
};

/** none/low/medium/high — GPT-5.4 Mini, 5.3 Codex Spark */
export const OPENAI_THINKING_HIGH: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high'],
  defaultLevel: 'medium',
};

/** none/low/medium — GPT-5.4 Nano, 5 Nano */
export const OPENAI_THINKING_LOW: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium'],
  defaultLevel: 'medium',
};

// ─── Provider Implementation ────────────────────────────────────────────────

const OPENAI_MODELS: AIModel[] = [
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    provider: 'openai',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 30,
    cachedInputPricePerMToken: 0.5,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    provider: 'openai',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 15,
    cachedInputPricePerMToken: 0.25,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    provider: 'openai',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1,
    outputPricePerMToken: 6,
    cachedInputPricePerMToken: 0.1,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    provider: 'openai',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 30,
    cachedInputPricePerMToken: 0.5,
    thinkingVariants: OPENAI_THINKING_FULL,
  },
  {
    id: 'gpt-5.5-pro',
    name: 'GPT-5.5 Pro',
    provider: 'openai',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 30,
    outputPricePerMToken: 180,
    thinkingVariants: OPENAI_THINKING_FULL,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 15,
    cachedInputPricePerMToken: 0.25,
    thinkingVariants: OPENAI_THINKING_FULL,
  },
  {
    id: 'gpt-5.4-pro',
    name: 'GPT-5.4 Pro',
    provider: 'openai',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 30,
    outputPricePerMToken: 180,
    thinkingVariants: OPENAI_THINKING_FULL,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'openai',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.75,
    outputPricePerMToken: 4.5,
    cachedInputPricePerMToken: 0.075,
    thinkingVariants: OPENAI_THINKING_HIGH,
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    provider: 'openai',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.2,
    outputPricePerMToken: 1.25,
    cachedInputPricePerMToken: 0.02,
    thinkingVariants: OPENAI_THINKING_LOW,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    provider: 'openai',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.75,
    outputPricePerMToken: 14,
    cachedInputPricePerMToken: 0.175,
    thinkingVariants: OPENAI_THINKING_FULL,
  },
];

export class OpenAIProvider implements AIProvider {
  readonly id: string = 'openai';
  readonly name: string = 'OpenAI';
  models: AIModel[] = [...OPENAI_MODELS];
  get capabilities(): ProviderCapabilities {
    return {
      promptCache: this.id === 'openai' ? 'automatic-keyed' : 'automatic',
      reasoningReplay: this.requiresReasoningContent ? 'required' : 'model-dependent',
      nativeTokenCounting: false,
      acceptsPromptCacheKey: this.id === 'openai',
    };
  }

  protected apiKey: string;
  protected baseUrl: string;
  protected defaultHeaders: Record<string, string>;
  protected fetchImpl: FetchImpl;
  /** Set to true for providers routing Kimi/MiMo models — forces reasoning_content
   *  on every assistant+tool_calls message even when the proxy strips thinking deltas. */
  protected requiresReasoningContent = false;

  constructor(
    apiKey: string,
    baseUrl = 'https://api.openai.com/v1',
    extraHeaders: Record<string, string> = {},
    fetchImpl?: FetchImpl,
  ) {
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
    const messages = toOpenAIMessages(
      params.messages,
      params.systemPrompt,
      this.requiresReasoningContent,
    );

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (params.maxTokens) {
      if (this.id === 'openai') body.max_completion_tokens = params.maxTokens;
      else body.max_tokens = params.maxTokens;
    }
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;
    if (params.stopSequences?.length) body.stop = params.stopSequences;
    if (params.tools?.length) body.tools = toOpenAITools(params.tools);
    if (params.promptCacheKey && this.capabilities.acceptsPromptCacheKey) {
      body.prompt_cache_key = params.promptCacheKey;
    }
    if (params.thinking?.enabled) {
      // Toggle-style thinking (thinking: { type }) applies to Kimi K2.x, MiMo
      // and Hy3. Kimi K3 is a reasoning model with low/medium/high effort per
      // docs/MODELS_REFERENCE.md, so effort levels route to reasoning_effort.
      const hasEffortLevel =
        params.thinking.level !== undefined &&
        params.thinking.level !== 'enabled' &&
        params.thinking.level !== 'disabled';
      const isToggleModel =
        (params.model.startsWith('kimi-') && params.model !== 'kimi-k3') ||
        params.model.startsWith('mimo-') ||
        params.model === 'hy3';
      const isKimi = isToggleModel || (params.model === 'kimi-k3' && !hasEffortLevel);
      if (isKimi) {
        // Kimi/MiMo uses thinking: { type: 'enabled' | 'disabled' }
        body.thinking = { type: params.thinking.level === 'disabled' ? 'disabled' : 'enabled' };
      } else if (params.thinking.level && params.thinking.level !== 'disabled') {
        // Map generic 'enabled' to a default effort level for APIs that require specific values
        const effort = params.thinking.level === 'enabled' ? 'medium' : params.thinking.level;
        body.reasoning_effort = effort;
        // GPT-5.6 family supports reasoning.mode = standard (default) | pro
        if (params.thinking.mode) body.reasoning_mode = params.thinking.mode;
      }
    }

    const requestBody = JSON.stringify(body);
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
      const retryAfterMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1_000 : undefined;
      throw new ProviderError(
        `${this.name} API error: ${response.status} ${errorBody}`,
        this.id,
        response.status,
        [429, 500, 502, 503].includes(response.status),
        retryAfterMs,
      );
    }

    // Track tool call IDs across delta chunks.
    // OpenAI never sends tool_call_end — we must synthesize it when a new
    // tool starts or the stream finishes with stopReason 'tool_use'.
    let currentToolCallId = '';

    for await (const data of parseSSEStream(response, params.signal)) {
      const chunks = parseOpenAIChunk(data);

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

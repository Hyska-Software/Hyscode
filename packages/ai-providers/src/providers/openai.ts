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
import { withOpencodeHeaders } from '../opencode-headers';

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
  | { type: 'text'; text: string; prompt_cache_breakpoint?: { mode: 'explicit' } }
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

type ParsedOpenAIChunk =
  | StreamChunk
  | {
      type: 'tool_call_fragment';
      index?: number;
      id?: string;
      name?: string;
      arguments?: string;
    };

type OpenAIToolCallState = {
  id?: string;
  name?: string;
  started: boolean;
  pendingArguments: string;
};

export function toOpenAIMessages(
  messages: Message[],
  systemPrompt?: string,
  alwaysReasoningContent = false,
  explicitCacheBreakpoint = false,
): OpenAIMessage[] {
  if (!messages.length) throw new Error('model required: messages must not be empty');
  const result: OpenAIMessage[] = [];

  if (systemPrompt) {
    result.push({
      role: 'system',
      content: explicitCacheBreakpoint
        ? [
            {
              type: 'text',
              text: systemPrompt,
              prompt_cache_breakpoint: { mode: 'explicit' },
            },
          ]
        : systemPrompt,
    });
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
      if (c.type === 'thinking') {
        // Preserve thinking as text so replay history doesn't lose it.
        contentParts.push({ type: 'text', text: `[thinking]${c.thinking}` });
      }
      if (c.type === 'image') {
        if (c.base64.length > 20 * 1024 * 1024) {
          throw new Error('image too large: base64 payload exceeds 20MB');
        }
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

function parseOpenAIChunk(data: string): ParsedOpenAIChunk[] {
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

  const usage = parsed.usage as Record<string, unknown> | undefined;
  const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
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
  const delta = choice.delta as Record<string, unknown> | undefined;
  const finishReason = choice.finish_reason as string | null | undefined;

  if (finishReason) {
    const reasonMap: Record<string, StopReason> = {
      stop: 'end_turn',
      tool_calls: 'tool_use',
      length: 'max_tokens',
    };
    const chunks: ParsedOpenAIChunk[] = [];
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

  const chunks: ParsedOpenAIChunk[] = [];
  if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
    chunks.push({ type: 'thinking_delta', text: delta.reasoning_content });
  } else if (typeof delta?.reasoning === 'string' && delta.reasoning) {
    // Some proxies (e.g., Xiaomi/MiMo via OpenRouter) use delta.reasoning.
    chunks.push({ type: 'thinking_delta', text: delta.reasoning });
  } else if (typeof delta?.content === 'string' && delta.content) {
    chunks.push({ type: 'text_delta', text: delta.content });
  }

  const toolCalls = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
  for (const toolCall of toolCalls ?? []) {
    const fn = toolCall.function as Record<string, unknown> | undefined;
    const hasArguments = typeof fn?.arguments === 'string' && fn.arguments.length > 0;
    const hasName = typeof fn?.name === 'string' && fn.name.length > 0;
    const hasId = typeof toolCall.id === 'string' && toolCall.id.length > 0;
    const hasIndex = typeof toolCall.index === 'number';
    // Drop empty fragments that carry neither identity nor payload. Without
    // this, index-less/identity-less heartbeats would create orphan states
    // that never start and leak pending arguments.
    if (!hasIndex && !hasId && !hasName && !hasArguments) continue;
    const fragment = {
      type: 'tool_call_fragment',
      index: hasIndex ? (toolCall.index as number) : undefined,
      id: hasId ? (toolCall.id as string) : undefined,
      name: hasName ? (fn?.name as string) : undefined,
      arguments: hasArguments ? (fn?.arguments as string) : undefined,
    } as const;
    chunks.push(fragment);
  }

  return chunks;
}

function normalizeOpenAIUsage(usage: Record<string, unknown>): import('../types').TokenUsage {
  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const completionDetails = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const normalized: import('../types').TokenUsage = {
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0),
    reasoningTokens: Number(completionDetails?.reasoning_tokens ?? 0),
  };
  if (typeof promptDetails?.cached_tokens === 'number') {
    normalized.cacheReadTokens = promptDetails.cached_tokens;
  }
  if (typeof promptDetails?.cache_write_tokens === 'number') {
    normalized.cacheWriteTokens = promptDetails.cache_write_tokens;
  }
  return normalized;
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

/** Full ladder + standard/pro reasoning mode — GPT-6 Astra / 6.1 Sol / 6 Sol / 6 Luna (and 5.6 Sol/Terra/Luna via gateways) */
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

// SOTA-only direct catalog (verified Oct 2026 against
// https://openai.com/index/introducing-gpt-6-sol-and-luna +
// /introducing-gpt-6-1-sol + Zen pricing, Standard tier short-context
// ≤272K): the GPT-6 current generation — Astra (flagship, $10/$50,
// cache $1.00), 6.1 Sol (near-Astra, $2/$10, cache $0.10 = 95% off),
// 6 Sol (frontier efficiency, $2/$10, cache $0.20), 6 Luna
// (high-volume, $0.10/$0.50, cache $0.01). Legacy GPT-5.x remains
// available via gateways, not direct.
const OPENAI_MODELS: AIModel[] = [
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    provider: 'openai',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 10,
    outputPricePerMToken: 50,
    cachedInputPricePerMToken: 1,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    provider: 'openai',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.1,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-6-sol',
    name: 'GPT-6 Sol',
    provider: 'openai',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.2,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    provider: 'openai',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.1,
    outputPricePerMToken: 0.5,
    cachedInputPricePerMToken: 0.01,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
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
      promptCacheModeForModel: (modelId) => {
        if (this.id !== 'openai') return 'automatic';
        return supportsExplicitPromptCaching(modelId) ? 'explicit-breakpoints' : 'automatic-keyed';
      },
      acceptsPromptCacheKeyForModel: (modelId) => this.id === 'openai' && modelId.length > 0,
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

  /** Zero the in-memory API key (secret hygiene on reinit/dispose). */
  clear(): void {
    this.apiKey = '';
  }

  dispose(): void {
    this.clear();
  }

  async listModels(): Promise<AIModel[]> {
    return this.models;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    if (!params.model) throw new Error('model required');
    if (!params.messages.length) throw new Error('model required: messages must not be empty');
    const explicitCache =
      (params.cachePrompt === true || params.promptCacheOptions?.mode === 'explicit') &&
      this.capabilities.promptCacheModeForModel?.(params.model) === 'explicit-breakpoints';
    const messages = toOpenAIMessages(
      params.messages,
      params.systemPrompt,
      this.requiresReasoningContent,
      explicitCache,
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
    const promptCacheKey = params.promptCacheKey ?? params.promptCacheOptions?.key;
    const acceptsPromptCacheKey =
      this.capabilities.acceptsPromptCacheKeyForModel?.(params.model) ??
      this.capabilities.acceptsPromptCacheKey;
    if (promptCacheKey && acceptsPromptCacheKey) {
      body.prompt_cache_key = promptCacheKey;
    }
    if (explicitCache) {
      body.prompt_cache_options = { mode: 'explicit' };
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
    const url = `${this.baseUrl}/chat/completions`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: withOpencodeHeaders(
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...this.defaultHeaders,
        },
        url,
        params.sessionId,
      ),
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
        [429, 500, 502, 503, 529].includes(response.status),
        retryAfterMs,
      );
    }

    // Parallel tool-call deltas are interleaved by index. Keep their identity and
    // any arguments that arrive before both ID and name are available.
    const toolCallsByIndex = new Map<number, OpenAIToolCallState>();
    const toolCallsById = new Map<string, OpenAIToolCallState>();
    const toolCallStates = new Set<OpenAIToolCallState>();
    // Fallback for providers that omit both `index` and `id` on continuation
    // fragments: attach the payload to the most recently touched call instead
    // of spawning an orphan state per chunk.
    let mostRecentState: OpenAIToolCallState | undefined;

    for await (const data of parseSSEStream(response, params.signal)) {
      const chunks = parseOpenAIChunk(data);

      for (const chunk of chunks) {
        if (chunk.type === 'tool_call_fragment') {
          let state = chunk.index !== undefined ? toolCallsByIndex.get(chunk.index) : undefined;
          if (!state && chunk.id) state = toolCallsById.get(chunk.id);
          if (!state && chunk.index === undefined && chunk.id === undefined)
            state = mostRecentState;
          if (!state) {
            state = { started: false, pendingArguments: '' };
            toolCallStates.add(state);
          }
          mostRecentState = state;
          if (chunk.index !== undefined) toolCallsByIndex.set(chunk.index, state);
          if (chunk.id) {
            state.id = chunk.id;
            toolCallsById.set(chunk.id, state);
          }
          if (chunk.name) state.name = chunk.name;
          if (chunk.arguments) state.pendingArguments += chunk.arguments;

          if (!state.started && state.id && state.name) {
            state.started = true;
            yield { type: 'tool_call_start', id: state.id, name: state.name };
          }
          if (state.started && state.id && state.pendingArguments) {
            yield {
              type: 'tool_call_delta',
              id: state.id,
              input: state.pendingArguments,
            };
            state.pendingArguments = '';
          }
          continue;
        }

        if (chunk.type === 'done') {
          for (const state of toolCallStates) {
            if (state.started && state.id) {
              yield { type: 'tool_call_end', id: state.id };
            }
          }
          toolCallsByIndex.clear();
          toolCallsById.clear();
          toolCallStates.clear();
          mostRecentState = undefined;
        }

        yield chunk;
      }
    }
  }
}

export function supportsExplicitPromptCaching(modelId: string): boolean {
  return /^gpt-(5\.6|6(?:\.1)?)(?:-|$)/.test(modelId);
}

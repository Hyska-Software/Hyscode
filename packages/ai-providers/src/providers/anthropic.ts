import type {
  AIProvider,
  AIModel,
  ChatParams,
  StreamChunk,
  Message,
  ToolDefinition,
  FetchImpl,
  ThinkingVariants,
  ProviderCapabilities,
} from '../types';
import { ProviderError } from '../types';
import { parseSSEStream } from '../retry';

// ─── Anthropic Message Formatting ───────────────────────────────────────────

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContent[];
}

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue; // system prompt handled separately

    const role = msg.role === 'tool' ? 'user' : msg.role === 'user' ? 'user' : 'assistant';
    const content: AnthropicContent[] = [];

    for (const c of msg.content) {
      switch (c.type) {
        case 'text':
          content.push({ type: 'text', text: c.text });
          break;
        case 'image':
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: c.mediaType, data: c.base64 },
          });
          break;
        case 'tool_call':
          content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
          break;
        case 'tool_result':
          content.push({
            type: 'tool_result',
            tool_use_id: c.toolCallId,
            content: c.output,
            is_error: c.isError,
          });
          break;
      }
    }

    // Anthropic requires alternating user/assistant. Merge consecutive same-role messages
    const last = result[result.length - 1];
    if (last && last.role === role) {
      last.content.push(...content);
    } else {
      result.push({ role, content });
    }
  }

  return result;
}

function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

// ─── SSE Event Parsing ──────────────────────────────────────────────────────

interface AnthropicSSEEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Per-request usage state. Anthropic emits usage twice per request (message_start
 * carries input + cache fields; message_delta carries the final output). The
 * parser coalesces these so callers see exactly one consolidated usage chunk
 * per request — additive accumulation across iterations works correctly.
 */
interface AnthropicUsageState {
  inputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  emitted: boolean;
}

function parseAnthropicEvent(
  data: string,
  indexToId: Map<number, string>,
  usage: AnthropicUsageState,
): StreamChunk | null {
  let event: AnthropicSSEEvent;
  try {
    event = JSON.parse(data);
  } catch {
    return null;
  }

  switch (event.type) {
    case 'message_start':
      if (event.message?.usage) {
        // Capture input + cache; do NOT emit yet. We'll emit one consolidated
        // usage chunk when the request ends (message_delta) so accumulation
        // across iterations doesn't double-count.
        usage.inputTokens = event.message.usage.input_tokens ?? 0;
        usage.outputTokens = event.message.usage.output_tokens ?? 0;
        usage.cacheReadTokens = event.message.usage.cache_read_input_tokens;
        usage.cacheWriteTokens = event.message.usage.cache_creation_input_tokens;
        usage.emitted = false;
      }
      return null;

    case 'content_block_start':
      if (event.content_block?.type === 'tool_use') {
        // Store content block index → tool use ID mapping
        indexToId.set(event.index, event.content_block.id);
        return {
          type: 'tool_call_start',
          id: event.content_block.id,
          name: event.content_block.name,
        };
      }
      return null;

    case 'content_block_delta':
      if (event.delta?.type === 'thinking_delta') {
        return { type: 'thinking_delta', text: event.delta.thinking };
      }
      if (event.delta?.type === 'text_delta') {
        return { type: 'text_delta', text: event.delta.text };
      }
      if (event.delta?.type === 'input_json_delta') {
        return {
          type: 'tool_call_delta',
          id: indexToId.get(event.index) ?? String(event.index),
          input: event.delta.partial_json,
        };
      }
      return null;

    case 'content_block_stop':
      if (event.index !== undefined) {
        return { type: 'tool_call_end', id: indexToId.get(event.index) ?? String(event.index) };
      }
      return null;

    case 'message_delta':
      if (event.usage) {
        // Final output count for this request. Combine with the input + cache
        // we captured in message_start and emit a single consolidated usage
        // chunk. If a usage chunk was already emitted (rare edge: server
        // sends message_delta twice), update the output only and re-emit.
        usage.outputTokens = event.usage.output_tokens ?? usage.outputTokens;
        if (usage.emitted) {
          return null;
        }
        usage.emitted = true;
        const total = usage.inputTokens + usage.outputTokens;
        return {
          type: 'usage',
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: total,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
          },
        };
      }
      if (event.delta?.stop_reason) {
        const stopReason =
          event.delta.stop_reason === 'tool_use'
            ? 'tool_use'
            : event.delta.stop_reason === 'max_tokens'
              ? 'max_tokens'
              : 'end_turn';
        return {
          type: 'done',
          stopReason,
        };
      }
      return null;

    case 'message_stop':
      return null; // Already handled by message_delta

    case 'error':
      return {
        type: 'error',
        error: event.error?.message ?? 'Unknown Anthropic error',
        retryable: event.error?.type === 'overloaded_error',
      };

    default:
      return null;
  }
}

// ─── Thinking variant presets ────────────────────────────────────────────────
// Aligned with the official OpenCode built-in variants
// (https://dev.opencode.ai/docs/models/#variants):
//   Anthropic: high (default), max
// For adaptive models (opus 4.6+, sonnet 4.6, fable 5) the level maps to
// thinking.effort (low/medium/high; "max" → effort "high"). For budget models
// (opus ≤4-5, opus-4-1, sonnet 4, sonnet 4-5) the level maps to a
// thinking.budget_tokens preset.

/** Map an OpenCode thinking level to a budget_tokens preset for non-adaptive
 *  Anthropic models. The docs example uses 16000 for sonnet-4-5 ("high"). */
function budgetTokensForLevel(level?: string): number {
  switch (level) {
    case 'low':
      return 8_000;
    case 'medium':
      return 16_000;
    case 'high':
      return 24_000;
    case 'max':
      return 32_000;
    default:
      return 16_000;
  }
}

export const ADAPTIVE_CLAUDE_VARIANTS: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: true,
};

export const BUDGET_CLAUDE_VARIANTS: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: false,
};

// ─── Provider Implementation ────────────────────────────────────────────────

const ANTHROPIC_MODELS: AIModel[] = [
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 10,
    outputPricePerMToken: 50,
    thinkingVariants: ADAPTIVE_CLAUDE_VARIANTS,
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    thinkingVariants: ADAPTIVE_CLAUDE_VARIANTS,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    thinkingVariants: ADAPTIVE_CLAUDE_VARIANTS,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1,
    outputPricePerMToken: 5,
  },
];

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  readonly name = 'Anthropic';
  readonly capabilities: ProviderCapabilities = {
    promptCache: 'explicit-breakpoints',
    reasoningReplay: 'none',
    nativeTokenCounting: false,
    acceptsPromptCacheKey: false,
  };
  models: AIModel[] = [...ANTHROPIC_MODELS];

  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: FetchImpl;

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com', fetchImpl?: FetchImpl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async listModels(): Promise<AIModel[]> {
    return this.models;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const messages = toAnthropicMessages(params.messages);

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 8192,
      stream: true,
    };

    if (params.systemPrompt) {
      body.system = params.cachePrompt
        ? [{ type: 'text', text: params.systemPrompt, cache_control: { type: 'ephemeral' } }]
        : params.systemPrompt;
    }
    if (params.tools?.length) {
      const tools = toAnthropicTools(params.tools);
      if (params.cachePrompt && tools.length > 0) {
        body.tools = tools.map((tool, index) =>
          index === tools.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool,
        );
      } else {
        body.tools = tools;
      }
    }
    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }
    if (params.topP !== undefined) {
      body.top_p = params.topP;
    }
    if (params.stopSequences?.length) {
      body.stop_sequences = params.stopSequences;
    }
    if (params.thinking?.enabled) {
      const usesAdaptiveThinking = /claude-(?:fable-5|opus-4-[6-9]|sonnet-4-6)/.test(params.model);
      const thinkingConfig: Record<string, unknown> = {};

      if (usesAdaptiveThinking) {
        // Adaptive models accept thinking.type = 'adaptive' + an effort level.
        // The official OpenCode Anthropic variants are high (default) and max;
        // low/medium are also accepted by the API. "max" maps to effort "high"
        // (the strongest adaptive effort) since adaptive has no discrete "max".
        thinkingConfig.type = 'adaptive';
        const effort = params.thinking.level === 'max' ? 'high' : (params.thinking.level ?? 'high');
        thinkingConfig.effort = effort;
      } else {
        // Budget models accept thinking.type = 'enabled' + budget_tokens.
        // Sending "effort" here is invalid, so derive budget_tokens from the
        // level preset unless the caller supplied an explicit budgetTokens.
        thinkingConfig.type = params.thinking.type ?? 'enabled';
        if (params.thinking.budgetTokens) {
          thinkingConfig.budget_tokens = params.thinking.budgetTokens;
        } else {
          thinkingConfig.budget_tokens = budgetTokensForLevel(params.thinking.level);
        }
      }

      if (params.thinking.display) {
        thinkingConfig.display = params.thinking.display;
      }
      body.thinking = thinkingConfig;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        Authorization: `Bearer ${this.apiKey}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1_000 : undefined;
      throw new ProviderError(
        `Anthropic API error: ${response.status} ${errorBody}`,
        'anthropic',
        response.status,
        [429, 500, 502, 503, 529].includes(response.status),
        retryAfterMs,
      );
    }

    // Content block index → tool use ID mapping (populated by parseAnthropicEvent)
    const indexToId = new Map<number, string>();
    // Per-request usage accumulator (reset for each chat() call).
    const usage: AnthropicUsageState = { inputTokens: 0, outputTokens: 0, emitted: false };

    for await (const data of parseSSEStream(response, params.signal)) {
      const chunk = parseAnthropicEvent(data, indexToId, usage);
      if (!chunk) continue;
      yield chunk;
    }
  }
}

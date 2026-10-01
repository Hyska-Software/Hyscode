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
import { withOpencodeHeaders } from '../opencode-headers';

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
  if (!messages.length) throw new Error('model required: messages must not be empty');

  for (const msg of messages) {
    if (msg.role === 'system') continue; // system prompt handled separately

    const role = msg.role === 'tool' ? 'user' : msg.role === 'user' ? 'user' : 'assistant';
    const content: AnthropicContent[] = [];

    for (const c of msg.content) {
      switch (c.type) {
        case 'text':
          content.push({ type: 'text', text: c.text });
          break;
        case 'thinking':
          // Preserve thinking as text so replay/multi-turn history doesn't lose it.
          content.push({ type: 'text', text: `[thinking]${c.thinking}` });
          break;
        case 'image':
          if (c.base64.length > 20 * 1024 * 1024) {
            throw new Error('image too large: base64 payload exceeds 20MB');
          }
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
  } catch (error) {
    throw new ProviderError(
      `Malformed Anthropic SSE event: ${error instanceof Error ? error.message : String(error)}`,
      'anthropic',
      undefined,
      false,
      undefined,
      'invalid_response',
      'parsing',
    );
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
// Aligned with https://platform.claude.com/docs/en/models/overview (Oct 2026):
// current lineup is Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 4.5. Adaptive
// thinking (effort low/medium/high/xhigh/max) is always on for Fable 5.1 and
// Opus 5.5 and cannot be disabled; Sonnet 5.5 is adaptive with default high;
// Haiku 4.5 keeps manual extended thinking (budget_tokens).
// Legacy 4.x/5.0 models remain available via gateways, not direct.

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
    case 'xhigh':
    case 'max':
      return 32_000;
    default:
      return 16_000;
  }
}

/** Adaptive models with the full effort ladder and default high
 *  (fable 5.1, sonnet 5.5). */
export const ADAPTIVE_CLAUDE_XHIGH_VARIANTS: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: true,
};

/** Adaptive models with the full effort ladder and default medium
 *  (opus 5.5 — always-on adaptive thinking, API default medium). */
export const ADAPTIVE_CLAUDE_XHIGH_MEDIUM_VARIANTS: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
  supportsAdaptive: true,
};

/** Adaptive models that support max but not xhigh (opus 4.6, sonnet 4.6). */
export const ADAPTIVE_CLAUDE_VARIANTS: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: true,
};

/** Adaptive models limited to low/medium/high (opus 4.5). */
export const ADAPTIVE_CLAUDE_BASIC_VARIANTS: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'high',
  supportsAdaptive: true,
};

/** Extended-thinking (budget_tokens) models: sonnet 4.5, haiku 4.5. */
export const BUDGET_CLAUDE_VARIANTS: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: false,
};

// ─── Provider Implementation ────────────────────────────────────────────────

// SOTA-only direct catalog (verified Oct 2026 against
// https://platform.claude.com/docs/en/models/overview + /about-claude/pricing):
// the 4-model current lineup — Fable 5.1 (demanding reasoning, $10/$50,
// cache reads $0.25 = 2.5%), Opus 5.5 (agentic coding default, $4/$20,
// cache reads $0.20 = 5%), Sonnet 5.5 (speed+intelligence, $2/$10,
// cache reads $0.20), Haiku 4.5 (fastest, $1/$5, cache reads $0.10).
// Legacy models (Opus 5, Sonnet 5, 4.x) remain available via gateways.
const ANTHROPIC_MODELS: AIModel[] = [
  {
    id: 'claude-fable-5-1',
    name: 'Claude Fable 5.1',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 10,
    outputPricePerMToken: 50,
    cachedInputPricePerMToken: 0.25,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 4,
    outputPricePerMToken: 20,
    cachedInputPricePerMToken: 0.2,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_MEDIUM_VARIANTS,
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.2,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1,
    outputPricePerMToken: 5,
    cachedInputPricePerMToken: 0.1,
    thinkingVariants: BUDGET_CLAUDE_VARIANTS,
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
      const usesAdaptiveThinking =
        /claude-(?:fable-5|mythos-5|opus-5|opus-4-[5-9]|sonnet-5|sonnet-4-6)/.test(params.model);
      const thinkingConfig: Record<string, unknown> = {};

      if (usesAdaptiveThinking) {
        // Adaptive models accept thinking.type = 'adaptive' + an effort level.
        // Per docs/MODELS_REFERENCE.md §4 the effort parameter accepts
        // low/medium/high (all adaptive models), xhigh (fable 5, mythos 5,
        // opus 5, opus 4.8, opus 4.7, sonnet 5) and max — pass it through
        // unchanged so each model gets its exact supported level.
        thinkingConfig.type = 'adaptive';
        const level = params.thinking.level;
        thinkingConfig.effort = !level || level === 'enabled' ? 'high' : level;
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

    const url = `${this.baseUrl}/v1/messages`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: withOpencodeHeaders(
        {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        url,
        params.sessionId,
      ),
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

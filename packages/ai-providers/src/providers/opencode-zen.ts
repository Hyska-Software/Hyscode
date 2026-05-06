import type { AIModel, ChatParams, StreamChunk, FetchImpl } from '../types';
import { ProviderError } from '../types';
import { OpenAIProvider, toOpenAIMessages, toOpenAITools } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { parseSSEStream } from '../retry';

// ─── Model Routing ──────────────────────────────────────────────────────────
// Claude models use the Anthropic message format at /zen/v1/messages.
// Gemini models use the Google Gemini API format at /zen/v1/models/<model>.
// GPT models use the OpenAI Responses API at /zen/v1/responses.
// All other models use OpenAI-compatible chat completions at /zen/v1/chat/completions.

const ZEN_ANTHROPIC_MODELS = new Set([
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4',
  'claude-haiku-4-5',
  'claude-3-5-haiku',
]);

const ZEN_GPT_MODELS = new Set([
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5',
  'gpt-5-codex',
  'gpt-5-nano',
]);

const ZEN_GEMINI_MODELS = new Set([
  'gemini-3.1-pro',
  'gemini-3-flash',
]);

// ─── Static Model List ──────────────────────────────────────────────────────
// Sourced from https://opencode.ai/docs/zen — models and pricing as of May 2026.
// The listModels() method attempts to refresh this list from the live API.

const ZEN_MODELS: AIModel[] = [
  // ── Claude models (Anthropic format) ──────────────────────────────────────
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1,
    outputPricePerMToken: 5,
  },
  {
    id: 'claude-3-5-haiku',
    name: 'Claude Haiku 3.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.8,
    outputPricePerMToken: 4,
  },

  // ── GPT models (/zen/v1/responses) ────────────────────────────────────────
  {
    id: 'gpt-5.5',
    name: 'GPT 5.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 30,
  },
  {
    id: 'gpt-5.5-pro',
    name: 'GPT 5.5 Pro (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 30,
    outputPricePerMToken: 180,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT 5.4 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 15,
  },
  {
    id: 'gpt-5.4-pro',
    name: 'GPT 5.4 Pro (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 30,
    outputPricePerMToken: 180,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT 5.4 Mini (Zen)',
    provider: 'opencode-zen',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.75,
    outputPricePerMToken: 4.5,
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT 5.4 Nano (Zen)',
    provider: 'opencode-zen',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.2,
    outputPricePerMToken: 1.25,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT 5.3 Codex (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.75,
    outputPricePerMToken: 14,
  },
  {
    id: 'gpt-5.3-codex-spark',
    name: 'GPT 5.3 Codex Spark (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.75,
    outputPricePerMToken: 14,
  },
  {
    id: 'gpt-5.2',
    name: 'GPT 5.2 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.75,
    outputPricePerMToken: 14,
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT 5.2 Codex (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.75,
    outputPricePerMToken: 14,
  },
  {
    id: 'gpt-5.1',
    name: 'GPT 5.1 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.07,
    outputPricePerMToken: 8.5,
  },
  {
    id: 'gpt-5.1-codex',
    name: 'GPT 5.1 Codex (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.07,
    outputPricePerMToken: 8.5,
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT 5.1 Codex Max (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.25,
    outputPricePerMToken: 10,
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT 5.1 Codex Mini (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.25,
    outputPricePerMToken: 2,
  },
  {
    id: 'gpt-5',
    name: 'GPT 5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.07,
    outputPricePerMToken: 8.5,
  },
  {
    id: 'gpt-5-codex',
    name: 'GPT 5 Codex (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.07,
    outputPricePerMToken: 8.5,
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT 5 Nano (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },

  // ── Gemini models (/zen/v1/models/<model>) ────────────────────────────────
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2,
    outputPricePerMToken: 12,
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 3,
  },

  // ── OpenAI-compatible models (/zen/v1/chat/completions) ───────────────────
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus (Zen)',
    provider: 'opencode-zen',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 3,
  },
  {
    id: 'qwen3.5-plus',
    name: 'Qwen3.5 Plus (Zen)',
    provider: 'opencode-zen',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.2,
    outputPricePerMToken: 1.2,
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 204_800,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 1.2,
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 204_800,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 1.2,
  },
  {
    id: 'minimax-m2.5-free',
    name: 'MiniMax M2.5 Free (Zen)',
    provider: 'opencode-zen',
    contextWindow: 204_800,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
  {
    id: 'glm-5.1',
    name: 'GLM 5.1 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1.4,
    outputPricePerMToken: 4.4,
  },
  {
    id: 'glm-5',
    name: 'GLM 5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1,
    outputPricePerMToken: 3.2,
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.6,
    outputPricePerMToken: 3,
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.95,
    outputPricePerMToken: 4,
  },
  {
    id: 'big-pickle',
    name: 'Big Pickle (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
  {
    id: 'ling-2.6-flash',
    name: 'Ling 2.6 Flash (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
  {
    id: 'hy3-preview-free',
    name: 'Hy3 Preview Free (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
  {
    id: 'nemotron-3-super-free',
    name: 'Nemotron 3 Super Free (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
];

// ─── Provider Implementation ────────────────────────────────────────────────

export class OpenCodeZenProvider extends OpenAIProvider {
  override readonly id = 'opencode-zen' as const;
  override readonly name = 'OpenCode Zen';
  override models: AIModel[] = [...ZEN_MODELS];

  // Delegates Anthropic-format requests to a reusable AnthropicProvider
  // pointed at the Zen endpoint instead of api.anthropic.com.
  private readonly anthropicDelegate: AnthropicProvider;
  // Delegates Gemini-format requests to a reusable GeminiProvider
  // pointed at the Zen endpoint instead of generativelanguage.googleapis.com.
  private readonly geminiDelegate: GeminiProvider;

  constructor(apiKey: string, fetchImpl?: FetchImpl) {
    super(apiKey, 'https://opencode.ai/zen/v1', {}, fetchImpl);
    // Kimi/MiMo models require reasoning_content in every assistant+tool_calls message
    this.requiresReasoningContent = true;
    // AnthropicProvider appends /v1/messages to baseUrl → https://opencode.ai/zen/v1/messages
    this.anthropicDelegate = new AnthropicProvider(
      apiKey,
      'https://opencode.ai/zen',
      this.fetchImpl,
    );
    // GeminiProvider uses baseUrl/models/<model>:streamGenerateContent
    this.geminiDelegate = new GeminiProvider(
      apiKey,
      'https://opencode.ai/zen/v1',
      this.fetchImpl,
    );
  }

  /**
   * Attempts to refresh the model list from the live Zen API.
   * Falls back to the static list on any error.
   */
  override async listModels(): Promise<AIModel[]> {
    try {
      const response = await this.fetchImpl('https://opencode.ai/zen/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) return this.models;

      const data = (await response.json()) as unknown;
      const items: unknown[] = Array.isArray(data)
        ? data
        : (data as { data?: unknown[] }).data ?? [];

      if (!items.length) return this.models;

      const normalized: AIModel[] = items
        .filter((m): m is { id: string; name?: string } => typeof (m as { id?: unknown }).id === 'string')
        .map((m) => {
          // Prefer the static entry for known models (preserves pricing + capabilities)
          const known = ZEN_MODELS.find((x) => x.id === m.id);
          if (known) return { ...known, provider: 'opencode-zen' };
          return {
            id: m.id,
            name: m.name ?? m.id,
            provider: 'opencode-zen',
            contextWindow: 128_000,
            maxOutputTokens: 16_384,
            supportsTools: true,
            supportsStreaming: true,
            supportsVision: false,
          } satisfies AIModel;
        });

      if (normalized.length) this.models = normalized;
      return this.models;
    } catch {
      return this.models;
    }
  }

  /**
   * Routes GPT models through the OpenAI Responses API endpoint.
   * The Responses API uses a different wire format from chat completions.
   */
  private async *chatResponsesAPI(params: ChatParams): AsyncIterable<StreamChunk> {
    const messages = toOpenAIMessages(params.messages, params.systemPrompt, this.requiresReasoningContent);

    const body: Record<string, unknown> = {
      model: params.model,
      input: messages,
      stream: true,
    };

    if (params.tools?.length) body.tools = toOpenAITools(params.tools);
    if (params.maxTokens) body.max_output_tokens = params.maxTokens;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;
    if (params.stopSequences?.length) body.stop = params.stopSequences;
    if (params.thinking?.enabled && params.thinking.level && params.thinking.level !== 'disabled') {
      const effort = params.thinking.level === 'enabled' ? 'medium' : params.thinking.level;
      body.reasoning = { effort };
    }

    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1_000 : undefined;
      throw new ProviderError(
        `OpenCode Zen Responses API error: ${response.status} ${errorBody}`,
        this.id,
        response.status,
        [429, 500, 502, 503].includes(response.status),
        retryAfterMs,
      );
    }

    let currentToolCallId = '';

    for await (const data of parseSSEStream(response, params.signal)) {
      const chunks = this.parseResponsesChunk(data, currentToolCallId);
      for (const chunk of chunks) {
        if (chunk.type === 'tool_call_start') {
          currentToolCallId = chunk.id;
        }
        yield chunk;
      }
    }
  }

  /**
   * Parse a single SSE data chunk from the OpenAI Responses API.
   */
  private parseResponsesChunk(
    data: string,
    currentToolId: string,
  ): StreamChunk[] {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data);
    } catch {
      return [];
    }

    const eventType = parsed.type as string;

    switch (eventType) {
      case 'response.output_text.delta': {
        const delta = parsed.delta as string | undefined;
        if (delta) return [{ type: 'text_delta', text: delta }];
        break;
      }
      case 'response.content_part.added': {
        const part = parsed.part as Record<string, unknown> | undefined;
        if (part?.type === 'output_text' && part.text) {
          return [{ type: 'text_delta', text: part.text as string }];
        }
        break;
      }
      case 'response.output_item.added': {
        const item = parsed.item as Record<string, unknown> | undefined;
        if (item?.type === 'function_call') {
          const name = (item.name as string) ?? '';
          const callId = (item.call_id as string) ?? `call_${Date.now()}`;
          return [{ type: 'tool_call_start', id: callId, name }];
        }
        break;
      }
      case 'response.tool_call_arguments.delta': {
        const delta = parsed.delta as string | undefined;
        if (delta) {
          return [{ type: 'tool_call_delta', id: currentToolId, input: delta }];
        }
        break;
      }
      case 'response.completed': {
        const resp = parsed.response as Record<string, unknown> | undefined;
        const usage = resp?.usage as Record<string, unknown> | undefined;
        const chunks: StreamChunk[] = [];
        if (usage) {
          chunks.push({
            type: 'usage',
            usage: {
              inputTokens: (usage.input_tokens as number) ?? 0,
              outputTokens: (usage.output_tokens as number) ?? 0,
              totalTokens: (usage.total_tokens as number) ?? 0,
            },
          });
        }
        chunks.push({ type: 'done', stopReason: 'end_turn' });
        return chunks;
      }
    }

    return [];
  }

  override async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    if (ZEN_ANTHROPIC_MODELS.has(params.model)) {
      // Route Claude models through the Anthropic message format
      yield* this.anthropicDelegate.chat(params);
    } else if (ZEN_GEMINI_MODELS.has(params.model)) {
      // Route Gemini models through the Gemini API format
      yield* this.geminiDelegate.chat(params);
    } else if (ZEN_GPT_MODELS.has(params.model)) {
      // Route GPT models through the OpenAI Responses API
      yield* this.chatResponsesAPI(params);
    } else {
      // All other models use OpenAI-compatible chat completions
      yield* super.chat(params);
    }
  }
}

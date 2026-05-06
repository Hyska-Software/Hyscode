import type { AIModel, ChatParams, StreamChunk, FetchImpl } from '../types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

// ─── Model Routing ──────────────────────────────────────────────────────────
// Claude models use the Anthropic message format at /zen/v1/messages.
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

// ─── Static Model List ──────────────────────────────────────────────────────
// Sourced from https://opencode.ai/docs/zen — models and pricing as of April 2026.
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

  override async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    if (ZEN_ANTHROPIC_MODELS.has(params.model)) {
      // Route Claude models through the Anthropic message format
      yield* this.anthropicDelegate.chat(params);
    } else {
      // All other models use OpenAI-compatible chat completions
      yield* super.chat(params);
    }
  }
}

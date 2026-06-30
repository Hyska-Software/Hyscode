import type { AIModel, ChatParams, StreamChunk, FetchImpl, ThinkingVariants } from '../types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

// ─── Model Routing ──────────────────────────────────────────────────────────
// MiniMax and Qwen models use the Anthropic message format at /zen/go/v1/messages.
// All other models use OpenAI-compatible chat completions at /zen/go/v1/chat/completions.
// Source: https://dev.opencode.ai/docs/go (last updated Jun 30, 2026)

const GO_ANTHROPIC_MODELS = new Set([
  'minimax-m3',
  'minimax-m2.7',
  'minimax-m2.5',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
]);

// ─── Thinking variant presets ────────────────────────────────────────────────

const THINKING_KIMI: ThinkingVariants = {
  kind: 'kimi',
  levels: ['enabled', 'disabled'],
  defaultLevel: 'enabled',
};

const THINKING_DEEPSEEK: ThinkingVariants = {
  kind: 'deepseek',
  levels: ['enabled', 'disabled'],
  defaultLevel: 'enabled',
};

const THINKING_QWEN: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['enabled', 'disabled'],
  defaultLevel: 'enabled',
};

// ─── Static Model List ──────────────────────────────────────────────────────
// OpenCode Go is a $10/month subscription — pricing is not per-token.
// Context window and output limits sourced from official documentation.

const GO_MODELS: AIModel[] = [
  // ── OpenAI-compatible chat models (/zen/go/v1/chat/completions) ───────────
  {
    id: 'glm-5.2',
    name: 'GLM 5.2 (Go)',
    provider: 'opencode-go',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'glm-5.1',
    name: 'GLM 5.1 (Go)',
    provider: 'opencode-go',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code (Go)',
    provider: 'opencode-go',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6 (Go)',
    provider: 'opencode-go',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'mimo-v2.5',
    name: 'MiMo V2.5 (Go)',
    provider: 'opencode-go',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro (Go)',
    provider: 'opencode-go',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro (Go)',
    provider: 'opencode-go',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_DEEPSEEK,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash (Go)',
    provider: 'opencode-go',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_DEEPSEEK,
  },

  // ── Anthropic-compatible models (/zen/go/v1/messages) ────────────────────
  {
    id: 'minimax-m3',
    name: 'MiniMax M3 (Go)',
    provider: 'opencode-go',
    contextWindow: 204_800,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7 (Go)',
    provider: 'opencode-go',
    contextWindow: 204_800,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5 (Go)',
    provider: 'opencode-go',
    contextWindow: 204_800,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max (Go)',
    provider: 'opencode-go',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_QWEN,
  },
  {
    id: 'qwen3.7-plus',
    name: 'Qwen3.7 Plus (Go)',
    provider: 'opencode-go',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_QWEN,
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus (Go)',
    provider: 'opencode-go',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_QWEN,
  },
];

// ─── Provider Implementation ────────────────────────────────────────────────

export class OpenCodeGoProvider extends OpenAIProvider {
  override readonly id = 'opencode-go' as const;
  override readonly name = 'OpenCode Go';
  override models: AIModel[] = [...GO_MODELS];

  // Delegates Anthropic-format requests (MiniMax and Qwen models) to a reusable
  // AnthropicProvider pointed at the Go endpoint.
  private readonly anthropicDelegate: AnthropicProvider;

  constructor(apiKey: string, fetchImpl?: FetchImpl) {
    super(apiKey, 'https://opencode.ai/zen/go/v1', {}, fetchImpl);
    // Kimi/MiMo models require reasoning_content in every assistant+tool_calls message
    this.requiresReasoningContent = true;
    // AnthropicProvider appends /v1/messages to baseUrl → https://opencode.ai/zen/go/v1/messages
    this.anthropicDelegate = new AnthropicProvider(
      apiKey,
      'https://opencode.ai/zen/go',
      this.fetchImpl,
    );
  }

  override async listModels(): Promise<AIModel[]> {
    try {
      const response = await this.fetchImpl('https://opencode.ai/zen/go/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) return this.models;

      const data = (await response.json()) as { data?: Array<{ id?: string }> };
      const liveModels = (data.data ?? [])
        .filter((model): model is { id: string } => typeof model.id === 'string')
        .map((model) => {
          const known = GO_MODELS.find((candidate) => candidate.id === model.id);
          return (
            known ??
            ({
              id: model.id,
              name: `${model.id} (Go)`,
              provider: 'opencode-go',
              contextWindow: 1_000_000,
              maxOutputTokens: 16_384,
              supportsTools: true,
              supportsStreaming: true,
              supportsVision: false,
            } satisfies AIModel)
          );
        });

      if (liveModels.length) this.models = liveModels;
    } catch {
      // Keep the documented static fallback when the discovery endpoint is unavailable.
    }
    return this.models;
  }

  override async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    if (GO_ANTHROPIC_MODELS.has(params.model)) {
      // Route MiniMax and Qwen models through the Anthropic message format
      yield* this.anthropicDelegate.chat(params);
    } else {
      // All other models (GLM, Kimi, MiMo, DeepSeek) use OpenAI-compatible chat completions
      yield* super.chat(params);
    }
  }
}

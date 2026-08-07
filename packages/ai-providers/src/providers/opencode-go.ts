import type {
  AIModel,
  ChatParams,
  StreamChunk,
  FetchImpl,
  ProviderCapabilities,
  ThinkingVariants,
} from '../types';
import { OpenAIProvider, supportsExplicitPromptCaching } from './openai';
import { AnthropicProvider } from './anthropic';
import { chatResponsesAPI } from './openai-responses';

// ─── Model Routing ──────────────────────────────────────────────────────────
// GPT models use the OpenAI Responses API at /zen/go/v1/responses.
// MiniMax and Qwen models use the Anthropic message format at /zen/go/v1/messages.
// All other models use OpenAI-compatible chat completions at /zen/go/v1/chat/completions.
// Source: https://dev.opencode.ai/docs/go (last updated Jul 31, 2026)

const GO_GPT_MODELS = new Set(['gpt-5.6-luna']);

const GO_ANTHROPIC_MODELS = new Set([
  'minimax-m3',
  'minimax-m2.7',
  'minimax-m2.5',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
]);

// ─── Thinking variant presets ────────────────────────────────────────────────
// Per official provider docs (MiniMax, Moonshot, Zhipu/GLM, DeepSeek, Xiaomi/MiMo,
// xAI, Tencent/Hunyuan) — verified against vendor API references.

/** Toggle thinking (enable_thinking / thinking.type): GLM, MiMo, Qwen */
const THINKING_KIMI: ThinkingVariants = {
  kind: 'kimi',
  levels: ['enabled', 'disabled'],
  defaultLevel: 'enabled',
};

/** DeepSeek V4: reasoning effort high/max */
const THINKING_DEEPSEEK_TOGGLE: ThinkingVariants = {
  kind: 'openai',
  levels: ['high', 'max'],
  defaultLevel: 'max',
};

/** Qwen hybrid thinking: reasoning effort default/high/max */
const THINKING_QWEN: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'high', 'max'],
  defaultLevel: 'max',
};

/** Reasoning models with low/medium/high effort: grok-4.5 (xAI) */
const THINKING_REASONING_LMH: ThinkingVariants = {
  kind: 'openai',
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'high',
};

/** Kimi K3: reasoning_effort low/high/max (default max), cannot disable */
const THINKING_KIMI_K3: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'max'],
  defaultLevel: 'max',
};

/** GLM-5.2: reasoning effort default/high/max */
const THINKING_GLM: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'high', 'max'],
  defaultLevel: 'max',
};

/** MiniMax M3: thinking.type adaptive/disabled (adaptive = thinking on) */
const THINKING_MINIMAX_M3: ThinkingVariants = {
  kind: 'kimi',
  levels: ['adaptive', 'disabled'],
  defaultLevel: 'adaptive',
};

/** Always-on thinking (cannot be disabled): Kimi K2.7-code, MiniMax M2.x */
const THINKING_ALWAYS_ON: ThinkingVariants = {
  kind: 'kimi',
  levels: ['enabled'],
  defaultLevel: 'enabled',
};

// Hy3 = Tencent Hunyuan 3: OpenAI-compatible hybrid thinking via `reasoning_effort`.
// Official docs: levels none/low/medium/high (none = instant, no thinking).
const THINKING_HY3: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high'],
  defaultLevel: 'medium',
};

/** GPT full ladder + standard/pro mode: gpt-5.6-luna (Responses API) */
const THINKING_OPENAI_FULL_PRO: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
  modes: ['standard', 'pro'],
  defaultMode: 'standard',
};

// ─── Static Model List ──────────────────────────────────────────────────────
// OpenCode Go is a $10/month subscription — pricing is not per-token.
// Context window and output limits sourced from official documentation.

const GO_MODELS: AIModel[] = [
  // ── OpenAI-compatible chat models (/zen/go/v1/chat/completions) ───────────
  {
    id: 'grok-4.5',
    name: 'Grok 4.5 (Go)',
    provider: 'opencode-go',
    contextWindow: 500_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_REASONING_LMH,
  },
  {
    id: 'glm-5.2',
    name: 'GLM 5.2 (Go)',
    provider: 'opencode-go',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_GLM,
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
    id: 'kimi-k3',
    name: 'Kimi K3 (Go)',
    provider: 'opencode-go',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_KIMI_K3,
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
    thinkingVariants: THINKING_ALWAYS_ON,
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
    contextWindow: 1_000_000,
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
    contextWindow: 1_000_000,
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
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_DEEPSEEK_TOGGLE,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash NEW (Go)',
    provider: 'opencode-go',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_DEEPSEEK_TOGGLE,
  },
  {
    id: 'hy3',
    name: 'Hy3 (Go)',
    provider: 'opencode-go',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_HY3,
  },

  // ── OpenAI Responses API models (/zen/go/v1/responses) ───────────────────
  {
    id: 'gpt-5.6-luna',
    name: 'GPT 5.6 Luna (Go)',
    provider: 'opencode-go',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: THINKING_OPENAI_FULL_PRO,
  },

  // ── Anthropic-compatible models (/zen/go/v1/messages) ────────────────────
  {
    id: 'minimax-m3',
    name: 'MiniMax M3 (Go)',
    provider: 'opencode-go',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_MINIMAX_M3,
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7 (Go)',
    provider: 'opencode-go',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_ALWAYS_ON,
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5 (Go)',
    provider: 'opencode-go',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: THINKING_ALWAYS_ON,
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max (Go)',
    provider: 'opencode-go',
    contextWindow: 1_000_000,
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
    contextWindow: 1_000_000,
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
    contextWindow: 1_000_000,
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

  override get capabilities(): ProviderCapabilities {
    return {
      ...super.capabilities,
      promptCache: 'automatic-keyed',
      acceptsPromptCacheKey: true,
      promptCacheModeForModel: (modelId) => {
        if (GO_ANTHROPIC_MODELS.has(modelId)) return 'explicit-breakpoints';
        if (GO_GPT_MODELS.has(modelId) && supportsExplicitPromptCaching(modelId)) {
          return 'explicit-breakpoints';
        }
        return 'automatic-keyed';
      },
      acceptsPromptCacheKeyForModel: (modelId) =>
        GO_GPT_MODELS.has(modelId) && supportsExplicitPromptCaching(modelId),
    };
  }

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
    if (GO_GPT_MODELS.has(params.model)) {
      // Route GPT models through the OpenAI Responses API
      yield* chatResponsesAPI(params, {
        providerId: this.id,
        providerName: this.name,
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        fetchImpl: this.fetchImpl,
        supportsExplicitPromptCaching: supportsExplicitPromptCaching(params.model),
      });
    } else if (GO_ANTHROPIC_MODELS.has(params.model)) {
      // Route MiniMax and Qwen models through the Anthropic message format
      yield* this.anthropicDelegate.chat(params);
    } else {
      // All other models (GLM, Kimi, MiMo, DeepSeek) use OpenAI-compatible chat completions
      yield* super.chat(params);
    }
  }
}

import type { AIModel, ChatParams, StreamChunk, FetchImpl, ThinkingVariants } from '../types';
import { OpenAIProvider } from './openai';

// ─── OpenRouter Provider ────────────────────────────────────────────────────
// Reuses OpenAI adapter since OpenRouter is OpenAI-compatible.
// Only overrides: base URL, extra headers, and dynamic model listing.
// Catalog mirrors docs/MODELS_REFERENCE.md §3 (fallback selection).

// Thinking ladders (kept local to avoid cross-provider runtime coupling).
const OR_ADAPTIVE_XHIGH: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'high',
};
const OR_ADAPTIVE_MAX: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'max'],
  defaultLevel: 'high',
};
const OR_OPENAI_FULL: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
};
const OR_OPENAI_FULL_PRO: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
  modes: ['standard', 'pro'],
  defaultMode: 'standard',
};
const OR_OPENAI_HIGH: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high'],
  defaultLevel: 'medium',
};
const OR_GEMINI_LMH: ThinkingVariants = {
  kind: 'gemini',
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'medium',
};
const OR_GEMINI_LM: ThinkingVariants = {
  kind: 'gemini',
  levels: ['low', 'medium'],
  defaultLevel: 'medium',
};
const OR_LMH: ThinkingVariants = {
  kind: 'openai',
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'medium',
};
// Hy3 = Tencent Hunyuan 3: OpenAI reasoning_effort with none/low/medium/high.
const OR_HY3: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high'],
  defaultLevel: 'medium',
};
const OR_DEEPSEEK_LMH: ThinkingVariants = {
  kind: 'openai',
  levels: ['high', 'max'],
  defaultLevel: 'max',
};
const OR_KIMI_TOGGLE: ThinkingVariants = {
  kind: 'kimi',
  levels: ['enabled', 'disabled'],
  defaultLevel: 'enabled',
};
const OR_QWEN_TOGGLE: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['enabled', 'disabled'],
  defaultLevel: 'enabled',
};
/** Kimi K3: reasoning_effort default/max (default max), always on */
const OR_KIMI_K3: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'max'],
  defaultLevel: 'max',
};
/** MiniMax M3: thinking.type adaptive/disabled */
const OR_MINIMAX_M3: ThinkingVariants = {
  kind: 'kimi',
  levels: ['adaptive', 'disabled'],
  defaultLevel: 'adaptive',
};
/** Always-on thinking (cannot disable): Kimi K2.7-code */
const OR_ALWAYS_ON: ThinkingVariants = {
  kind: 'kimi',
  levels: ['enabled'],
  defaultLevel: 'enabled',
};

const OPENROUTER_MODELS: AIModel[] = [
  // ── Anthropic (adaptive thinking) ─────────────────────────────────────────
  {
    id: 'anthropic/claude-fable-5',
    name: 'Claude Fable 5 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 10,
    outputPricePerMToken: 50,
    thinkingVariants: OR_ADAPTIVE_XHIGH,
  },
  {
    id: 'anthropic/claude-opus-4.8',
    name: 'Claude Opus 4.8 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    thinkingVariants: OR_ADAPTIVE_XHIGH,
  },
  {
    id: 'anthropic/claude-sonnet-5',
    name: 'Claude Sonnet 5 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.2,
    thinkingVariants: OR_ADAPTIVE_XHIGH,
  },
  {
    id: 'anthropic/claude-opus-4-7',
    name: 'Claude Opus 4.7 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    thinkingVariants: OR_ADAPTIVE_XHIGH,
  },
  {
    id: 'anthropic/claude-opus-4-6',
    name: 'Claude Opus 4.6 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    thinkingVariants: OR_ADAPTIVE_MAX,
  },
  {
    id: 'anthropic/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    thinkingVariants: OR_ADAPTIVE_MAX,
  },
  // ── OpenAI (reasoning.effort) ─────────────────────────────────────────────
  {
    id: 'openai/gpt-5.6-sol',
    name: 'GPT-5.6 Sol (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 30,
    thinkingVariants: OR_OPENAI_FULL_PRO,
  },
  {
    id: 'openai/gpt-5.6-terra',
    name: 'GPT-5.6 Terra (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 15,
    thinkingVariants: OR_OPENAI_FULL_PRO,
  },
  {
    id: 'openai/gpt-5.6-luna',
    name: 'GPT-5.6 Luna (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1,
    outputPricePerMToken: 6,
    thinkingVariants: OR_OPENAI_FULL_PRO,
  },
  {
    id: 'openai/gpt-5.5',
    name: 'GPT-5.5 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 30,
    thinkingVariants: OR_OPENAI_FULL,
  },
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 15,
    thinkingVariants: OR_OPENAI_FULL,
  },
  {
    id: 'openai/gpt-5.4-mini',
    name: 'GPT-5.4 Mini (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.75,
    outputPricePerMToken: 4.5,
    thinkingVariants: OR_OPENAI_HIGH,
  },
  // ── Google Gemini (thinkingBudget) ────────────────────────────────────────
  {
    id: 'google/gemini-3.6-flash',
    name: 'Gemini 3.6 Flash (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.5,
    outputPricePerMToken: 9,
    thinkingVariants: OR_GEMINI_LMH,
  },
  {
    id: 'google/gemini-3.5-flash',
    name: 'Gemini 3.5 Flash (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.5,
    outputPricePerMToken: 9,
    thinkingVariants: OR_GEMINI_LMH,
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 2.5,
    thinkingVariants: OR_GEMINI_LM,
  },
  {
    id: 'google/gemini-3.1-pro',
    name: 'Gemini 3.1 Pro (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2,
    outputPricePerMToken: 12,
    thinkingVariants: OR_GEMINI_LMH,
  },
  {
    id: 'google/gemini-3-flash',
    name: 'Gemini 3 Flash (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 3,
    thinkingVariants: OR_GEMINI_LM,
  },
  // ── xAI ───────────────────────────────────────────────────────────────────
  {
    id: 'x-ai/grok-4.5',
    name: 'Grok 4.5 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 500_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 2,
    outputPricePerMToken: 6,
    thinkingVariants: OR_LMH,
  },
  {
    id: 'x-ai/grok-build-0.1',
    name: 'Grok Build 0.1 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1,
    outputPricePerMToken: 2,
  },
  // ── DeepSeek ──────────────────────────────────────────────────────────────
  {
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1.74,
    outputPricePerMToken: 3.48,
    thinkingVariants: OR_DEEPSEEK_LMH,
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.14,
    outputPricePerMToken: 0.28,
    thinkingVariants: OR_DEEPSEEK_LMH,
  },
  // ── Qwen ──────────────────────────────────────────────────────────────────
  {
    id: 'qwen/qwen3.7-max',
    name: 'Qwen3.7 Max (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 7.5,
    thinkingVariants: OR_QWEN_TOGGLE,
  },
  {
    id: 'qwen/qwen3.7-plus',
    name: 'Qwen3.7 Plus (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.4,
    outputPricePerMToken: 1.6,
    thinkingVariants: OR_QWEN_TOGGLE,
  },
  // ── Kimi (Moonshot) ───────────────────────────────────────────────────────
  {
    id: 'moonshotai/kimi-k3',
    name: 'Kimi K3 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    thinkingVariants: OR_KIMI_K3,
  },
  {
    id: 'moonshotai/kimi-k2.7-code',
    name: 'Kimi K2.7 Code (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.95,
    outputPricePerMToken: 4,
    thinkingVariants: OR_ALWAYS_ON,
  },
  {
    id: 'moonshotai/kimi-k2.6',
    name: 'Kimi K2.6 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.95,
    outputPricePerMToken: 4,
    thinkingVariants: OR_KIMI_TOGGLE,
  },
  // ── Z.ai GLM ──────────────────────────────────────────────────────────────
  {
    id: 'z-ai/glm-5.2',
    name: 'GLM 5.2 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1.4,
    outputPricePerMToken: 4.4,
    thinkingVariants: OR_KIMI_TOGGLE,
  },
  {
    id: 'z-ai/glm-5.1',
    name: 'GLM 5.1 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1.4,
    outputPricePerMToken: 4.4,
    thinkingVariants: OR_KIMI_TOGGLE,
  },
  // ── MiniMax ───────────────────────────────────────────────────────────────
  {
    id: 'minimax/minimax-m3',
    name: 'MiniMax M3 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 1.2,
    thinkingVariants: OR_MINIMAX_M3,
  },
  {
    id: 'tencent/hy3',
    name: 'Hy3 (Tencent Hunyuan 3) (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.14,
    outputPricePerMToken: 0.58,
    thinkingVariants: OR_HY3,
  },
  // ── Xiaomi MiMo ───────────────────────────────────────────────────────────
  {
    id: 'xiaomi/mimo-v2.5',
    name: 'MiMo V2.5 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.14,
    outputPricePerMToken: 0.28,
    thinkingVariants: OR_KIMI_TOGGLE,
  },
  {
    id: 'xiaomi/mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.435,
    outputPricePerMToken: 0.87,
    thinkingVariants: OR_KIMI_TOGGLE,
  },
];

export class OpenRouterProvider extends OpenAIProvider {
  override readonly id = 'openrouter' as const;
  override readonly name = 'OpenRouter';
  override models: AIModel[] = [...OPENROUTER_MODELS];

  constructor(apiKey: string, fetchImpl?: FetchImpl) {
    super(
      apiKey,
      'https://openrouter.ai/api/v1',
      {
        'HTTP-Referer': 'https://hyscode.dev',
        'X-Title': 'HysCode IDE',
      },
      fetchImpl,
    );
  }

  override async listModels(): Promise<AIModel[]> {
    try {
      const response = await this.fetchImpl('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) return this.models;

      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          name: string;
          context_length?: number;
          top_provider?: { max_completion_tokens?: number };
          pricing?: { prompt?: string; completion?: string };
          supported_parameters?: string[];
          architecture?: { input_modalities?: string[] };
          expiration_date?: string | null;
        }>;
      };

      if (data.data?.length) {
        const now = Date.now();
        this.models = data.data
          .filter((m) => {
            if (!m.id || !m.name) return false;
            if (!m.expiration_date) return true;
            return Date.parse(m.expiration_date) > now;
          })
          .map((m) => ({
            id: m.id,
            name: m.name,
            provider: 'openrouter',
            contextWindow: m.context_length ?? 1_000_000,
            maxOutputTokens: m.top_provider?.max_completion_tokens ?? 8_192,
            supportsTools: m.supported_parameters?.includes('tools') ?? false,
            supportsStreaming: true,
            supportsVision: m.architecture?.input_modalities?.includes('image') ?? false,
            inputPricePerMToken: m.pricing?.prompt
              ? parseFloat(m.pricing.prompt) * 1_000_000
              : undefined,
            outputPricePerMToken: m.pricing?.completion
              ? parseFloat(m.pricing.completion) * 1_000_000
              : undefined,
          }));
      }

      return this.models;
    } catch {
      return this.models;
    }
  }

  override async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    yield* super.chat(params);
  }
}

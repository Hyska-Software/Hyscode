import type { AIModel, ChatParams, StreamChunk, FetchImpl } from '../types';
import { OpenAIProvider } from './openai';

// ─── OpenRouter Provider ────────────────────────────────────────────────────
// Reuses OpenAI adapter since OpenRouter is OpenAI-compatible.
// Only overrides: base URL, extra headers, and dynamic model listing.

/** Maximum context window we expose in the UI */
const MAX_CONTEXT_WINDOW = 300_000;

const OPENROUTER_MODELS: AIModel[] = [
  {
    id: 'anthropic/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
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
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_535, // OpenRouter reports 65,535
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 2.5,
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.25,
    outputPricePerMToken: 10,
  },
  {
    id: 'meta-llama/llama-4-scout',
    name: 'Llama 4 Scout (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: MAX_CONTEXT_WINDOW,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1 (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
];

export class OpenRouterProvider extends OpenAIProvider {
  override readonly id = 'openrouter' as const;
  override readonly name = 'OpenRouter';
  override models: AIModel[] = [...OPENROUTER_MODELS];

  constructor(apiKey: string, fetchImpl?: FetchImpl) {
    super(apiKey, 'https://openrouter.ai/api/v1', {
      'HTTP-Referer': 'https://hyscode.dev',
      'X-Title': 'HysCode IDE',
    }, fetchImpl);
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
        }>;
      };

      if (data.data?.length) {
        this.models = data.data
          .filter((m) => m.id && m.name)
          .slice(0, 100) // Limit to top 100
          .map((m) => ({
            id: m.id,
            name: m.name,
            provider: 'openrouter',
            contextWindow: m.id?.startsWith('google/gemini') ? (m.context_length ?? 128_000) : Math.min(m.context_length ?? 128_000, MAX_CONTEXT_WINDOW),
            maxOutputTokens: m.top_provider?.max_completion_tokens ?? 8_192,
            supportsTools: true, // Most OpenRouter models support tools
            supportsStreaming: true,
            supportsVision: m.name.toLowerCase().includes('vision') || m.id.includes('gpt-4o') || m.id.includes('claude'),
            inputPricePerMToken: m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1_000_000 : undefined,
            outputPricePerMToken: m.pricing?.completion ? parseFloat(m.pricing.completion) * 1_000_000 : undefined,
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

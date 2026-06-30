import type { AIModel, ChatParams, StreamChunk, FetchImpl } from '../types';
import { OpenAIProvider } from './openai';

// ─── OpenRouter Provider ────────────────────────────────────────────────────
// Reuses OpenAI adapter since OpenRouter is OpenAI-compatible.
// Only overrides: base URL, extra headers, and dynamic model listing.

const OPENROUTER_MODELS: AIModel[] = [
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
  },
  {
    id: 'google/gemini-3.5-flash',
    name: 'Gemini 3.5 Flash (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.5,
    outputPricePerMToken: 9,
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite (via OpenRouter)',
    provider: 'openrouter',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.25,
    outputPricePerMToken: 1.5,
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
    contextWindow: 300_000,
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
            contextWindow: m.context_length ?? 128_000,
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

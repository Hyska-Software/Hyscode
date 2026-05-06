import type { AIModel, ChatParams, StreamChunk, FetchImpl } from '../types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

// ─── Model Routing ──────────────────────────────────────────────────────────
// MiniMax models use the Anthropic message format at /zen/go/v1/messages.
// All other models use OpenAI-compatible chat completions at /zen/go/v1/chat/completions.
// Source: https://opencode.ai/docs/go

const GO_ANTHROPIC_MODELS = new Set([
  'minimax-m2.7',
  'minimax-m2.5',
]);

// ─── Static Model List ──────────────────────────────────────────────────────
// OpenCode Go is a $10/month subscription — pricing is not per-token.
// Context window and output limits sourced from official documentation.

const GO_MODELS: AIModel[] = [
  {
    id: 'glm-5.1',
    name: 'GLM 5.1 (Go)',
    provider: 'opencode-go',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
  {
    id: 'glm-5',
    name: 'GLM 5 (Go)',
    provider: 'opencode-go',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5 (Go)',
    provider: 'opencode-go',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
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
  },
  {
    id: 'mimo-v2-pro',
    name: 'MiMo V2 Pro (Go)',
    provider: 'opencode-go',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
  {
    id: 'mimo-v2-omni',
    name: 'MiMo V2 Omni (Go)',
    provider: 'opencode-go',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
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
  },
  {
    id: 'qwen3.5-plus',
    name: 'Qwen3.5 Plus (Go)',
    provider: 'opencode-go',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
];

// ─── Provider Implementation ────────────────────────────────────────────────

export class OpenCodeGoProvider extends OpenAIProvider {
  override readonly id = 'opencode-go' as const;
  override readonly name = 'OpenCode Go';
  override models: AIModel[] = [...GO_MODELS];

  // Delegates Anthropic-format requests (MiniMax models) to a reusable
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
    return this.models;
  }

  override async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    console.log('[OpenCodeGoProvider] chat() model=', params.model, 'isAnthropic=', GO_ANTHROPIC_MODELS.has(params.model), 'requiresReasoningContent=', this.requiresReasoningContent);
    if (GO_ANTHROPIC_MODELS.has(params.model)) {
      // Route MiniMax models through the Anthropic message format
      yield* this.anthropicDelegate.chat(params);
    } else {
      // All other models use OpenAI-compatible chat completions
      yield* super.chat(params);
    }
  }
}

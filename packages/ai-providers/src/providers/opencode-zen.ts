import type {
  AIModel,
  ChatParams,
  StreamChunk,
  FetchImpl,
  ProviderCapabilities,
} from '../types';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OpenAIProvider, supportsExplicitPromptCaching } from './openai';
import { chatResponsesAPI } from './openai-responses';
import {
  ZEN_MODELS_URL,
  fetchLiveModelIds,
  resolveZenCatalog,
} from '../model-metadata/resolver';


// ─── Provider Implementation ────────────────────────────────────────────────

export class OpenCodeZenProvider extends OpenAIProvider {
  override readonly id = 'opencode-zen' as const;
  override readonly name = 'OpenCode Zen';
  override models: AIModel[] = resolveZenCatalog().models;
  /** Routing hints from the last resolution; refreshed by listModels(). */
  private wireFormats: Map<string, string> = new Map(resolveZenCatalog().wireFormats);

  override get capabilities(): ProviderCapabilities {
    return {
      ...super.capabilities,
      promptCache: 'automatic-keyed',
      acceptsPromptCacheKey: true,
      promptCacheModeForModel: (modelId) => {
        if (this.wireFormats.get(modelId) === 'anthropic-messages') return 'explicit-breakpoints';
        if (
          this.wireFormats.get(modelId) === 'responses' &&
          supportsExplicitPromptCaching(modelId)
        ) {
          return 'explicit-breakpoints';
        }
        return 'automatic-keyed';
      },
      acceptsPromptCacheKeyForModel: (modelId) =>
        this.wireFormats.get(modelId) === 'responses' && supportsExplicitPromptCaching(modelId),
    };
  }

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
    this.geminiDelegate = new GeminiProvider(apiKey, 'https://opencode.ai/zen/v1', this.fetchImpl);
  }

  /**
   * Refreshes the catalog from the live Zen gateway (issue #51): /v1/models
   * decides availability (C4); curated metadata keeps pricing/thinking for
   * known ids; unknown live ids bootstrap with conservative defaults. Any
   * failure keeps the current list (offline-first).
   */
  override async listModels(): Promise<AIModel[]> {
    const liveIds = await fetchLiveModelIds(ZEN_MODELS_URL, this.apiKey, this.fetchImpl);
    if (!liveIds) return this.models;
    const resolved = resolveZenCatalog({ liveIds });
    if (!resolved.models.length) return this.models;
    this.models = resolved.models;
    this.wireFormats = new Map(resolved.wireFormats);
    return this.models;
  }

  override dispose(): void {
    super.dispose();
    this.anthropicDelegate.dispose();
    this.geminiDelegate.dispose();
  }

  override async *chat(params: ChatParams): AsyncIterable<StreamChunk> {    switch (this.wireFormats.get(params.model) ?? 'chat-completions') {
      case 'anthropic-messages':
        // Claude and Anthropic-compatible Qwen models via Anthropic message format
        yield* this.anthropicDelegate.chat(params);
        break;
      case 'gemini':
        yield* this.geminiDelegate.chat(params);
        break;
      case 'responses':
        // Route GPT models through the OpenAI Responses API
        yield* chatResponsesAPI(params, {
          providerId: this.id,
          providerName: this.name,
          apiKey: this.apiKey,
          baseUrl: this.baseUrl,
          fetchImpl: this.fetchImpl,
          supportsExplicitPromptCaching: supportsExplicitPromptCaching(params.model),
        });
        break;
      default:
        // All other models (Kimi, MiniMax, GLM, DeepSeek, free tier) use OpenAI-compatible chat completions
        yield* super.chat(params);
    }
  }
}

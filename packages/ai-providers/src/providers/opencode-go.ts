import type {
  AIModel,
  ChatParams,
  StreamChunk,
  FetchImpl,
  ProviderCapabilities,
} from '../types';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider, supportsExplicitPromptCaching } from './openai';
import { chatResponsesAPI } from './openai-responses';
import {
  GO_MODELS_URL,
  fetchLiveModelIds,
  resolveGoCatalog,
} from '../model-metadata/resolver';


export class OpenCodeGoProvider extends OpenAIProvider {
  override readonly id = 'opencode-go' as const;
  override readonly name = 'OpenCode Go';
  override models: AIModel[] = resolveGoCatalog().models;
  /** Routing hints from the last resolution; refreshed by listModels(). */
  private wireFormats: Map<string, string> = new Map(resolveGoCatalog().wireFormats);

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

  /**
   * Refreshes the catalog from the live Go gateway (issue #51): /v1/models
   * decides availability; curated metadata keeps pricing/thinking for known
   * ids (Go gains per-token pricing for the first time); unknown live ids
   * bootstrap with conservative defaults. Any failure keeps the current list.
   */
  override async listModels(): Promise<AIModel[]> {
    const liveIds = await fetchLiveModelIds(GO_MODELS_URL, this.apiKey, this.fetchImpl);
    if (!liveIds) return this.models;
    const resolved = resolveGoCatalog({ liveIds });
    if (!resolved.models.length) return this.models;
    this.models = resolved.models;
    this.wireFormats = new Map(resolved.wireFormats);
    return this.models;
  }

  override dispose(): void {
    super.dispose();
    this.anthropicDelegate.dispose();
  }

  override async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    switch (this.wireFormats.get(params.model) ?? 'chat-completions') {      case 'responses':
        // Route GPT/Grok/Muse Spark models through the OpenAI Responses API
        yield* chatResponsesAPI(params, {
          providerId: this.id,
          providerName: this.name,
          apiKey: this.apiKey,
          baseUrl: this.baseUrl,
          fetchImpl: this.fetchImpl,
          supportsExplicitPromptCaching: supportsExplicitPromptCaching(params.model),
        });
        break;
      case 'anthropic-messages':
        // Route MiniMax and Qwen models through the Anthropic message format
        yield* this.anthropicDelegate.chat(params);
        break;
      default:
        // All other models (GLM, Kimi, MiMo, LongCat, DeepSeek, Hy3) use OpenAI-compatible chat completions
        yield* super.chat(params);
    }
  }
}

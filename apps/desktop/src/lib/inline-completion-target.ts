import {
  getProviderRegistry,
  type AIModel,
  type AIProvider,
  type ProviderRegistry,
} from '@hyscode/ai-providers';

const runtimeModelsCache = new WeakMap<AIProvider, Promise<AIModel[]>>();

export type InlineCompletionTarget = {
  providerId: string;
  providerName: string;
  modelId: string;
  model: AIModel | null;
  source: 'active' | 'explicit';
  isLocal: boolean;
};

export type InlineCompletionTargetResolution =
  | { status: 'ready'; target: InlineCompletionTarget }
  | { status: 'unavailable'; message: string };

async function getRuntimeModels(provider: AIProvider): Promise<AIModel[]> {
  if (provider.models.length > 0) return provider.models;

  const cached = runtimeModelsCache.get(provider);
  if (cached) return cached;

  const request = provider.listModels().catch(() => []);
  runtimeModelsCache.set(provider, request);
  return request;
}

export async function resolveInlineCompletionTarget(options: {
  inlineProviderId: string | null | undefined;
  inlineModelId: string | null | undefined;
  activeProviderId: string | null | undefined;
  activeModelId: string | null | undefined;
  registry?: ProviderRegistry;
  initialize?: () => Promise<void>;
}): Promise<InlineCompletionTargetResolution> {
  if (options.initialize) await options.initialize();

  const registry = options.registry ?? getProviderRegistry();
  const hasExplicitSelection =
    options.inlineProviderId != null || options.inlineModelId != null;
  const providerId = options.inlineProviderId ?? options.activeProviderId;
  const modelId = options.inlineModelId ?? options.activeModelId;

  if (!providerId || !modelId) {
    return {
      status: 'unavailable',
      message: hasExplicitSelection
        ? 'Choose a complete inline-completion provider and model.'
        : 'Choose an active AI provider and model in Settings → AI.',
    };
  }

  const provider = registry.get(providerId);
  if (!provider) {
    return {
      status: 'unavailable',
      message: `The selected provider (${providerId}) is not available.`,
    };
  }
  if (!provider.isConfigured()) {
    return {
      status: 'unavailable',
      message: `${provider.name} is not configured. Check Settings → AI.`,
    };
  }
  if (provider.capabilities?.agenticToolExecution === true) {
    return {
      status: 'unavailable',
      message: `${provider.name} is not eligible for low-latency inline completion.`,
    };
  }

  const models = await getRuntimeModels(provider);
  const model = models.find((candidate) => candidate.id === modelId) ?? null;
  const isAllowedCustomOpenRouterModel = providerId === 'openrouter' && modelId.trim().length > 0;

  if (!model && !isAllowedCustomOpenRouterModel) {
    return {
      status: 'unavailable',
      message: `The selected model is not available from ${provider.name}.`,
    };
  }

  return {
    status: 'ready',
    target: {
      providerId,
      providerName: provider.name,
      modelId,
      model,
      source: hasExplicitSelection ? 'explicit' : 'active',
      isLocal: providerId === 'ollama',
    },
  };
}

import {
  getProviderRegistry,
  ProviderError,
  type ChatParams,
  type ProviderErrorDetails,
  type StreamChunk,
} from '@hyscode/ai-providers';
import type { CustomModel } from '../stores/settings-store';
import { initProviders } from './init-providers';
import { getAllEnabledModelsGrouped } from './provider-catalog';

const COMMIT_MESSAGE_MAX_TOKENS = 2_048;

export type CommitMessageTarget = {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  isLocal: boolean;
};

export type CommitMessageProviderRequest = {
  providerId: string;
  modelId: string;
  systemPrompt: string;
  userMessage: string;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs?: number) => void;
};

export type ConfiguredCommitProvider = {
  id: string;
  modelIds: string[];
};

export type CommitMessageProviderGateway = {
  listConfiguredProviders: () => Promise<ConfiguredCommitProvider[]>;
  stream: (request: CommitMessageProviderRequest) => AsyncIterable<StreamChunk>;
};

export type CommitMessageTargetResolution =
  | { status: 'ready'; target: CommitMessageTarget }
  | { status: 'error'; message: string };

export function createCommitMessageChatParams(request: CommitMessageProviderRequest): ChatParams & {
  providerId: string;
  onRetry: (event: { attempt: number; delayMs?: number }) => void;
} {
  return {
    providerId: request.providerId,
    model: request.modelId,
    messages: [{ role: 'user', content: [{ type: 'text', text: request.userMessage }] }],
    systemPrompt: request.systemPrompt,
    maxTokens: COMMIT_MESSAGE_MAX_TOKENS,
    maxTurns: 1,
    signal: request.signal,
    onRetry: ({ attempt, delayMs }) => request.onRetry?.(attempt, delayMs),
  };
}

export const registryCommitMessageGateway: CommitMessageProviderGateway = {
  async listConfiguredProviders(): Promise<ConfiguredCommitProvider[]> {
    const registry = getProviderRegistry();
    return Promise.all(
      registry.listConfigured().map(async (provider) => ({
        id: provider.id,
        modelIds: (await provider.listModels()).map((model) => model.id),
      })),
    );
  },

  stream(request: CommitMessageProviderRequest): AsyncIterable<StreamChunk> {
    return getProviderRegistry().chat(createCommitMessageChatParams(request));
  },
};

export async function listCommitMessageTargets(
  enabledModels: Record<string, string[]>,
  customModels: CustomModel[],
  options: {
    gateway?: CommitMessageProviderGateway;
    initialize?: () => Promise<void>;
  } = {},
): Promise<CommitMessageTarget[]> {
  const gateway = options.gateway ?? registryCommitMessageGateway;
  await (options.initialize ?? initProviders)();
  const configured = await gateway.listConfiguredProviders();
  const configuredById = new Map(
    configured.map((provider) => [provider.id, new Set(provider.modelIds)]),
  );
  const customIds = new Set(customModels.map((model) => `${model.providerId}::${model.modelId}`));

  return getAllEnabledModelsGrouped(enabledModels, customModels).flatMap(({ provider, models }) => {
    const runtimeModels = configuredById.get(provider.id);
    if (!runtimeModels) return [];
    return models
      .filter(
        (model) => runtimeModels.has(model.id) || customIds.has(`${provider.id}::${model.id}`),
      )
      .map((model) => ({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        modelName: model.name,
        isLocal: provider.id === 'ollama',
      }));
  });
}

export function resolveCommitMessageTarget(options: {
  targets: CommitMessageTarget[];
  commitProviderId: string | null;
  commitModelId: string | null;
  activeProviderId: string | null;
  activeModelId: string | null;
}): CommitMessageTargetResolution {
  const hasSpecificSelection = options.commitProviderId !== null || options.commitModelId !== null;
  const providerId = hasSpecificSelection ? options.commitProviderId : options.activeProviderId;
  const modelId = hasSpecificSelection ? options.commitModelId : options.activeModelId;

  if (!providerId || !modelId) {
    return {
      status: 'error',
      message: hasSpecificSelection
        ? 'The selected commit-message model is incomplete. Choose it again.'
        : 'Configure an active AI provider and model in Settings → AI.',
    };
  }

  const target = options.targets.find(
    (candidate) => candidate.providerId === providerId && candidate.modelId === modelId,
  );
  if (!target) {
    return {
      status: 'error',
      message: hasSpecificSelection
        ? 'The selected commit-message model is unavailable. Choose another model.'
        : 'The active agent model is unavailable. Configure a provider or choose a commit model.',
    };
  }
  return { status: 'ready', target };
}

export function providerFailureDetails(error: unknown): ProviderErrorDetails | undefined {
  return error instanceof ProviderError ? error.toDetails() : undefined;
}

import { describe, expect, it } from 'vitest';
import {
  createCommitMessageChatParams,
  listCommitMessageTargets,
  resolveCommitMessageTarget,
  type CommitMessageProviderGateway,
  type CommitMessageTarget,
} from './commit-message-provider';

const gateway: CommitMessageProviderGateway = {
  listConfiguredProviders: async () => [
    { id: 'anthropic', modelIds: ['claude-sonnet-4-6'] },
    { id: 'openrouter', modelIds: ['anthropic/claude-sonnet-5'] },
  ],
  async *stream() {
    yield { type: 'done', stopReason: 'end_turn' };
  },
};

describe('commit-message provider targets', () => {
  it('builds a single-turn text request without tools, thinking, or temperature', () => {
    const params = createCommitMessageChatParams({
      providerId: 'claude-agent',
      modelId: 'claude',
      systemPrompt: 'system',
      userMessage: 'user',
    });

    expect(params).toMatchObject({
      providerId: 'claude-agent',
      model: 'claude',
      maxTokens: 2048,
      maxTurns: 1,
    });
    expect(params).not.toHaveProperty('tools');
    expect(params).not.toHaveProperty('thinking');
    expect(params).not.toHaveProperty('temperature');
  });

  it('keeps only configured, enabled runtime models plus explicit custom models', async () => {
    const targets = await listCommitMessageTargets(
      {
        anthropic: ['claude-sonnet-4-6', 'claude-opus-5'],
        openai: ['gpt-5.6-sol'],
        openrouter: ['anthropic/claude-sonnet-5', 'vendor/custom'],
      },
      [{ providerId: 'openrouter', modelId: 'vendor/custom', name: 'Custom' }],
      { gateway, initialize: async () => {} },
    );

    expect(targets.map((target) => `${target.providerId}::${target.modelId}`)).toEqual([
      'anthropic::claude-sonnet-4-6',
      'openrouter::anthropic/claude-sonnet-5',
      'openrouter::vendor/custom',
    ]);
  });

  it('uses an explicit valid selection before the active target', () => {
    const targets: CommitMessageTarget[] = [
      {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        modelId: 'commit-model',
        modelName: 'Commit',
        isLocal: false,
      },
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        modelId: 'active-model',
        modelName: 'Active',
        isLocal: false,
      },
    ];

    const resolution = resolveCommitMessageTarget({
      targets,
      commitProviderId: 'anthropic',
      commitModelId: 'commit-model',
      activeProviderId: 'openai',
      activeModelId: 'active-model',
    });

    expect(resolution).toEqual({ status: 'ready', target: targets[0] });
  });

  it('does not silently replace an unavailable persisted selection', () => {
    const resolution = resolveCommitMessageTarget({
      targets: [],
      commitProviderId: 'removed',
      commitModelId: 'removed-model',
      activeProviderId: 'openai',
      activeModelId: 'active-model',
    });

    expect(resolution.status).toBe('error');
    if (resolution.status === 'error') expect(resolution.message).toMatch(/unavailable/u);
  });
});

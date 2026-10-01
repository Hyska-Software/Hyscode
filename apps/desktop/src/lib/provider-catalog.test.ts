import { describe, expect, it } from 'vitest';
import { getProviderCatalog } from '@hyscode/ai-providers';
import {
  PROVIDERS,
  isModelEnabled,
  getEnabledModelsForProvider,
  getAllEnabledModelsGrouped,
} from './provider-catalog';

describe('desktop provider catalog parity', () => {
  const canonical = getProviderCatalog();

  it('mirrors the canonical ai-providers catalog exactly', () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(canonical.map((entry) => entry.id));
    for (const entry of canonical) {
      const uiProvider = PROVIDERS.find((provider) => provider.id === entry.id);
      expect(uiProvider?.name, entry.id).toBe(entry.name);
      expect(
        uiProvider?.models.map((model) => model.id),
        entry.id,
      ).toEqual(entry.models.map((model) => model.id));
    }
  });

  it('exposes thinking levels identical to the runtime variants', () => {
    for (const entry of canonical) {
      const uiProvider = PROVIDERS.find((provider) => provider.id === entry.id);
      for (const model of entry.models) {
        const uiModel = uiProvider?.models.find((candidate) => candidate.id === model.id);
        const expectedLevels =
          model.thinkingVariants && model.thinkingVariants.kind !== 'none'
            ? [...(model.thinkingVariants.levels ?? [])]
            : undefined;
        if (!expectedLevels) {
          expect(uiModel?.supportsThinking ?? false, `${entry.id}:${model.id}`).toBe(false);
          continue;
        }
        expect(uiModel?.supportsThinking, `${entry.id}:${model.id}`).toBe(true);
        expect(uiModel?.thinkingLevels, `${entry.id}:${model.id}`).toEqual(expectedLevels);
        expect(uiModel?.thinkingModes ?? [], `${entry.id}:${model.id}`).toEqual([
          ...(model.thinkingVariants?.modes ?? []),
        ]);
      }
    }
  });

  it('regression: ids previously drifted between surfaces', () => {
    const anthropicIds =
      PROVIDERS.find((provider) => provider.id === 'anthropic')?.models.map((model) => model.id) ??
      [];
    expect(anthropicIds).toContain('claude-fable-5-1');
    expect(anthropicIds).toContain('claude-sonnet-5-5');
    expect(anthropicIds).toContain('claude-haiku-4-5-20251001');
    expect(anthropicIds).not.toContain('claude-sonnet-4-5');

    const openrouterIds =
      PROVIDERS.find((provider) => provider.id === 'openrouter')?.models.map((model) => model.id) ??
      [];
    expect(openrouterIds).toContain('anthropic/claude-opus-4.8');

    const copilotIds =
      PROVIDERS.find((provider) => provider.id === 'github-copilot')?.models.map(
        (model) => model.id,
      ) ?? [];
    expect(copilotIds).toContain('gpt-6.1-sol');
    expect(copilotIds).toContain('claude-sonnet-5-5');

    const glm = PROVIDERS.find((provider) => provider.id === 'openrouter')?.models.find(
      (model) => model.id === 'z-ai/glm-5.2',
    );
    expect(glm?.thinkingLevels).toEqual(['enabled', 'disabled']);

    const nano = PROVIDERS.find((provider) => provider.id === 'openai')?.models.find(
      (model) => model.id === 'gpt-6-luna',
    );
    expect(nano?.supportsThinking).toBe(true);
    expect(nano?.thinkingLevels).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('keeps enablement and grouping semantics unchanged', () => {
    expect(isModelEnabled({}, 'anthropic', 'claude-opus-5-5')).toBe(true);
    expect(
      isModelEnabled({ anthropic: ['claude-opus-5-5'] }, 'anthropic', 'claude-haiku-4-5-20251001'),
    ).toBe(false);
    const grouped = getAllEnabledModelsGrouped({ anthropic: ['claude-opus-5-5'] }, [
      { providerId: 'openrouter', modelId: 'vendor/x', name: 'X' },
    ]);
    const anthropicGroup = grouped.find((group) => group.provider.id === 'anthropic');
    expect(anthropicGroup?.models.map((model) => model.id)).toEqual(['claude-opus-5-5']);
    expect(
      getEnabledModelsForProvider('openrouter', {}, [
        { providerId: 'openrouter', modelId: 'vendor/x', name: 'X' },
      ]).map((model) => model.id),
    ).toContain('vendor/x');
    expect(
      grouped
        .find((group) => group.provider.id === 'openrouter')
        ?.models.some((model) => model.id === 'vendor/x') ?? false,
    ).toBe(true);
  });
});

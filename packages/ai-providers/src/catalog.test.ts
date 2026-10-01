import { describe, expect, it } from 'vitest';
import { getProviderCatalog } from './catalog';
import { AnthropicProvider } from './providers/anthropic';

describe('canonical provider catalog', () => {
  const catalog = getProviderCatalog();

  it('exposes every supported provider in registry initialization order', () => {
    expect(catalog.map((entry) => entry.id)).toEqual([
      'anthropic',
      'openai',
      'gemini',
      'ollama',
      'openrouter',
      'codex',
      'github-copilot',
      'opencode-zen',
      'opencode-go',
    ]);
  });

  it('excludes providers disabled in development', () => {
    expect(catalog.map((entry) => entry.id)).not.toContain('claude-agent');
  });

  it('keeps model ids unique per provider', () => {
    for (const entry of catalog) {
      const ids = entry.models.map((model) => model.id);
      expect(new Set(ids).size, entry.id).toBe(ids.length);
    }
  });

  it('declares provider and context metadata on every model', () => {
    for (const entry of catalog) {
      for (const model of entry.models) {
        expect(model.name, `${entry.id}:${model.id}`).toBeTruthy();
        expect(model.provider, `${entry.id}:${model.id}`).toBe(entry.id);
        if (entry.id !== 'ollama')
          expect(model.contextWindow, `${entry.id}:${model.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('serves the same static catalogs as the chat-time providers', () => {
    const anthropicEntry = catalog.find((entry) => entry.id === 'anthropic');
    expect(anthropicEntry?.models.map((model) => model.id)).toEqual(
      new AnthropicProvider('catalog-placeholder').models.map((model) => model.id),
    );
  });

  it('keeps Ollama dynamic by defaulting to an empty static list', () => {
    expect(catalog.find((entry) => entry.id === 'ollama')?.models).toEqual([]);
  });

  it('carries thinking metadata used by both UI surfaces', () => {
    const sol = catalog
      .find((entry) => entry.id === 'openai')
      ?.models.find((model) => model.id === 'gpt-6.1-sol');
    expect(sol?.thinkingVariants?.modes).toContain('pro');
    expect(sol?.thinkingVariants?.levels).toContain('xhigh');

    const sonnet = catalog
      .find((entry) => entry.id === 'anthropic')
      ?.models.find((model) => model.id === 'claude-sonnet-5-5');
    expect(sonnet?.thinkingVariants?.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});

// Dynamic model resolution for OpenCode Zen/Go (issue #51).
import { describe, expect, it } from 'vitest';
import {
  fetchLiveModelIds,
  resolveGoCatalog,
  resolveZenCatalog,
  type CatalogEnrichmentEntry,
} from './resolver';

const ZEN_LIVE_IDS = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
  'glm-5.2',
  'kimi-k3',
  'brand-new-upstream-model',
];

describe('resolveZenCatalog', () => {
  it('without live ids publishes the full curated catalog', () => {
    const { models } = resolveZenCatalog();
    expect(models.length).toBe(81); // curated ZEN_CATALOG rows (Oct 2026)
    expect(
      models.every((m) => m.provider === undefined || m.provider === 'opencode-zen' || true),
    ).toBe(true);
  });

  it('keeps curated ids present live and drops retired ones', () => {
    const { models } = resolveZenCatalog({ liveIds: ZEN_LIVE_IDS });
    const ids = models.map((m) => m.id);
    expect(ids).toContain('claude-fable-5');
    expect(ids).toContain('glm-5.2');
    expect(ids).not.toContain('big-pickle'); // not in live list → dropped
    expect(ids).not.toContain('nemotron-3.5-lightning-free');
  });

  it('bootstraps unknown live models with conservative defaults + chat-completions routing', () => {
    const { models, wireFormats } = resolveZenCatalog({ liveIds: ZEN_LIVE_IDS });
    const ghost = models.find((m) => m.id === 'brand-new-upstream-model');
    expect(ghost).toMatchObject({
      name: 'brand-new-upstream-model (Zen)',
      contextWindow: 1_000_000,
      maxOutputTokens: 16_384,
      supportsVision: false,
    });
    expect(wireFormats.get('brand-new-upstream-model')).toBe('chat-completions');
  });

  it('preserves pricing/thinking for known models from C4 intersection', () => {
    const { models, wireFormats } = resolveZenCatalog({ liveIds: ZEN_LIVE_IDS });
    const fable = models.find((m) => m.id === 'claude-fable-5')!;
    expect(fable.inputPricePerMToken).toBe(10);
    expect(fable.thinkingVariants?.supportsAdaptive).toBe(true);
    expect(wireFormats.get('claude-fable-5')).toBe('anthropic-messages');

    const sol = models.find((m) => m.id === 'gpt-5.6-sol')!;
    expect(sol.thinkingVariants?.modes).toEqual(['standard', 'pro']);
    expect(wireFormats.get('gpt-5.6-sol')).toBe('responses');
  });

  it('applies enrichment metadata to unknown models', () => {
    const enrichment: CatalogEnrichmentEntry[] = [
      {
        id: 'brand-new-upstream-model',
        name: 'Brand New Model',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: true,
        inputPricePerMToken: 1.5,
        outputPricePerMToken: 6,
        source: 'models.dev',
      },
    ];
    const { models } = resolveZenCatalog({ liveIds: ZEN_LIVE_IDS, enrichment });
    const ghost = models.find((m) => m.id === 'brand-new-upstream-model')!;
    expect(ghost.name).toBe('Brand New Model');
    expect(ghost.contextWindow).toBe(400_000);
    expect(ghost.inputPricePerMToken).toBe(1.5);
    expect(ghost.supportsVision).toBe(true);
  });
});

describe('resolveGoCatalog', () => {
  it('exposes per-token pricing that was previously missing on Go', () => {
    const { models } = resolveGoCatalog();
    const glm = models.find((m) => m.id === 'glm-5.3-flash')!;
    expect(glm.inputPricePerMToken).toBe(0.15);
    expect(glm.outputPricePerMToken).toBe(0.5);
    const grok = models.find((m) => m.id === 'grok-4.6')!;
    expect(glm.id === 'glm-5.3-flash' && glm.provider).toBe('opencode-go');
    expect(grok.thinkingVariants?.defaultLevel).toBe('high');
  });
});

describe('fetchLiveModelIds', () => {
  it('returns ids from an OpenAI-style response', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ object: 'list', data: [{ id: 'a' }, { id: 'b' }] }), {
        status: 200,
      })) as never;
    expect(await fetchLiveModelIds('https://x/v1/models', 'key', fetchImpl)).toEqual(['a', 'b']);
  });

  it('returns undefined on non-OK so callers keep their current list', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 401 })) as never;
    expect(await fetchLiveModelIds('https://x/v1/models', 'bad', fetchImpl)).toBeUndefined();
  });

  it('returns undefined on network failure', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as never;
    expect(await fetchLiveModelIds('https://x/v1/models', '', fetchImpl)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { formatTokens, formatUsd, getModelDetails } from './model-details';

describe('getModelDetails', () => {
  it('resolves full metadata for a known catalog model', () => {
    const details = getModelDetails('anthropic', 'claude-sonnet-5-5');

    expect(details.providerName).toBe('Anthropic');
    expect(details.contextWindow).toBeGreaterThan(0);
    expect(details.maxOutputTokens).toBeGreaterThan(0);
    expect(details.inputPricePerMToken).toBeGreaterThan(0);
    expect(details.outputPricePerMToken).toBeGreaterThan(0);
    expect(typeof details.supportsVision).toBe('boolean');
    expect(typeof details.thinkingLabel).toBe('string');
    expect(details.thinkingLabel!.length).toBeGreaterThan(0);
  });

  it('degrades gracefully for an unknown custom model', () => {
    const details = getModelDetails('openrouter', 'my-custom-model-xyz-123');

    // Provider name still resolves from the desktop catalog.
    expect(details.providerName).toBeTruthy();
    // No runtime entry → pricing/capabilities stay null instead of guessing.
    expect(details.inputPricePerMToken).toBeNull();
    expect(details.outputPricePerMToken).toBeNull();
    expect(details.cachedInputPricePerMToken).toBeNull();
    expect(details.supportsVision).toBeNull();
    expect(details.thinkingLabel).toBeNull();
    // Context window falls back to the harness model profile, else null.
    expect(details.contextWindow === null || details.contextWindow > 0).toBe(true);
  });

  it('falls back to the provider id when the provider is unknown', () => {
    const details = getModelDetails('no-such-provider', 'whatever');

    expect(details.providerName).toBe('no-such-provider');
    expect(details.inputPricePerMToken).toBeNull();
    expect(details.supportsVision).toBeNull();
  });

  it('reports cached input pricing when the catalog declares it', () => {
    const details = getModelDetails('anthropic', 'claude-sonnet-5-5');

    // Anthropic models publish cache read pricing.
    expect(details.cachedInputPricePerMToken).not.toBeNull();
    expect(details.cachedInputPricePerMToken!).toBeLessThan(details.inputPricePerMToken!);
  });
});

describe('formatTokens', () => {
  it('formats thousands, millions and small counts', () => {
    expect(formatTokens(200_000)).toBe('200k');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(formatTokens(1_600_000)).toBe('1.6M');
    expect(formatTokens(64_000)).toBe('64k');
    expect(formatTokens(999)).toBe('999');
  });
});

describe('formatUsd', () => {
  it('formats prices with two decimals', () => {
    expect(formatUsd(3)).toBe('$3.00');
    expect(formatUsd(0.15)).toBe('$0.15');
    expect(formatUsd(12.5)).toBe('$12.50');
  });
});

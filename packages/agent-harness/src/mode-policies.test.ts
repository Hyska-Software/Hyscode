import { describe, expect, it } from 'vitest';
import { adjustPolicyForModel, getDefaultPolicy, isPerRequestCostModel } from './mode-policies';

describe('provider-aware mode policies', () => {
  it('caps requests only when the provider is GitHub Copilot', () => {
    expect(isPerRequestCostModel('gpt-5.4', 'openai')).toBe(false);
    expect(isPerRequestCostModel('gpt-5.4', 'github-copilot')).toBe(true);
    const openAi = adjustPolicyForModel(getDefaultPolicy('build'), 'gpt-5.4', 'openai');
    const copilot = adjustPolicyForModel(getDefaultPolicy('build'), 'gpt-5.4', 'github-copilot');
    expect(openAi.maxIterations).toBe(25);
    expect(copilot.maxIterations).toBe(8);
    expect(copilot.verificationRequired).toBe(true);
  });
});

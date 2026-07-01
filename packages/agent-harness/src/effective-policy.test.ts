import { beforeEach, describe, expect, it } from 'vitest';
import { resetAllPolicies } from './mode-policies';
import { resolveEffectiveAgentPolicy } from './effective-policy';

describe('resolveEffectiveAgentPolicy', () => {
  beforeEach(resetAllPolicies);

  it('gives an explicit user approval mode precedence over the mode default', () => {
    expect(
      resolveEffectiveAgentPolicy('build', 'model', 'provider', { approvalMode: 'manual' })
        .approval,
    ).toEqual({ mode: 'manual' });
  });

  it('retains custom category and tool rules only in custom mode', () => {
    const customApproval = {
      categoryOverrides: { terminal: true },
      toolOverrides: { write_file: false },
    };
    expect(
      resolveEffectiveAgentPolicy('build', 'model', 'provider', {
        approvalMode: 'custom',
        customApproval,
      }).approval,
    ).toEqual({ mode: 'custom', ...customApproval });
  });

  it('is unlimited by default and honors an explicit user limit', () => {
    expect(resolveEffectiveAgentPolicy('build', 'model', 'provider').maxIterations).toBeNull();
    expect(
      resolveEffectiveAgentPolicy('build', 'model', 'provider', { maxIterations: 42 })
        .maxIterations,
    ).toBe(42);
  });

  it('retains the GitHub Copilot cost cap and lets a lower user limit win', () => {
    expect(resolveEffectiveAgentPolicy('build', 'gpt-5.5', 'github-copilot').maxIterations).toBe(8);
    expect(
      resolveEffectiveAgentPolicy('build', 'gpt-5.5', 'github-copilot', {
        maxIterations: 4,
      }).maxIterations,
    ).toBe(4);
  });
});

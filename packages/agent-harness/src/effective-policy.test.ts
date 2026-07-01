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
});

import { describe, expect, it } from 'vitest';
import { decideCommitMessageApplication } from './use-commit-message-generation';

describe('commit-message application guard', () => {
  const baseline = {
    capturedRepositoryRoot: 'C:\\repo',
    currentRepositoryRoot: 'C:\\repo',
    capturedFingerprint: 'one',
    currentFingerprint: 'one',
    capturedMessage: '',
    currentMessage: '',
  };

  it('applies when repository, index, and draft are unchanged', () => {
    expect(decideCommitMessageApplication(baseline)).toBe('apply');
  });

  it('offers a suggestion instead of overwriting an edited draft', () => {
    expect(
      decideCommitMessageApplication({ ...baseline, currentMessage: 'user-authored message' }),
    ).toBe('suggest');
  });

  it('rejects results from a different workspace or staged index', () => {
    expect(
      decideCommitMessageApplication({ ...baseline, currentRepositoryRoot: 'C:\\other' }),
    ).toBe('stale');
    expect(decideCommitMessageApplication({ ...baseline, currentFingerprint: 'two' })).toBe(
      'stale',
    );
  });
});

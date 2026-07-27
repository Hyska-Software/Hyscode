import { describe, expect, it } from 'vitest';
import { decideExternalFileUpdate } from './file-store';

describe('external file update policy', () => {
  it('reloads a cached clean buffer so open editors and previews update', () => {
    expect(
      decideExternalFileUpdate({ hasAgentEdit: false, isDirty: false, isCached: true }),
    ).toBe('reload');
  });

  it('preserves dirty buffers and reports a conflict', () => {
    expect(
      decideExternalFileUpdate({ hasAgentEdit: false, isDirty: true, isCached: true }),
    ).toBe('mark-conflict');
  });

  it('does not replace an active agent edit', () => {
    expect(
      decideExternalFileUpdate({ hasAgentEdit: true, isDirty: false, isCached: true }),
    ).toBe('ignore-agent-edit');
  });

  it('does not read text for files that have no cached buffer', () => {
    expect(
      decideExternalFileUpdate({ hasAgentEdit: false, isDirty: false, isCached: false }),
    ).toBe('ignore-uncached');
  });
});

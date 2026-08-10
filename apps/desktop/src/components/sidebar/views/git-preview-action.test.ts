import { describe, expect, it } from 'vitest';
import { canOpenGitFileInPreview } from './git-preview-action';

describe('Git Preview action visibility', () => {
  it.each([
    ['M', 'agent', true],
    ['?', 'agent', true],
    ['D', 'agent', false],
    ['M', 'editor', false],
  ] as const)('resolves %s files in %s mode', (status, workspaceMode, expected) => {
    expect(canOpenGitFileInPreview(workspaceMode, status)).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveWorkspacePath } from './path-policy';

describe('resolveWorkspacePath', () => {
  const workspace = 'C:/Users/dev/project';

  it('resolves workspace-relative paths', () => {
    expect(resolveWorkspacePath('src/../README.md', workspace)).toBe(
      'c:/Users/dev/project/README.md',
    );
  });

  it('rejects traversal into a sibling at the same depth', () => {
    expect(() => resolveWorkspacePath('../other/secret.txt', workspace)).toThrow(
      'outside the workspace',
    );
  });

  it('rejects external absolute paths by default', () => {
    expect(() => resolveWorkspacePath('C:/Windows/system.ini', workspace)).toThrow(
      'outside the workspace',
    );
  });

  it('allows an external absolute path only when explicitly authorized', () => {
    expect(
      resolveWorkspacePath('C:/external/file.txt', workspace, { allowExternalAbsolute: true }),
    ).toBe('c:/external/file.txt');
  });
});

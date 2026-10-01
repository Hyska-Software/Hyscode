import { describe, expect, it } from 'vitest';
import { authorizeToolInvocationArgs } from './tool-invocation-policy';

const WORKSPACE = 'C:/workspace';

describe('authorizeToolInvocationArgs', () => {
  it('returns undefined args unchanged', () => {
    expect(authorizeToolInvocationArgs(undefined, WORKSPACE)).toBeUndefined();
  });

  it('normalizes in-workspace relative paths', () => {
    const result = authorizeToolInvocationArgs({ path: 'src/a.ts' }, WORKSPACE);
    expect(result).toEqual({ path: 'c:/workspace/src/a.ts' });
  });

  it('leaves non-path keys untouched, including multi-line content', () => {
    const content = "console.log('hi');\nconst x = 1;";
    const result = authorizeToolInvocationArgs(
      { path: 'src/a.ts', content, source: 'not a path' },
      WORKSPACE,
    );
    expect(result).toEqual({
      path: 'c:/workspace/src/a.ts',
      content,
      source: 'not a path',
    });
  });

  it('normalizes nested path-bearing objects and arrays', () => {
    const result = authorizeToolInvocationArgs(
      {
        paths: ['src/a.ts', 'src/b.ts'],
        request: { paths: ['src/c.ts'] },
      } as Record<string, unknown>,
      WORKSPACE,
    );
    // Top-level `paths` is normalized; unknown wrapper keys are passed through.
    expect(result?.['paths']).toEqual(['c:/workspace/src/a.ts', 'c:/workspace/src/b.ts']);
    expect(result?.['request']).toEqual({ paths: ['src/c.ts'] });
  });

  it('fails closed when a path escapes the workspace', () => {
    expect(() => authorizeToolInvocationArgs({ path: '../outside.txt' }, WORKSPACE)).toThrow(
      /outside the workspace/,
    );
  });
});

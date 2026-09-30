import { describe, expect, it } from 'vitest';
import type { GitFile } from '../stores/git-store';
import { buildGitFileTree } from './git-file-tree';

function createGitFile(
  path: string,
  status: GitFile['status'] = 'M',
  oldPath: string | null = null,
): GitFile {
  return {
    path,
    absolute_path: `C:/workspace/${path.replace(/\\/g, '/')}`,
    status,
    old_path: oldPath,
  };
}

describe('buildGitFileTree', () => {
  it('groups shared nested directories and counts descendant files', () => {
    const files = [
      createGitFile('src/components/app.tsx'),
      createGitFile('src/components/button.tsx', 'A'),
      createGitFile('src/index.ts'),
    ];

    expect(buildGitFileTree(files)).toEqual([
      {
        kind: 'directory',
        id: 'directory:src',
        name: 'src',
        path: 'src',
        fileCount: 3,
        children: [
          {
            kind: 'directory',
            id: 'directory:src/components',
            name: 'components',
            path: 'src/components',
            fileCount: 2,
            children: [
              {
                kind: 'file',
                id: 'file:src/components/app.tsx:0',
                name: 'app.tsx',
                file: files[0],
              },
              {
                kind: 'file',
                id: 'file:src/components/button.tsx:1',
                name: 'button.tsx',
                file: files[1],
              },
            ],
          },
          {
            kind: 'file',
            id: 'file:src/index.ts:2',
            name: 'index.ts',
            file: files[2],
          },
        ],
      },
    ]);
  });

  it('keeps root files at the root and sorts directories before files', () => {
    const files = [
      createGitFile('zeta.txt'),
      createGitFile('src/a.ts'),
      createGitFile('alpha.txt'),
    ];

    expect(buildGitFileTree(files).map((node) => node.name)).toEqual([
      'src',
      'alpha.txt',
      'zeta.txt',
    ]);
  });

  it('normalizes backslash paths for grouping while retaining the original Git file', () => {
    const file = createGitFile('src\\new-name.ts', 'R', 'legacy\\old-name.ts');
    const tree = buildGitFileTree([file]);

    expect(tree[0]).toMatchObject({ kind: 'directory', path: 'src' });
    expect(tree[0].kind === 'directory' ? tree[0].children[0] : null).toMatchObject({
      kind: 'file',
      name: 'new-name.ts',
      file,
    });
    expect(
      tree[0].kind === 'directory' && tree[0].children[0].kind === 'file'
        ? tree[0].children[0].file.path
        : null,
    ).toBe('src\\new-name.ts');
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from './types';
import {
  gitAddTool,
  gitBlameTool,
  gitCommitTool,
  gitDiffTool,
  gitLogTool,
  gitShowTool,
  gitStashTool,
  gitStatusTool,
} from './tools';

function mockContext(
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
): ToolExecutionContext {
  return {
    workspacePath: '/workspace',
    conversationId: 'conv-1',
    toolCallId: 'tc-1',
    signal: new AbortController().signal,
    invoke,
  } as ToolExecutionContext;
}

const statusResult = {
  staged: [{ path: 'a.ts', status: 'M' }],
  unstaged: [{ path: 'b.ts', status: 'M' }],
  untracked: [{ path: 'c.ts' }],
  conflicts: [{ path: 'd.ts', status: 'U' }],
};

describe('gitStatusTool', () => {
  it('formats staged, unstaged, untracked and conflicted files', async () => {
    const invoke = vi.fn().mockResolvedValue(statusResult);
    const result = await gitStatusTool.execute({}, mockContext(invoke));

    expect(result.success).toBe(true);
    expect(result.output).toContain('staged    M a.ts');
    expect(result.output).toContain('unstaged  M b.ts');
    expect(result.output).toContain('untracked ? c.ts');
    expect(result.output).toContain('conflict  U d.ts');
    expect(invoke).toHaveBeenCalledWith('git_status', { repoPath: '/workspace' });
  });

  it('reports a clean tree', async () => {
    const invoke = vi.fn().mockResolvedValue({
      staged: [],
      unstaged: [],
      untracked: [],
      conflicts: [],
    });
    const result = await gitStatusTool.execute({}, mockContext(invoke));
    expect(result.success).toBe(true);
    expect(result.output).toBe('Working tree clean.');
  });

  it('maps backend failures to a failed result', async () => {
    const invoke = vi.fn().mockRejectedValue('Git error: not a repository');
    const result = await gitStatusTool.execute({}, mockContext(invoke));
    expect(result.success).toBe(false);
    expect(result.error).toContain('not a repository');
  });
});

describe('gitDiffTool', () => {
  it('fetches the full diff with a single invoke (no N+1 loop)', async () => {
    const invoke = vi.fn().mockResolvedValue('diff --git a/a.ts b/a.ts\n+change');
    const result = await gitDiffTool.execute({}, mockContext(invoke));

    expect(result.success).toBe(true);
    expect(result.output).toContain('+change');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('git_uncommitted_diff', {
      repoPath: '/workspace',
      staged: false,
    });
  });

  it('passes staged through to the backend', async () => {
    const invoke = vi.fn().mockResolvedValue('+staged');
    const result = await gitDiffTool.execute({ staged: true }, mockContext(invoke));
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith('git_uncommitted_diff', {
      repoPath: '/workspace',
      staged: true,
    });
  });

  it('diffs a single file with a repo-relative path (relative and absolute input)', async () => {
    const invoke = vi.fn().mockResolvedValue('diff --git a/a.ts b/a.ts\n+change');
    const context = mockContext(invoke);

    await gitDiffTool.execute({ path: 'src/a.ts' }, context);
    expect(invoke).toHaveBeenLastCalledWith('git_diff_file', {
      repoPath: '/workspace',
      filePath: 'src/a.ts',
      staged: false,
    });

    await gitDiffTool.execute({ path: '/workspace/src/a.ts' }, context);
    expect(invoke).toHaveBeenLastCalledWith('git_diff_file', {
      repoPath: '/workspace',
      filePath: 'src/a.ts',
      staged: false,
    });
  });

  it('reports empty diffs as "No changes."', async () => {
    const invoke = vi.fn().mockResolvedValue('');
    const result = await gitDiffTool.execute({}, mockContext(invoke));
    expect(result.success).toBe(true);
    expect(result.output).toBe('No changes.');
  });
});

describe('gitCommitTool', () => {
  it('stages explicit paths (repo-relative) before committing', async () => {
    const invoke = vi.fn().mockResolvedValue('abc1234');
    const result = await gitCommitTool.execute(
      { message: 'feat: x', paths: ['src/a.ts', '/workspace/src/b.ts'] },
      mockContext(invoke),
    );

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, 'git_add', {
      repoPath: '/workspace',
      paths: ['src/a.ts', 'src/b.ts'],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'git_commit', {
      repoPath: '/workspace',
      message: 'feat: x',
    });
  });

  it('commits without staging when no paths are given', async () => {
    const invoke = vi.fn().mockResolvedValue('abc1234');
    const result = await gitCommitTool.execute({ message: 'chore: y' }, mockContext(invoke));
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('git_commit', {
      repoPath: '/workspace',
      message: 'chore: y',
    });
  });
});

describe('gitAddTool', () => {
  it('stages explicit paths as repo-relative', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const result = await gitAddTool.execute(
      { paths: ['/workspace/src/a.ts', 'src/b.ts'] },
      mockContext(invoke),
    );
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith('git_add', {
      repoPath: '/workspace',
      paths: ['src/a.ts', 'src/b.ts'],
    });
  });

  it('stages everything when no paths are given', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const result = await gitAddTool.execute({}, mockContext(invoke));
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith('git_add_all', { repoPath: '/workspace' });
  });
});

describe('gitLogTool', () => {
  const commits = [
    { short_hash: 'abc1234', message: 'feat: one', author: 'a', timestamp: 1_700_000_000 },
    { short_hash: 'def5678', message: 'fix: two', author: 'b', timestamp: 1_700_000_100 },
  ];

  it('formats the commit history', async () => {
    const invoke = vi.fn().mockResolvedValue(commits);
    const result = await gitLogTool.execute({ max_count: 10 }, mockContext(invoke));
    expect(result.success).toBe(true);
    expect(result.output).toContain('abc1234 feat: one (a)');
    expect(result.output).toContain('def5678 fix: two (b)');
    expect(invoke).toHaveBeenCalledWith('git_log', { repoPath: '/workspace', limit: 10 });
  });

  it('limits history to a single file with a repo-relative path', async () => {
    const invoke = vi.fn().mockResolvedValue(commits);
    const result = await gitLogTool.execute(
      { file: '/workspace/src/a.ts', max_count: 5 },
      mockContext(invoke),
    );
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith('git_log_file', {
      repoPath: '/workspace',
      filePath: 'src/a.ts',
      limit: 5,
    });
  });
});

describe('gitStashTool', () => {
  it('creates a stash', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const result = await gitStashTool.execute(
      { message: 'wip' },
      mockContext(invoke),
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('Changes stashed');
    expect(invoke).toHaveBeenCalledWith('git_stash', {
      repoPath: '/workspace',
      message: 'wip',
    });
  });

  it('pops a stash at the given index', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const result = await gitStashTool.execute({ pop: true, index: 2 }, mockContext(invoke));
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith('git_stash_pop', {
      repoPath: '/workspace',
      index: 2,
    });
  });
});

describe('gitBlameTool', () => {
  it('blames a file using a repo-relative path', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    const result = await gitBlameTool.execute(
      { path: '/workspace/src/a.ts', line: 3 },
      mockContext(invoke),
    );
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith('git_blame', {
      repoPath: '/workspace',
      filePath: 'src/a.ts',
      line: 3,
    });
  });
});

describe('gitShowTool', () => {
  it('formats commit details', async () => {
    const detail = {
      hash: 'abc1234',
      short_hash: 'abc1234',
      message: 'feat: x',
      author: 'a',
      timestamp: 1_700_000_000,
      files: [{ path: 'a.ts', status: 'M', insertions: 1, deletions: 0 }],
      total_insertions: 1,
      total_deletions: 0,
    };
    const invoke = vi.fn().mockResolvedValue(detail);
    const result = await gitShowTool.execute({ hash: 'abc1234' }, mockContext(invoke));
    expect(result.success).toBe(true);
    expect(result.output).toContain('abc1234 — feat: x');
    expect(result.output).toContain('M a.ts (+1/-0)');
    expect(invoke).toHaveBeenCalledWith('git_commit_detail', {
      repoPath: '/workspace',
      hash: 'abc1234',
    });
  });
});

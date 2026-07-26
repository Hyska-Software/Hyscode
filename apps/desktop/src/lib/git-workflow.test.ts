import { describe, expect, it } from 'vitest';
import {
  assertGitOperationAvailable,
  chooseDefaultGitRemote,
  getGitAutoFetchIntervalMs,
  getGitStatusBarPresentation,
  getCommitRemoteActions,
  getSourceControlPrimaryAction,
  isPathWithinGitRoot,
  isRepositoryOperationInProgress,
  shouldApplyGitResult,
  shouldConfirmGitDiscard,
} from './git-workflow';

describe('Git workflow state', () => {
  it('rejects a delayed result from a previous workspace generation', () => {
    expect(shouldApplyGitResult(4, 5, 'C:\\old', 'C:\\new')).toBe(false);
    expect(shouldApplyGitResult(5, 5, 'C:\\repo', 'C:\\repo')).toBe(true);
  });

  it('filters watcher events to the active worktree', () => {
    expect(isPathWithinGitRoot('C:\\repo\\src\\file.ts', 'C:\\repo')).toBe(true);
    expect(isPathWithinGitRoot('C:\\repository-other\\file.ts', 'C:\\repo')).toBe(false);
  });

  it('always confirms permanent deletion of untracked files', () => {
    expect(shouldConfirmGitDiscard([{ status: '?' }], false)).toBe(true);
    expect(shouldConfirmGitDiscard([{ status: 'M' }], false)).toBe(false);
    expect(shouldConfirmGitDiscard([{ status: 'M' }], true)).toBe(true);
  });

  it('derives Publish, Sync, and synchronized actions from upstream state', () => {
    expect(
      getSourceControlPrimaryAction({
        headState: 'branch',
        hasUpstream: false,
        hasRemotes: true,
        ahead: 0,
        behind: 0,
      }),
    ).toBe('publish');
    expect(
      getSourceControlPrimaryAction({
        headState: 'branch',
        hasUpstream: true,
        hasRemotes: true,
        ahead: 1,
        behind: 2,
      }),
    ).toBe('sync');
    expect(
      getSourceControlPrimaryAction({
        headState: 'branch',
        hasUpstream: true,
        hasRemotes: true,
        ahead: 0,
        behind: 0,
      }),
    ).toBe('synchronized');
  });

  it('prefers the configured upstream over a conventional remote name', () => {
    const remotes = [{ name: 'origin' }, { name: 'hyska' }];
    expect(chooseDefaultGitRemote('hyska', remotes)).toBe('hyska');
    expect(chooseDefaultGitRemote(null, remotes)).toBe('origin');
  });

  it('starts, reschedules, and stops auto-fetch from settings', () => {
    expect(getGitAutoFetchIntervalMs(true, 5, true)).toBe(300_000);
    expect(getGitAutoFetchIntervalMs(true, 15, true)).toBe(900_000);
    expect(getGitAutoFetchIntervalMs(false, 15, true)).toBeNull();
    expect(getGitAutoFetchIntervalMs(true, 15, false)).toBeNull();
  });

  it('blocks incompatible concurrent Git operations', () => {
    expect(() => assertGitOperationAvailable(null)).not.toThrow();
    expect(() => assertGitOperationAvailable('pull')).toThrow(
      "Git operation 'pull' is already running",
    );
  });

  it('does not treat a clean repository as an operation in progress', () => {
    expect(isRepositoryOperationInProgress('clean')).toBe(false);
    expect(isRepositoryOperationInProgress('merging')).toBe(true);
    expect(isRepositoryOperationInProgress('rebasing')).toBe(true);
  });

  it('represents repository lifecycle and HEAD states in the status bar', () => {
    expect(
      getGitStatusBarPresentation({
        repositoryState: 'error',
        repositoryError: 'permission denied',
        headState: 'unborn',
        currentBranch: '',
        repositoryOperation: 'clean',
      }),
    ).toEqual({
      label: 'Git error',
      title: 'permission denied',
      interactive: false,
    });

    expect(
      getGitStatusBarPresentation({
        repositoryState: 'ready',
        repositoryError: null,
        headState: 'detached',
        currentBranch: 'HEAD (abc1234)',
        repositoryOperation: 'rebasing',
      }),
    ).toEqual({
      label: 'HEAD (abc1234)',
      title: 'Detached HEAD — rebasing',
      interactive: true,
    });
  });

  it('integrates only valid remote follow-ups into the commit action menu', () => {
    expect(
      getCommitRemoteActions({
        headState: 'branch',
        hasUpstream: false,
        hasRemotes: false,
      }),
    ).toEqual([]);
    expect(
      getCommitRemoteActions({
        headState: 'branch',
        hasUpstream: false,
        hasRemotes: true,
      }),
    ).toEqual(['publish']);
    expect(
      getCommitRemoteActions({
        headState: 'branch',
        hasUpstream: true,
        hasRemotes: true,
      }),
    ).toEqual(['push', 'sync']);
    expect(
      getCommitRemoteActions({
        headState: 'detached',
        hasUpstream: false,
        hasRemotes: true,
      }),
    ).toEqual([]);
  });
});

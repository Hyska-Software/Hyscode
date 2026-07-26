export type SourceControlPrimaryAction = 'publish' | 'sync' | 'synchronized' | 'unavailable';
export type CommitRemoteAction = 'publish' | 'push' | 'sync';
export type GitRepositoryUiState =
  | 'no-workspace'
  | 'checking'
  | 'not-repository'
  | 'ready'
  | 'error';

export type GitStatusBarPresentation = {
  label: string;
  title: string;
  interactive: boolean;
};

export function shouldApplyGitResult(
  requestId: number,
  currentRequestId: number,
  requestRoot: string,
  currentRoot: string | null,
): boolean {
  return requestId === currentRequestId && requestRoot === currentRoot;
}

export function isPathWithinGitRoot(path: string, root: string): boolean {
  const normalize = (value: string): string =>
    value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const normalizedPath = normalize(path);
  const normalizedRoot = normalize(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function shouldConfirmGitDiscard(
  files: Array<{ status: string }>,
  confirmTrackedDiscard: boolean,
): boolean {
  return confirmTrackedDiscard || files.some((file) => file.status === '?');
}

export function getSourceControlPrimaryAction(options: {
  headState: 'branch' | 'detached' | 'unborn';
  hasUpstream: boolean;
  hasRemotes: boolean;
  ahead: number;
  behind: number;
}): SourceControlPrimaryAction {
  if (options.headState !== 'branch' || !options.hasRemotes) return 'unavailable';
  if (!options.hasUpstream) return 'publish';
  return options.ahead === 0 && options.behind === 0 ? 'synchronized' : 'sync';
}

export function getCommitRemoteActions(options: {
  headState: 'branch' | 'detached' | 'unborn';
  hasUpstream: boolean;
  hasRemotes: boolean;
}): CommitRemoteAction[] {
  if (options.headState !== 'branch') return [];
  if (options.hasUpstream) return ['push', 'sync'];
  return options.hasRemotes ? ['publish'] : [];
}

export function chooseDefaultGitRemote(
  upstreamRemote: string | null,
  remotes: Array<{ name: string }>,
): string | null {
  if (upstreamRemote && remotes.some((remote) => remote.name === upstreamRemote)) {
    return upstreamRemote;
  }
  if (remotes.length === 1) return remotes[0].name;
  return remotes.find((remote) => remote.name === 'origin')?.name ?? remotes[0]?.name ?? null;
}

export function getGitAutoFetchIntervalMs(
  enabled: boolean,
  intervalMinutes: number,
  hasWorkspace: boolean,
): number | null {
  if (!enabled || !hasWorkspace) return null;
  return Math.max(1, intervalMinutes) * 60_000;
}

export function assertGitOperationAvailable(activeOperation: string | null): void {
  if (activeOperation) {
    throw new Error(`Git operation '${activeOperation}' is already running`);
  }
}

export function isRepositoryOperationInProgress(operationState: string): boolean {
  return operationState !== 'clean';
}

export function getGitStatusBarPresentation(options: {
  repositoryState: GitRepositoryUiState;
  repositoryError: string | null;
  headState: 'branch' | 'detached' | 'unborn';
  currentBranch: string;
  repositoryOperation: string;
}): GitStatusBarPresentation {
  switch (options.repositoryState) {
    case 'no-workspace':
      return { label: 'No folder', title: 'Open a folder to use Git', interactive: false };
    case 'checking':
      return { label: 'Checking Git…', title: 'Checking repository state', interactive: false };
    case 'not-repository':
      return { label: 'No repository', title: 'The open folder is not a Git repository', interactive: false };
    case 'error':
      return {
        label: 'Git error',
        title: options.repositoryError ?? 'Git repository state could not be loaded',
        interactive: false,
      };
    case 'ready':
      break;
  }

  const operationSuffix = isRepositoryOperationInProgress(options.repositoryOperation)
    ? ` — ${options.repositoryOperation}`
    : '';
  if (options.headState === 'detached') {
    return {
      label: options.currentBranch || 'Detached HEAD',
      title: `Detached HEAD${operationSuffix}`,
      interactive: true,
    };
  }
  if (options.headState === 'unborn') {
    return {
      label: options.currentBranch || 'Unborn branch',
      title: `Repository has no commits yet${operationSuffix}`,
      interactive: true,
    };
  }
  return {
    label: options.currentBranch || 'HEAD',
    title: `Current branch: ${options.currentBranch || 'HEAD'}${operationSuffix}`,
    interactive: true,
  };
}

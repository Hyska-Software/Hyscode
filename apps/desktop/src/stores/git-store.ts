import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useFileStore } from './file-store';
import { useSettingsStore } from './settings-store';
import {
  tauriInvoke,
  type GitCommitContextContract,
  type GitFileContract,
  type GitRepositoryOperation,
} from '../lib/tauri-invoke';
import {
  assertGitOperationAvailable,
  getGitAutoFetchIntervalMs,
  isPathWithinGitRoot,
  shouldApplyGitResult,
} from '../lib/git-workflow';

// ── Types ────────────────────────────────────────────────────────────────────

export type GitFile = GitFileContract;

export interface GitStatusResult {
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
  conflicts: GitFile[];
}

export interface GitCommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
}

export interface GraphCommit {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  parents: string[];
  refs: string[];
}

export interface GitBranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  upstream: string | null;
}

export interface GitRemoteInfo {
  name: string;
  url: string;
}

export interface GitStashEntry {
  index: number;
  message: string;
}

export interface GitFileContent {
  original: string;
  modified: string;
}

export interface CommitFileChange {
  path: string;
  status: string;
  insertions: number;
  deletions: number;
}

export interface CommitDetail {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  files: CommitFileChange[];
  total_insertions: number;
  total_deletions: number;
}

export interface GitBlameHunk {
  start_line: number;
  lines_in_hunk: number;
  author: string;
  email: string;
  timestamp: number;
  short_hash: string;
  message: string;
}

// ── Store ────────────────────────────────────────────────────────────────────

interface GitState {
  repositoryState: 'no-workspace' | 'checking' | 'not-repository' | 'ready' | 'error';
  repositoryError: string | null;
  repositoryRoot: string | null;
  worktreeRoot: string | null;
  headState: 'branch' | 'detached' | 'unborn';
  upstream: { reference: string; remote: string | null; branch: string } | null;
  repositoryOperation: GitRepositoryOperation;
  activeOperation: string | null;
  // Status
  isGitRepo: boolean;
  currentBranch: string;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
  conflicts: GitFile[];
  branchChanges: GitFile[];
  ahead: number;
  behind: number;

  // Branch / Remote
  branches: GitBranchInfo[];
  remotes: GitRemoteInfo[];

  // Log
  log: GitCommitInfo[];

  // Graph
  graphLog: GraphCommit[];

  // Stash
  stashes: GitStashEntry[];

  // UI state
  isLoading: boolean;
  commitMessage: string;

  // Actions
  refresh: () => Promise<void>;
  /** Clear repository data before another project becomes active. */
  resetForProjectSwitch: () => void;
  stageFiles: (paths: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageFiles: (paths: string[]) => Promise<void>;
  discardFiles: (paths: string[]) => Promise<void>;
  commit: () => Promise<string>;
  amendCommit: () => Promise<string>;
  setCommitMessage: (msg: string) => void;
  checkoutBranch: (name: string) => Promise<void>;
  createBranch: (name: string, checkout: boolean, source?: string) => Promise<void>;
  deleteBranch: (name: string, force?: boolean) => Promise<void>;
  fetchBranches: () => Promise<void>;
  fetchLog: (limit?: number) => Promise<void>;
  fetchLogGraph: (limit?: number) => Promise<void>;
  fetchStashes: () => Promise<void>;
  stashChanges: (message?: string, includeUntracked?: boolean) => Promise<void>;
  popStash: (index: number) => Promise<void>;
  applyStash: (index: number) => Promise<void>;
  initRepo: () => Promise<void>;
  cloneRepository: (url: string, targetPath: string, branch?: string | null) => Promise<void>;
  addRemote: (name: string, url: string) => Promise<void>;
  removeRemote: (name: string) => Promise<void>;
  setRemoteUrl: (name: string, url: string) => Promise<void>;
  getFileContent: (
    filePath: string,
    mode?: 'staged' | 'unstaged' | 'conflict',
  ) => Promise<GitFileContent & { isBinary: boolean }>;
  getDiff: (filePath: string, staged: boolean) => Promise<string>;
  /** Legacy full staged diff retained for consumers not yet using structured context. */
  getStagedDiff: () => Promise<string>;
  getCommitContext: () => Promise<GitCommitContextContract>;
  getStagedFingerprint: () => Promise<string>;

  // New operations
  push: (remote?: string, branch?: string) => Promise<string>;
  publishBranch: (remote: string) => Promise<string>;
  pull: (remote?: string) => Promise<string>;
  fetch: (remote?: string) => Promise<string>;
  fetchAll: (prune?: boolean) => Promise<string>;
  mergeBranch: (branch: string) => Promise<string>;
  createTag: (name: string, message?: string) => Promise<void>;
  unstageAll: () => Promise<void>;
  discardAll: () => Promise<void>;
  getCommitDetail: (hash: string) => Promise<CommitDetail>;
  getCommitFileDiff: (hash: string, filePath: string) => Promise<string>;
  getBlame: (filePath: string, line?: number) => Promise<GitBlameHunk[]>;
  fetchBranchChanges: (baseBranch?: string) => Promise<void>;
  // Pull Request
  createPullRequest: (opts: {
    title: string;
    body?: string;
    base: string;
    head: string;
    draft?: boolean;
    baseRemote: string;
    headRemote: string;
  }) => Promise<string>;

  startAutoRefresh: () => Promise<void>;
  stopAutoRefresh: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resetRepositoryState(state: GitState, repositoryState: GitState['repositoryState']): void {
  state.repositoryState = repositoryState;
  state.repositoryError = null;
  state.repositoryRoot = null;
  state.worktreeRoot = null;
  state.headState = 'unborn';
  state.upstream = null;
  state.repositoryOperation = 'clean';
  state.activeOperation = null;
  state.isGitRepo = false;
  state.currentBranch = '';
  state.staged = [];
  state.unstaged = [];
  state.untracked = [];
  state.conflicts = [];
  state.branchChanges = [];
  state.ahead = 0;
  state.behind = 0;
  state.branches = [];
  state.remotes = [];
  state.log = [];
  state.graphLog = [];
  state.stashes = [];
  state.isLoading = false;
  state.commitMessage = '';
}

function getRootPath(): string | null {
  return useFileStore.getState().rootPath;
}

export const useGitStore = create<GitState>()(
  immer((set, get) => ({
    repositoryState: getRootPath() ? 'checking' : 'no-workspace',
    repositoryError: null,
    repositoryRoot: null,
    worktreeRoot: null,
    headState: 'unborn',
    upstream: null,
    repositoryOperation: 'clean',
    activeOperation: null,
    isGitRepo: false,
    currentBranch: '',
    staged: [],
    unstaged: [],
    untracked: [],
    conflicts: [],
    branchChanges: [],
    ahead: 0,
    behind: 0,
    branches: [],
    remotes: [],
    log: [],
    graphLog: [],
    stashes: [],
    isLoading: false,
    commitMessage: '',

    refresh: async () => {
      const rootPath = getRootPath();
      if (!rootPath) {
        set((state) => {
          resetRepositoryState(state, 'no-workspace');
        });
        return;
      }
      const requestId = ++_refreshGeneration;

      set((s) => {
        s.isLoading = true;
        s.repositoryError = null;
        if (s.repositoryState !== 'ready') s.repositoryState = 'checking';
      });

      try {
        const isRepo = await tauriInvoke('git_is_repo', { path: rootPath });
        if (!shouldApplyGitResult(requestId, _refreshGeneration, rootPath, getRootPath())) return;
        if (!isRepo) {
          set((s) => {
            resetRepositoryState(s, 'not-repository');
          });
          return;
        }

        const snapshot = await tauriInvoke('git_repository_snapshot', { repoPath: rootPath });
        if (!shouldApplyGitResult(requestId, _refreshGeneration, rootPath, getRootPath())) return;

        set((s) => {
          s.isGitRepo = true;
          s.repositoryState = 'ready';
          s.repositoryError = null;
          s.repositoryRoot = snapshot.repository_root;
          s.worktreeRoot = snapshot.worktree_root;
          s.headState = snapshot.head_state;
          s.upstream = snapshot.upstream;
          s.repositoryOperation = snapshot.operation_state;
          s.currentBranch =
            snapshot.current_branch ??
            (snapshot.head_state === 'detached'
              ? `HEAD (${snapshot.head_oid?.slice(0, 7) ?? ''})`
              : useSettingsStore.getState().gitDefaultBranch);
          s.staged = snapshot.staged;
          s.unstaged = snapshot.unstaged;
          s.untracked = snapshot.untracked;
          s.conflicts = snapshot.conflicts;
          s.remotes = snapshot.remotes;
          s.ahead = snapshot.ahead;
          s.behind = snapshot.behind;
          s.isLoading = false;
        });
      } catch (error) {
        if (!shouldApplyGitResult(requestId, _refreshGeneration, rootPath, getRootPath())) return;
        set((s) => {
          s.repositoryState = 'error';
          s.repositoryError = errorMessage(error);
          s.isLoading = false;
        });
      }
    },

    resetForProjectSwitch: () =>
      set((state) => {
        resetRepositoryState(state, 'checking');
      }),

    stageFiles: async (paths) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('stage', () => tauriInvoke('git_add', { repoPath: rootPath, paths }));
      await get().refresh();
    },

    stageAll: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('stage-all', () => tauriInvoke('git_add_all', { repoPath: rootPath }));
      await get().refresh();
    },

    unstageFiles: async (paths) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('unstage', () =>
        tauriInvoke('git_unstage', { repoPath: rootPath, paths }),
      );
      await get().refresh();
    },

    discardFiles: async (paths) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('discard', () =>
        tauriInvoke('git_discard', { repoPath: rootPath, paths }),
      );
      await get().refresh();
    },

    commit: async () => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const msg = get().commitMessage.trim();
      if (!msg) throw new Error('Commit message is empty');

      const hash = await runGitOperation('commit', () =>
        tauriInvoke('git_commit', { repoPath: rootPath, message: msg }),
      );
      set((s) => {
        s.commitMessage = '';
      });
      await get().refresh();
      return hash;
    },

    amendCommit: async () => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const msg = get().commitMessage.trim();
      if (!msg) throw new Error('Commit message is empty');

      const hash = await runGitOperation('commit-amend', () =>
        tauriInvoke('git_commit_amend', { repoPath: rootPath, message: msg }),
      );
      set((s) => {
        s.commitMessage = '';
      });
      await get().refresh();
      return hash;
    },

    setCommitMessage: (msg) =>
      set((s) => {
        s.commitMessage = msg;
      }),

    checkoutBranch: async (name) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('checkout', () =>
        tauriInvoke('git_checkout', { repoPath: rootPath, branch: name }),
      );
      await get().refresh();
      await get().fetchBranches();
    },

    createBranch: async (name, checkout, source) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('create-branch', () =>
        tauriInvoke('git_branch_create', {
          repoPath: rootPath,
          name,
          checkout,
          ...(source ? { source } : {}),
        }),
      );
      await get().refresh();
      await get().fetchBranches();
    },

    deleteBranch: async (name, force = false) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('delete-branch', () =>
        tauriInvoke('git_branch_delete', { repoPath: rootPath, name, force }),
      );
      await get().fetchBranches();
    },

    fetchBranches: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      try {
        const [branches, remotes] = await Promise.all([
          tauriInvoke('git_branch_list', { repoPath: rootPath }),
          tauriInvoke('git_remote_list', { repoPath: rootPath }),
        ]);
        set((s) => {
          s.branches = branches as GitBranchInfo[];
          s.remotes = remotes as GitRemoteInfo[];
        });
      } catch (error) {
        set((state) => {
          state.repositoryError = errorMessage(error);
        });
        throw error;
      }
    },

    fetchLog: async (limit = 50) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      try {
        const log = await tauriInvoke('git_log', { repoPath: rootPath, limit });
        set((s) => {
          s.log = log as GitCommitInfo[];
        });
      } catch (error) {
        set((state) => {
          state.repositoryError = errorMessage(error);
        });
        throw error;
      }
    },

    fetchLogGraph: async (limit = 200) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      try {
        const graph = await tauriInvoke('git_log_graph', { repoPath: rootPath, limit });
        set((s) => {
          s.graphLog = graph as GraphCommit[];
        });
      } catch (error) {
        set((state) => {
          state.repositoryError = errorMessage(error);
        });
        throw error;
      }
    },

    fetchStashes: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      try {
        const stashes = await tauriInvoke('git_stash_list', { repoPath: rootPath });
        set((s) => {
          s.stashes = stashes as GitStashEntry[];
        });
      } catch (error) {
        set((state) => {
          state.stashes = [];
          state.repositoryError = errorMessage(error);
        });
        throw error;
      }
    },

    stashChanges: async (message, includeUntracked = false) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('stash', () =>
        tauriInvoke('git_stash', {
          repoPath: rootPath,
          message: message ?? null,
          includeUntracked,
        }),
      );
      await get().refresh();
      await get().fetchStashes();
    },

    popStash: async (index) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('stash-pop', () =>
        tauriInvoke('git_stash_pop', { repoPath: rootPath, index }),
      );
      await get().refresh();
      await get().fetchStashes();
    },

    applyStash: async (index) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('stash-apply', () =>
        tauriInvoke('git_stash_apply', { repoPath: rootPath, index }),
      );
      await get().refresh();
    },

    initRepo: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('init', () =>
        tauriInvoke('git_init', {
          path: rootPath,
          initialBranch: useSettingsStore.getState().gitDefaultBranch,
        }),
      );
      await get().refresh();
    },

    cloneRepository: async (url, targetPath, branch = null) => {
      await runGitOperation('clone', () =>
        tauriInvoke('git_clone', {
          url,
          targetPath,
          branch: branch || null,
        }),
      );
    },

    addRemote: async (name, url) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('remote-add', () =>
        tauriInvoke('git_remote_add', { repoPath: rootPath, name, url }),
      );
      await get().refresh();
      await get().fetchBranches();
    },

    removeRemote: async (name) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('remote-remove', () =>
        tauriInvoke('git_remote_remove', { repoPath: rootPath, name }),
      );
      await get().refresh();
      await get().fetchBranches();
    },

    setRemoteUrl: async (name, url) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('remote-set-url', () =>
        tauriInvoke('git_remote_set_url', { repoPath: rootPath, name, url }),
      );
      await get().refresh();
      await get().fetchBranches();
    },

    getFileContent: async (filePath, mode = 'unstaged') => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const content = await tauriInvoke('git_diff_content', {
        repoPath: rootPath,
        filePath,
        mode,
      });
      return {
        original: content.original ?? '',
        modified: content.modified ?? '',
        isBinary: content.is_binary,
      };
    },

    getDiff: async (filePath: string, staged: boolean) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return tauriInvoke('git_diff_file', { repoPath: rootPath, filePath, staged });
    },

    getStagedDiff: async () => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return tauriInvoke('git_diff_staged_all', { repoPath: rootPath });
    },

    getCommitContext: async () => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return tauriInvoke('git_commit_context', { repoPath: rootPath });
    },

    getStagedFingerprint: async () => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return tauriInvoke('git_staged_fingerprint', { repoPath: rootPath });
    },

    push: async (remote, branch) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await runGitOperation('push', () =>
        tauriInvoke('git_push', {
          repoPath: rootPath,
          ...(remote ? { remote } : {}),
          ...(branch ? { branch } : {}),
        }),
      );
      await get().refresh();
      return result;
    },

    publishBranch: async (remote) => {
      const rootPath = getRootPath();
      const branch = get().currentBranch;
      if (!rootPath || !branch || get().headState !== 'branch') {
        throw new Error('A named branch is required before publishing');
      }
      const result = await runGitOperation('publish', () =>
        tauriInvoke('git_publish_branch', { repoPath: rootPath, remote, branch }),
      );
      await get().refresh();
      await get().fetchBranches();
      return result;
    },

    pull: async (remote) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await runGitOperation('pull', () =>
        tauriInvoke('git_pull', {
          repoPath: rootPath,
          ...(remote ? { remote } : {}),
        }),
      );
      await get().refresh();
      return result;
    },

    fetch: async (remote) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await runGitOperation('fetch', () =>
        tauriInvoke('git_fetch', {
          repoPath: rootPath,
          ...(remote ? { remote } : {}),
        }),
      );
      await get().refresh();
      await get().fetchBranches();
      return result;
    },

    fetchAll: async (prune = false) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await runGitOperation('fetch-all', () =>
        tauriInvoke('git_fetch_all', { repoPath: rootPath, prune }),
      );
      await get().refresh();
      await get().fetchBranches();
      return result;
    },

    mergeBranch: async (branch) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await runGitOperation('merge', () =>
        tauriInvoke('git_merge', { repoPath: rootPath, branch }),
      );
      await get().refresh();
      return result;
    },

    createTag: async (name, message) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await runGitOperation('create-tag', () =>
        tauriInvoke('git_tag_create', {
          repoPath: rootPath,
          name,
          ...(message ? { message } : {}),
        }),
      );
    },

    unstageAll: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      const staged = get().staged;
      if (staged.length === 0) return;
      await runGitOperation('unstage-all', () =>
        tauriInvoke('git_unstage', {
          repoPath: rootPath,
          paths: staged.map((file) => file.path),
        }),
      );
      await get().refresh();
    },

    discardAll: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      const { unstaged, untracked } = get();
      const allPaths = [...unstaged, ...untracked].map((f) => f.path);
      if (allPaths.length === 0) return;
      await runGitOperation('discard-all', () =>
        tauriInvoke('git_discard', { repoPath: rootPath, paths: allPaths }),
      );
      await get().refresh();
    },

    getCommitDetail: async (hash: string) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return tauriInvoke('git_commit_detail', { repoPath: rootPath, hash });
    },

    getCommitFileDiff: async (hash: string, filePath: string) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return tauriInvoke('git_commit_file_diff', { repoPath: rootPath, hash, filePath });
    },

    getBlame: async (filePath: string, line?: number) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return tauriInvoke('git_blame', {
        repoPath: rootPath,
        filePath,
        ...(line !== undefined ? { line } : {}),
      });
    },

    fetchBranchChanges: async (baseBranch?: string) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      try {
        const files = await tauriInvoke('git_branch_changes', {
          repoPath: rootPath,
          ...(baseBranch ? { baseBranch } : {}),
        });
        set((s) => {
          s.branchChanges = files;
        });
      } catch (error) {
        set((s) => {
          s.branchChanges = [];
          s.repositoryError = errorMessage(error);
        });
      }
    },

    createPullRequest: async (opts) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await runGitOperation('create-pull-request', () =>
        tauriInvoke('github_create_pull_request', {
          repoPath: rootPath,
          baseRemote: opts.baseRemote,
          headRemote: opts.headRemote,
          payload: {
            title: opts.title,
            body: opts.body ?? null,
            head: opts.head,
            base: opts.base,
            draft: opts.draft ?? null,
          },
        }),
      );
      return result.url;
    },

    startAutoRefresh: async () => {
      // Guard: only start once
      if (_autoRefreshUnlisten) return;
      const rootPath = getRootPath();
      if (!rootPath) return;

      _autoRefreshUnlisten = await listen<{ kind: string; paths: string[] }>(
        'fs:changed',
        (event) => {
          const root = useGitStore.getState().worktreeRoot;
          if (!root || !event.payload.paths.some((path) => isPathWithinGitRoot(path, root))) return;
          if (_autoRefreshTimer) clearTimeout(_autoRefreshTimer);
          _autoRefreshTimer = setTimeout(() => {
            useGitStore.getState().refresh();
          }, 400);
        },
      );
    },

    stopAutoRefresh: () => {
      if (_autoRefreshUnlisten) {
        _autoRefreshUnlisten();
        _autoRefreshUnlisten = null;
      }
      if (_autoRefreshTimer) {
        clearTimeout(_autoRefreshTimer);
        _autoRefreshTimer = null;
      }
    },
  })),
);

// ── Auto-refresh state (module-level) ────────────────────────────────────────

let _autoRefreshUnlisten: UnlistenFn | null = null;
let _autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let _autoFetchTimer: ReturnType<typeof setInterval> | null = null;
let _refreshGeneration = 0;

async function runGitOperation<T>(operation: string, action: () => Promise<T>): Promise<T> {
  const active = useGitStore.getState().activeOperation;
  assertGitOperationAvailable(active);
  useGitStore.setState({ activeOperation: operation, repositoryError: null });
  try {
    return await action();
  } catch (error) {
    useGitStore.setState({ repositoryError: errorMessage(error) });
    throw error;
  } finally {
    if (useGitStore.getState().activeOperation === operation) {
      useGitStore.setState({ activeOperation: null });
    }
  }
}

function configureAutoFetch(): void {
  if (_autoFetchTimer) {
    clearInterval(_autoFetchTimer);
    _autoFetchTimer = null;
  }
  const settings = useSettingsStore.getState();
  const intervalMs = getGitAutoFetchIntervalMs(
    settings.gitAutoFetch,
    settings.gitAutoFetchInterval,
    Boolean(getRootPath()),
  );
  if (intervalMs === null) return;
  _autoFetchTimer = setInterval(() => {
    const state = useGitStore.getState();
    if (state.repositoryState !== 'ready' || state.activeOperation || state.remotes.length === 0) {
      return;
    }
    void state.fetch().catch(() => {
      // The store records and surfaces the operation error.
    });
  }, intervalMs);
}

// ── Auto-refresh on rootPath change ──────────────────────────────────────────

let _prevRootPath: string | null = null;
useFileStore.subscribe((state) => {
  const rootPath = state.rootPath;
  if (rootPath !== _prevRootPath) {
    _refreshGeneration += 1;
    _prevRootPath = rootPath;
    useGitStore.getState().stopAutoRefresh();
    if (rootPath) {
      useGitStore.setState((state) => {
        resetRepositoryState(state, 'checking');
      });
      void useGitStore
        .getState()
        .refresh()
        .catch(() => {
          // The store exposes the repository error.
        });
      void useGitStore
        .getState()
        .fetchBranches()
        .catch(() => {
          // The store exposes the repository error.
        });
      void useGitStore.getState().startAutoRefresh();
    } else {
      useGitStore.setState((state) => {
        resetRepositoryState(state, 'no-workspace');
      });
    }
    configureAutoFetch();
  }
});

useSettingsStore.subscribe((state, previous) => {
  if (
    state.gitAutoFetch !== previous.gitAutoFetch ||
    state.gitAutoFetchInterval !== previous.gitAutoFetchInterval
  ) {
    configureAutoFetch();
  }
});

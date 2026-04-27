import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useFileStore } from './file-store';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GitFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | '?' | 'U';
  old_path: string | null;
}

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
  // Status
  isGitRepo: boolean;
  currentBranch: string;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
  conflicts: GitFile[];
  ahead: number;
  behind: number;

  // Branch / Remote
  branches: GitBranchInfo[];
  remotes: GitRemoteInfo[];

  // Log
  log: GitCommitInfo[];

  // Stash
  stashes: GitStashEntry[];

  // UI state
  isLoading: boolean;
  commitMessage: string;

  // Actions
  refresh: () => Promise<void>;
  stageFiles: (paths: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageFiles: (paths: string[]) => Promise<void>;
  discardFiles: (paths: string[]) => Promise<void>;
  commit: () => Promise<string>;
  setCommitMessage: (msg: string) => void;
  checkoutBranch: (name: string) => Promise<void>;
  createBranch: (name: string, checkout: boolean) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
  fetchBranches: () => Promise<void>;
  fetchLog: (limit?: number) => Promise<void>;
  fetchStashes: () => Promise<void>;
  stashChanges: (message?: string) => Promise<void>;
  popStash: (index: number) => Promise<void>;
  initRepo: () => Promise<void>;
  getFileContent: (filePath: string) => Promise<GitFileContent>;
  getDiff: (filePath: string, staged: boolean) => Promise<string>;
  /** Returns the full unified diff of all staged changes (for AI commit message generation) */
  getStagedDiff: () => Promise<string>;

  // New operations
  push: (remote?: string, branch?: string) => Promise<string>;
  pull: (remote?: string) => Promise<string>;
  fetch: (remote?: string) => Promise<string>;
  mergeBranch: (branch: string) => Promise<string>;
  createTag: (name: string, message?: string) => Promise<void>;
  unstageAll: () => Promise<void>;
  discardAll: () => Promise<void>;
  getCommitDetail: (hash: string) => Promise<CommitDetail>;
  getCommitFileDiff: (hash: string, filePath: string) => Promise<string>;
  getBlame: (filePath: string, line?: number) => Promise<GitBlameHunk[]>;
  // Pull Request
  createPullRequest: (opts: {
    title: string;
    body?: string;
    base: string;
    head: string;
    draft?: boolean;
  }) => Promise<string>;

  startAutoRefresh: () => Promise<void>;
  stopAutoRefresh: () => void;
}

function getRootPath(): string | null {
  return useFileStore.getState().rootPath;
}

export const useGitStore = create<GitState>()(
  immer((set, get) => ({
    isGitRepo: false,
    currentBranch: '',
    staged: [],
    unstaged: [],
    untracked: [],
    conflicts: [],
    ahead: 0,
    behind: 0,
    branches: [],
    remotes: [],
    log: [],
    stashes: [],
    isLoading: false,
    commitMessage: '',

    refresh: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;

      set((s) => { s.isLoading = true; });

      try {
        const isRepo = await invoke<boolean>('git_is_repo', { path: rootPath });
        if (!isRepo) {
          set((s) => {
            s.isGitRepo = false;
            s.currentBranch = '';
            s.staged = [];
            s.unstaged = [];
            s.untracked = [];
            s.conflicts = [];
            s.ahead = 0;
            s.behind = 0;
            s.isLoading = false;
          });
          return;
        }

        // Parallel fetches
        const [status, branch, aheadBehind] = await Promise.all([
          invoke<GitStatusResult>('git_status', { repoPath: rootPath }),
          invoke<string>('git_branch_current', { repoPath: rootPath }),
          invoke<{ ahead: number; behind: number }>('git_ahead_behind', { repoPath: rootPath }).catch(() => ({ ahead: 0, behind: 0 })),
        ]);

        set((s) => {
          s.isGitRepo = true;
          s.currentBranch = branch;
          s.staged = status.staged as GitFile[];
          s.unstaged = status.unstaged as GitFile[];
          s.untracked = status.untracked as GitFile[];
          s.conflicts = status.conflicts as GitFile[];
          s.ahead = aheadBehind.ahead;
          s.behind = aheadBehind.behind;
          s.isLoading = false;
        });
      } catch {
        set((s) => {
          s.isGitRepo = false;
          s.isLoading = false;
        });
      }
    },

    stageFiles: async (paths) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_add', { repoPath: rootPath, paths });
      await get().refresh();
    },

    stageAll: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_add_all', { repoPath: rootPath });
      await get().refresh();
    },

    unstageFiles: async (paths) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_unstage', { repoPath: rootPath, paths });
      await get().refresh();
    },

    discardFiles: async (paths) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_discard', { repoPath: rootPath, paths });
      await get().refresh();
    },

    commit: async () => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const msg = get().commitMessage.trim();
      if (!msg) throw new Error('Commit message is empty');

      const hash = await invoke<string>('git_commit', { repoPath: rootPath, message: msg });
      set((s) => { s.commitMessage = ''; });
      await get().refresh();
      return hash;
    },

    setCommitMessage: (msg) => set((s) => { s.commitMessage = msg; }),

    checkoutBranch: async (name) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_checkout', { repoPath: rootPath, branch: name });
      await get().refresh();
      await get().fetchBranches();
    },

    createBranch: async (name, checkout) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_branch_create', { repoPath: rootPath, name, checkout });
      await get().refresh();
      await get().fetchBranches();
    },

    deleteBranch: async (name) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_branch_delete', { repoPath: rootPath, name });
      await get().fetchBranches();
    },

    fetchBranches: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      try {
        const [branches, remotes] = await Promise.all([
          invoke<GitBranchInfo[]>('git_branch_list', { repoPath: rootPath }),
          invoke<GitRemoteInfo[]>('git_remote_list', { repoPath: rootPath }),
        ]);
        set((s) => {
          s.branches = branches as GitBranchInfo[];
          s.remotes = remotes as GitRemoteInfo[];
        });
      } catch {
        // Silently ignore if not a git repo
      }
    },

    fetchLog: async (limit = 50) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      try {
        const log = await invoke<GitCommitInfo[]>('git_log', { repoPath: rootPath, limit });
        set((s) => { s.log = log as GitCommitInfo[]; });
      } catch {
        // No log if no commits
      }
    },

    fetchStashes: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      try {
        const stashes = await invoke<GitStashEntry[]>('git_stash_list', { repoPath: rootPath });
        set((s) => { s.stashes = stashes as GitStashEntry[]; });
      } catch {
        // ignore
      }
    },

    stashChanges: async (message) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_stash', { repoPath: rootPath, message: message ?? null });
      await get().refresh();
      await get().fetchStashes();
    },

    popStash: async (index) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_stash_pop', { repoPath: rootPath, index });
      await get().refresh();
      await get().fetchStashes();
    },

    initRepo: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_init', { path: rootPath });
      await get().refresh();
    },

    getFileContent: async (filePath: string) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return invoke<GitFileContent>('git_file_content', { repoPath: rootPath, filePath });
    },

    getDiff: async (filePath: string, staged: boolean) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return invoke<string>('git_diff_file', { repoPath: rootPath, filePath, staged });
    },

    getStagedDiff: async () => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return invoke<string>('git_diff_staged_all', { repoPath: rootPath });
    },

    push: async (remote, branch) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await invoke<string>('git_push', {
        repoPath: rootPath,
        remote: remote ?? null,
        branch: branch ?? null,
      });
      await get().refresh();
      return result;
    },

    pull: async (remote) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await invoke<string>('git_pull', {
        repoPath: rootPath,
        remote: remote ?? null,
      });
      await get().refresh();
      return result;
    },

    fetch: async (remote) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await invoke<string>('git_fetch', {
        repoPath: rootPath,
        remote: remote ?? null,
      });
      await get().refresh();
      return result;
    },

    mergeBranch: async (branch) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await invoke<string>('git_merge', { repoPath: rootPath, branch });
      await get().refresh();
      return result;
    },

    createTag: async (name, message) => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      await invoke('git_tag_create', {
        repoPath: rootPath,
        name,
        message: message ?? null,
      });
    },

    unstageAll: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      const staged = get().staged;
      if (staged.length === 0) return;
      await invoke('git_unstage', { repoPath: rootPath, paths: staged.map((f) => f.path) });
      await get().refresh();
    },

    discardAll: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;
      const { unstaged, untracked } = get();
      const allPaths = [...unstaged, ...untracked].map((f) => f.path);
      if (allPaths.length === 0) return;
      await invoke('git_discard', { repoPath: rootPath, paths: allPaths });
      await get().refresh();
    },

    getCommitDetail: async (hash: string) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return invoke<CommitDetail>('git_commit_detail', { repoPath: rootPath, hash });
    },

    getCommitFileDiff: async (hash: string, filePath: string) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return invoke<string>('git_commit_file_diff', { repoPath: rootPath, hash, filePath });
    },

    getBlame: async (filePath: string, line?: number) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      return invoke<GitBlameHunk[]>('git_blame', { repoPath: rootPath, filePath, line: line ?? null });
    },

    createPullRequest: async (opts) => {
      const rootPath = getRootPath();
      if (!rootPath) throw new Error('No project open');
      const result = await invoke<{ url: string; number: number }>('github_create_pull_request', {
        repoPath: rootPath,
        payload: {
          title: opts.title,
          body: opts.body ?? null,
          head: opts.head,
          base: opts.base,
          draft: opts.draft ?? null,
        },
      });
      return result.url;
    },

    startAutoRefresh: async () => {
      // Guard: only start once
      if (_autoRefreshUnlisten) return;
      const rootPath = getRootPath();
      if (!rootPath) return;

      _autoRefreshUnlisten = await listen<unknown>('fs:changed', () => {
        if (_autoRefreshTimer) clearTimeout(_autoRefreshTimer);
        _autoRefreshTimer = setTimeout(() => {
          useGitStore.getState().refresh();
        }, 400);
      });
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

// ── Auto-refresh on rootPath change ──────────────────────────────────────────

let _prevRootPath: string | null = null;
useFileStore.subscribe((state) => {
  const rootPath = state.rootPath;
  if (rootPath !== _prevRootPath) {
    _prevRootPath = rootPath;
    if (rootPath) {
      useGitStore.getState().refresh();
      useGitStore.getState().fetchBranches();
      // Start real-time auto-refresh via fs:changed events
      useGitStore.getState().startAutoRefresh();
    } else {
      useGitStore.getState().stopAutoRefresh();
    }
  }
});

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { tauriInvoke } from '../lib/tauri-invoke';
import { useGitStore } from './git-store';

// ── Types ────────────────────────────────────────────────────────────────────

export type GitHubAuthStatus = 'unknown' | 'checking' | 'signed-in' | 'signed-out';

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  default_branch: string;
  owner: { login: string; avatar_url: string };
  updated_at: string | null;
}

export interface GitHubOrg {
  login: string;
  avatar_url: string;
  description: string | null;
}

export interface GitHubDeviceFlowState {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  polling: boolean;
}

export interface PublishRepositoryOptions {
  name: string;
  description?: string | null;
  private: boolean;
  org?: string | null;
}

// ── Store ────────────────────────────────────────────────────────────────────

interface GithubState {
  authStatus: GitHubAuthStatus;
  user: GitHubUser | null;
  scopes: string | null;
  repos: GitHubRepo[];
  orgs: GitHubOrg[];
  searchResults: GitHubRepo[];
  reposLoading: boolean;
  searchLoading: boolean;
  deviceFlow: GitHubDeviceFlowState | null;
  authError: string | null;
  cloneDialogOpen: boolean;
  publishDialogOpen: boolean;

  checkAuth: () => Promise<void>;
  refreshScopes: () => Promise<void>;
  startLogin: () => Promise<void>;
  cancelLogin: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  loadRepos: () => Promise<void>;
  loadOrgs: () => Promise<void>;
  searchRepos: (query: string) => Promise<void>;
  openCloneDialog: () => void;
  closeCloneDialog: () => void;
  openPublishDialog: () => void;
  closePublishDialog: () => void;
  publishRepository: (options: PublishRepositoryOptions) => Promise<GitHubRepo>;
  linkExistingRepository: (repo: GitHubRepo) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let _pollTimer: ReturnType<typeof setTimeout> | null = null;

async function pollDeviceFlow(deviceCode: string, interval: number): Promise<void> {
  if (_pollTimer) {
    clearTimeout(_pollTimer);
    _pollTimer = null;
  }
  try {
    await tauriInvoke('github_account_oauth_poll', { deviceCode });
    const user = await tauriInvoke('github_account_user', {});
    useGithubStore.setState((s) => {
      s.deviceFlow = null;
      s.authStatus = 'signed-in';
      s.user = user;
    });
    void useGithubStore.getState().loadRepos();
    void useGithubStore.getState().loadOrgs();
    void useGithubStore.getState().refreshScopes();
  } catch (error) {
    const message = errorMessage(error);
    if (message === 'authorization_pending') {
      if (!useGithubStore.getState().deviceFlow) return;
      _pollTimer = setTimeout(() => {
        void pollDeviceFlow(deviceCode, interval);
      }, interval * 1000);
    } else if (message === 'slow_down') {
      if (!useGithubStore.getState().deviceFlow) return;
      _pollTimer = setTimeout(() => {
        void pollDeviceFlow(deviceCode, interval + 5);
      }, (interval + 5) * 1000);
    } else {
      useGithubStore.setState((s) => {
        s.deviceFlow = null;
        s.authError = message;
      });
    }
  }
}

async function connectOriginRemote(url: string): Promise<void> {
  const git = useGitStore.getState();
  const hasOrigin = git.remotes.some((remote) => remote.name === 'origin');
  if (hasOrigin) {
    await git.setRemoteUrl('origin', url);
  } else {
    await git.addRemote('origin', url);
  }
}

export const useGithubStore = create<GithubState>()(
  immer((set, get) => ({
    authStatus: 'unknown',
    user: null,
    scopes: null,
    repos: [],
    orgs: [],
    searchResults: [],
    reposLoading: false,
    searchLoading: false,
    deviceFlow: null,
    authError: null,
    cloneDialogOpen: false,
    publishDialogOpen: false,

    checkAuth: async () => {
      set((s) => {
        s.authStatus = 'checking';
        s.authError = null;
      });
      try {
        const authenticated = await tauriInvoke('github_account_is_authenticated', {});
        if (!authenticated) {
          set((s) => {
            s.authStatus = 'signed-out';
            s.user = null;
          });
          return;
        }
        const user = await tauriInvoke('github_account_user', {});
        set((s) => {
          s.authStatus = user ? 'signed-in' : 'signed-out';
          s.user = user;
        });
        if (user) {
          void get().loadRepos();
          void get().loadOrgs();
          void get().refreshScopes();
        }
      } catch (error) {
        set((s) => {
          s.authStatus = 'signed-out';
          s.authError = errorMessage(error);
        });
      }
    },

    refreshScopes: async () => {
      try {
        const scopes = await tauriInvoke('github_account_scopes', {});
        set((s) => {
          s.scopes = scopes;
        });
      } catch {
        // Non-critical; scopes stay as last known.
      }
    },

    startLogin: async () => {
      if (_pollTimer) {
        clearTimeout(_pollTimer);
        _pollTimer = null;
      }
      set((s) => {
        s.authError = null;
      });
      try {
        const response = await tauriInvoke('github_account_oauth_start', {});
        set((s) => {
          s.deviceFlow = {
            userCode: response.user_code,
            verificationUri: response.verification_uri,
            expiresIn: response.expires_in,
            interval: Math.max(response.interval, 5),
            polling: true,
          };
        });
        void pollDeviceFlow(response.device_code, Math.max(response.interval, 5));
      } catch (error) {
        set((s) => {
          s.authError = errorMessage(error);
          s.deviceFlow = null;
        });
      }
    },

    cancelLogin: () => {
      if (_pollTimer) {
        clearTimeout(_pollTimer);
        _pollTimer = null;
      }
      set((s) => {
        s.deviceFlow = null;
        s.authError = null;
      });
    },

    logout: async () => {
      if (_pollTimer) {
        clearTimeout(_pollTimer);
        _pollTimer = null;
      }
      await tauriInvoke('github_account_disconnect', {});
      set((s) => {
        s.authStatus = 'signed-out';
        s.user = null;
        s.scopes = null;
        s.deviceFlow = null;
        s.repos = [];
        s.orgs = [];
        s.searchResults = [];
      });
    },

    refreshUser: async () => {
      try {
        const user = await tauriInvoke('github_account_user', {});
        set((s) => {
          s.user = user;
        });
      } catch {
        // Non-critical; the account section shows the last known user.
      }
    },

    loadRepos: async () => {
      set((s) => {
        s.reposLoading = true;
      });
      try {
        const repos = await tauriInvoke('github_list_repos', {});
        set((s) => {
          s.repos = repos;
          s.reposLoading = false;
        });
      } catch (error) {
        set((s) => {
          s.reposLoading = false;
          s.authError = errorMessage(error);
        });
      }
    },

    loadOrgs: async () => {
      try {
        const orgs = await tauriInvoke('github_list_orgs', {});
        set((s) => {
          s.orgs = orgs;
        });
      } catch {
        // Non-critical; org selection degrades to the user account.
      }
    },

    searchRepos: async (query) => {
      if (!query.trim()) {
        set((s) => {
          s.searchResults = [];
        });
        return;
      }
      set((s) => {
        s.searchLoading = true;
      });
      try {
        const results = await tauriInvoke('github_search_repos', { query: query.trim() });
        set((s) => {
          s.searchResults = results;
          s.searchLoading = false;
        });
      } catch (error) {
        set((s) => {
          s.searchLoading = false;
          s.authError = errorMessage(error);
        });
      }
    },

    openCloneDialog: () =>
      set((s) => {
        s.cloneDialogOpen = true;
      }),
    closeCloneDialog: () =>
      set((s) => {
        s.cloneDialogOpen = false;
      }),
    openPublishDialog: () =>
      set((s) => {
        s.publishDialogOpen = true;
      }),
    closePublishDialog: () =>
      set((s) => {
        s.publishDialogOpen = false;
      }),

    publishRepository: async (options) => {
      const repo = await tauriInvoke('github_create_repo', {
        name: options.name,
        description: options.description || null,
        private: options.private,
        org: options.org || null,
      });
      await connectOriginRemote(repo.clone_url);
      await useGitStore.getState().publishBranch('origin');
      return repo;
    },

    linkExistingRepository: async (repo) => {
      await connectOriginRemote(repo.clone_url);
      await useGitStore.getState().publishBranch('origin');
    },
  })),
);

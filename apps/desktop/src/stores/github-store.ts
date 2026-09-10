import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { tauriInvoke, type GitHubAccountContract } from '../lib/tauri-invoke';
import { useGitStore } from './git-store';

// ── Types ────────────────────────────────────────────────────────────────────

export type GitHubAuthStatus = 'unknown' | 'checking' | 'signed-in' | 'signed-out';

export type GitHubAccountKind = 'oauth' | 'token';

export type GitHubAccount = GitHubAccountContract;

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
  accountId?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function githubAccountDisplayName(account: GitHubAccount): string {
  if (account.kind === 'token') {
    return account.label?.trim() || (account.login ? `@${account.login}` : 'Access token');
  }
  return account.name?.trim() || account.login || 'GitHub account';
}

export function githubAccountHandle(account: GitHubAccount): string | null {
  return account.login ? `@${account.login}` : null;
}

function accountToUser(account: GitHubAccount | undefined | null): GitHubUser | null {
  if (!account?.login || !account.avatar_url || !account.html_url) return null;
  return {
    login: account.login,
    name: account.name,
    avatar_url: account.avatar_url,
    html_url: account.html_url,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Store ────────────────────────────────────────────────────────────────────

interface GithubState {
  authStatus: GitHubAuthStatus;
  accounts: GitHubAccount[];
  activeAccountId: string | null;
  user: GitHubUser | null;
  scopes: string | null;
  invalidAccountIds: string[];
  accountStatus: 'idle' | 'busy';
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
  loadAccounts: () => Promise<void>;
  refreshScopes: (accountId?: string | null) => Promise<void>;
  startLogin: () => Promise<void>;
  cancelLogin: () => void;
  logout: () => Promise<void>;
  addTokenAccount: (label: string, token: string) => Promise<void>;
  switchAccount: (accountId: string) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  refreshAccount: (accountId: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  loadRepos: (accountId?: string | null) => Promise<void>;
  loadOrgs: (accountId?: string | null) => Promise<void>;
  searchRepos: (query: string, accountId?: string | null) => Promise<void>;
  openCloneDialog: () => void;
  closeCloneDialog: () => void;
  openPublishDialog: () => void;
  closePublishDialog: () => void;
  publishRepository: (options: PublishRepositoryOptions) => Promise<GitHubRepo>;
  linkExistingRepository: (repo: GitHubRepo, accountId?: string | null) => Promise<void>;
}

let _pollTimer: ReturnType<typeof setTimeout> | null = null;

function stopPolling(): void {
  if (_pollTimer) {
    clearTimeout(_pollTimer);
    _pollTimer = null;
  }
}

async function pollDeviceFlow(deviceCode: string, interval: number): Promise<void> {
  stopPolling();
  try {
    await tauriInvoke('github_account_oauth_poll', { deviceCode });
    useGithubStore.setState((s) => {
      s.deviceFlow = null;
      s.authError = null;
    });
    await useGithubStore.getState().checkAuth();
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
    accounts: [],
    activeAccountId: null,
    user: null,
    scopes: null,
    invalidAccountIds: [],
    accountStatus: 'idle',
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
      const initialCheck = get().authStatus === 'unknown';
      set((s) => {
        if (initialCheck) s.authStatus = 'checking';
        s.authError = null;
      });
      try {
        await get().loadAccounts();
        const { accounts, activeAccountId } = get();
        if (accounts.length === 0 || !activeAccountId) {
          set((s) => {
            s.authStatus = 'signed-out';
            s.user = null;
            s.scopes = null;
            s.deviceFlow = null;
            s.repos = [];
            s.orgs = [];
            s.searchResults = [];
          });
          return;
        }
        const active = accounts.find((account) => account.id === activeAccountId);
        set((s) => {
          s.authStatus = 'signed-in';
          s.user = accountToUser(active);
          s.scopes = active?.scopes ?? null;
        });
        try {
          const user = await tauriInvoke('github_account_user', { accountId: activeAccountId });
          if (user) {
            set((s) => {
              s.user = user;
              s.invalidAccountIds = s.invalidAccountIds.filter((id) => id !== activeAccountId);
            });
          } else {
            set((s) => {
              if (!s.invalidAccountIds.includes(activeAccountId)) {
                s.invalidAccountIds.push(activeAccountId);
              }
            });
          }
        } catch {
          // Transient failure (offline): keep the identity cached in account metadata.
        }
        void get().loadRepos();
        void get().loadOrgs();
        void get().refreshScopes();
      } catch (error) {
        set((s) => {
          s.authStatus = 'signed-out';
          s.authError = errorMessage(error);
        });
      }
    },

    loadAccounts: async () => {
      const state = await tauriInvoke('github_accounts_list', {});
      set((s) => {
        s.accounts = state.accounts;
        s.activeAccountId = state.active_account_id;
        s.invalidAccountIds = s.invalidAccountIds.filter((id) =>
          state.accounts.some((account) => account.id === id),
        );
      });
    },

    refreshScopes: async (accountId) => {
      const targetAccountId = accountId ?? get().activeAccountId;
      try {
        const scopes = await tauriInvoke('github_account_scopes', {
          accountId: targetAccountId ?? null,
        });
        set((s) => {
          if (targetAccountId) {
            const account = s.accounts.find((item) => item.id === targetAccountId);
            if (account) account.scopes = scopes;
          }
          if (targetAccountId === s.activeAccountId) {
            s.scopes = scopes;
          }
        });
      } catch {
        // Non-critical; scopes stay as last known.
      }
    },

    startLogin: async () => {
      stopPolling();
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
      stopPolling();
      set((s) => {
        s.deviceFlow = null;
        s.authError = null;
      });
    },

    logout: async () => {
      stopPolling();
      const activeAccountId = get().activeAccountId;
      if (activeAccountId) {
        try {
          await tauriInvoke('github_account_remove', { accountId: activeAccountId });
        } catch (error) {
          set((s) => {
            s.authError = errorMessage(error);
          });
        }
      }
      await get().checkAuth();
    },

    addTokenAccount: async (label, token) => {
      set((s) => {
        s.accountStatus = 'busy';
        s.authError = null;
      });
      try {
        await tauriInvoke('github_account_add_token', { label, token });
        await get().checkAuth();
      } catch (error) {
        set((s) => {
          s.authError = errorMessage(error);
        });
        throw error;
      } finally {
        set((s) => {
          s.accountStatus = 'idle';
        });
      }
    },

    switchAccount: async (accountId) => {
      set((s) => {
        s.accountStatus = 'busy';
        s.authError = null;
      });
      try {
        await tauriInvoke('github_account_switch', { accountId });
        await get().checkAuth();
      } catch (error) {
        set((s) => {
          s.authError = errorMessage(error);
        });
      } finally {
        set((s) => {
          s.accountStatus = 'idle';
        });
      }
    },

    removeAccount: async (accountId) => {
      set((s) => {
        s.accountStatus = 'busy';
        s.authError = null;
      });
      try {
        await tauriInvoke('github_account_remove', { accountId });
        set((s) => {
          s.invalidAccountIds = s.invalidAccountIds.filter((id) => id !== accountId);
        });
        await get().checkAuth();
      } catch (error) {
        set((s) => {
          s.authError = errorMessage(error);
        });
      } finally {
        set((s) => {
          s.accountStatus = 'idle';
        });
      }
    },

    refreshAccount: async (accountId) => {
      try {
        await tauriInvoke('github_account_refresh', { accountId });
        set((s) => {
          s.invalidAccountIds = s.invalidAccountIds.filter((id) => id !== accountId);
        });
        await get().loadAccounts();
        if (get().activeAccountId === accountId) {
          const user = await tauriInvoke('github_account_user', { accountId });
          set((s) => {
            s.user = user;
          });
        }
      } catch (error) {
        set((s) => {
          if (!s.invalidAccountIds.includes(accountId)) {
            s.invalidAccountIds.push(accountId);
          }
        });
        throw error;
      }
    },

    refreshUser: async () => {
      const activeAccountId = get().activeAccountId;
      if (!activeAccountId) return;
      try {
        const user = await tauriInvoke('github_account_user', { accountId: activeAccountId });
        set((s) => {
          s.user = user;
        });
      } catch {
        // Non-critical; the account UI shows the last known identity.
      }
    },

    loadRepos: async (accountId) => {
      set((s) => {
        s.reposLoading = true;
      });
      try {
        const repos = await tauriInvoke('github_list_repos', { accountId: accountId ?? null });
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

    loadOrgs: async (accountId) => {
      try {
        const orgs = await tauriInvoke('github_list_orgs', { accountId: accountId ?? null });
        set((s) => {
          s.orgs = orgs;
        });
      } catch {
        // Non-critical; org selection degrades to the account login.
      }
    },

    searchRepos: async (query, accountId) => {
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
        const results = await tauriInvoke('github_search_repos', {
          accountId: accountId ?? null,
          query: query.trim(),
        });
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
        accountId: options.accountId ?? null,
        name: options.name,
        description: options.description || null,
        private: options.private,
        org: options.org || null,
      });
      await connectOriginRemote(repo.clone_url);
      if (options.accountId) {
        await useGitStore.getState().setRemoteAccount('origin', options.accountId);
      }
      await useGitStore.getState().publishBranch('origin');
      return repo;
    },

    linkExistingRepository: async (repo, accountId = null) => {
      await connectOriginRemote(repo.clone_url);
      if (accountId) {
        await useGitStore.getState().setRemoteAccount('origin', accountId);
      }
      await useGitStore.getState().publishBranch('origin');
    },
  })),
);

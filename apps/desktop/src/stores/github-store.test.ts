import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubAccountContract } from '../lib/tauri-invoke';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('../lib/tauri-invoke', () => ({
  tauriInvoke: invokeMock,
}));

vi.mock('./git-store', () => ({
  useGitStore: {
    getState: () => ({}),
  },
}));

import { useGithubStore } from './github-store';

type Account = GitHubAccountContract;

const accountA: Account = {
  id: 'oauth-1',
  kind: 'oauth',
  login: 'one',
  name: 'One',
  avatar_url: 'https://avatars.example/one.png',
  html_url: 'https://github.com/one',
  label: null,
  scopes: 'repo, workflow',
  added_at: 1,
};

const accountB: Account = {
  id: 'token-2',
  kind: 'token',
  login: null,
  name: null,
  avatar_url: null,
  html_url: null,
  label: 'CI token',
  scopes: null,
  added_at: 2,
};

interface MockState {
  accounts: Account[];
  active: string | null;
}

function mockAccountCommands(state: MockState): void {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    const accountId = (args?.accountId as string | null | undefined) ?? null;
    switch (command) {
      case 'github_accounts_list':
        return { accounts: state.accounts, active_account_id: state.active };
      case 'github_account_user': {
        const account = state.accounts.find((item) => item.id === accountId);
        if (!account?.login) return null;
        return {
          id: 1,
          login: account.login,
          name: account.name,
          avatar_url: account.avatar_url,
          html_url: account.html_url,
        };
      }
      case 'github_list_repos':
      case 'github_list_orgs':
        return [];
      case 'github_account_scopes':
        return (
          state.accounts.find((item) => item.id === (accountId ?? state.active))?.scopes ?? null
        );
      case 'github_account_switch':
        state.active = accountId;
        return undefined;
      case 'github_account_remove':
        state.accounts = state.accounts.filter((item) => item.id !== accountId);
        if (state.active === accountId) {
          state.active = state.accounts[0]?.id ?? null;
        }
        return undefined;
      case 'github_account_add_token': {
        const added: Account = {
          id: 'token-new',
          kind: 'token',
          login: null,
          name: null,
          avatar_url: null,
          html_url: null,
          label: String(args?.label ?? ''),
          scopes: null,
          added_at: 3,
        };
        state.accounts = [...state.accounts, added];
        state.active = state.active ?? added.id;
        return added;
      }
      default:
        throw new Error(`Unexpected command: ${command}`);
    }
  });
}

function resetStore(): void {
  useGithubStore.setState({
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
  });
}

describe('github multi-account store', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStore();
  });

  it('loads accounts on checkAuth and resolves the active identity', async () => {
    mockAccountCommands({ accounts: [accountA, accountB], active: 'oauth-1' });

    await useGithubStore.getState().checkAuth();

    const state = useGithubStore.getState();
    expect(state.accounts).toHaveLength(2);
    expect(state.activeAccountId).toBe('oauth-1');
    expect(state.authStatus).toBe('signed-in');
    expect(state.user?.login).toBe('one');
    expect(state.scopes).toBe('repo, workflow');
  });

  it('switches the active account and reloads the identity', async () => {
    const backend: MockState = { accounts: [accountA, accountB], active: 'oauth-1' };
    mockAccountCommands(backend);
    await useGithubStore.getState().checkAuth();

    await useGithubStore.getState().switchAccount('token-2');

    expect(backend.active).toBe('token-2');
    expect(useGithubStore.getState().activeAccountId).toBe('token-2');
  });

  it('removes an account and falls back to the remaining one', async () => {
    const backend: MockState = { accounts: [accountA, accountB], active: 'oauth-1' };
    mockAccountCommands(backend);
    await useGithubStore.getState().checkAuth();

    await useGithubStore.getState().removeAccount('oauth-1');

    const state = useGithubStore.getState();
    expect(state.accounts.map((account) => account.id)).toEqual(['token-2']);
    expect(state.activeAccountId).toBe('token-2');
  });

  it('registers a personal access token as a named account', async () => {
    mockAccountCommands({ accounts: [], active: null });

    await useGithubStore.getState().addTokenAccount('CI token', 'github_pat_x');

    const state = useGithubStore.getState();
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0].label).toBe('CI token');
    expect(state.activeAccountId).toBe('token-new');
    expect(invokeMock).toHaveBeenCalledWith('github_account_add_token', {
      label: 'CI token',
      token: 'github_pat_x',
    });
  });

  it('marks the active account as invalid when the token is revoked', async () => {
    mockAccountCommands({ accounts: [accountA], active: 'oauth-1' });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'github_accounts_list') {
        return { accounts: [accountA], active_account_id: 'oauth-1' };
      }
      if (command === 'github_account_user') return null;
      if (command === 'github_list_repos' || command === 'github_list_orgs') return [];
      if (command === 'github_account_scopes') return accountA.scopes;
      throw new Error(`Unexpected command: ${command}`);
    });

    await useGithubStore.getState().checkAuth();

    const state = useGithubStore.getState();
    expect(state.authStatus).toBe('signed-in');
    expect(state.invalidAccountIds).toContain('oauth-1');
    expect(state.user?.login).toBe('one');
  });
});

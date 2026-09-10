// ─── GitHub Accounts Section (Settings → Git, dialogs) ──────────────────────
// Lists every connected GitHub account, allows switching the active account,
// adding OAuth accounts via the device flow, and registering personal access
// tokens as named accounts.

import { useEffect, useState } from 'react';
import {
  LogIn,
  LogOut,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  KeyRound,
  Plus,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  githubAccountDisplayName,
  githubAccountHandle,
  useGithubStore,
  type GitHubAccount,
} from '@/stores/github-store';

interface GithubAccountSectionProps {
  className?: string;
  /** Called after the user switches or connects an account (popover use). */
  onAccountSelected?: () => void;
}

function hasWorkflowScope(account: GitHubAccount): boolean {
  const scopes = account.scopes ?? '';
  return scopes
    .split(',')
    .map((scope) => scope.trim())
    .includes('workflow');
}

export function GithubAccountSection({ className, onAccountSelected }: GithubAccountSectionProps) {
  const authStatus = useGithubStore((s) => s.authStatus);
  const accounts = useGithubStore((s) => s.accounts);
  const activeAccountId = useGithubStore((s) => s.activeAccountId);
  const deviceFlow = useGithubStore((s) => s.deviceFlow);
  const authError = useGithubStore((s) => s.authError);
  const invalidAccountIds = useGithubStore((s) => s.invalidAccountIds);
  const accountStatus = useGithubStore((s) => s.accountStatus);

  const checkAuth = useGithubStore((s) => s.checkAuth);
  const startLogin = useGithubStore((s) => s.startLogin);
  const cancelLogin = useGithubStore((s) => s.cancelLogin);
  const switchAccount = useGithubStore((s) => s.switchAccount);
  const removeAccount = useGithubStore((s) => s.removeAccount);
  const refreshAccount = useGithubStore((s) => s.refreshAccount);
  const addTokenAccount = useGithubStore((s) => s.addTokenAccount);

  const [showTokenForm, setShowTokenForm] = useState(false);
  const [tokenLabel, setTokenLabel] = useState('');
  const [tokenValue, setTokenValue] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSwitch = async (accountId: string) => {
    if (accountId === activeAccountId) return;
    setBusyAccountId(accountId);
    await switchAccount(accountId);
    setBusyAccountId(null);
    onAccountSelected?.();
  };

  const handleRemove = async (accountId: string) => {
    setConfirmRemoveId(null);
    await removeAccount(accountId);
  };

  const handleRefresh = async (accountId: string) => {
    setBusyAccountId(accountId);
    try {
      await refreshAccount(accountId);
    } catch {
      // The store marks the account invalid; the row renders the failed state.
    } finally {
      setBusyAccountId(null);
    }
  };

  const handleAddToken = async () => {
    if (!tokenValue.trim()) return;
    setTokenError(null);
    try {
      await addTokenAccount(tokenLabel, tokenValue.trim());
      setTokenValue('');
      setTokenLabel('');
      setShowTokenForm(false);
      onAccountSelected?.();
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : String(error));
    }
  };

  if (authStatus === 'checking' || authStatus === 'unknown') {
    return (
      <div className={`flex items-center gap-2 text-[11px] text-muted-foreground ${className ?? ''}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking GitHub authentication…
      </div>
    );
  }

  if (deviceFlow) {
    return (
      <div className={`flex flex-col gap-2 ${className ?? ''}`}>
        <p className="text-[11px] text-muted-foreground">
          Enter this code on GitHub to connect the account:
        </p>
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-2 py-0.5 font-mono text-[13px] font-bold tracking-wider">
            {deviceFlow.userCode}
          </code>
          <button
            type="button"
            onClick={() => void copyCode(deviceFlow.userCode)}
            className="rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <a
          href={deviceFlow.verificationUri}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open GitHub to authorize
        </a>
        <p className="flex items-start gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            GitHub authorizes the account currently signed in at github.com. To add a different
            account, sign out of GitHub in your browser or use a private window before authorizing.
          </span>
        </p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Waiting for authorization…
          <button
            type="button"
            onClick={cancelLogin}
            className="ml-1 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      {accounts.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No GitHub account connected. Sign in to clone, publish and manage repositories.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border/60 rounded-lg border border-border bg-background">
          {accounts.map((account) => {
            const isActive = account.id === activeAccountId;
            const isInvalid = invalidAccountIds.includes(account.id);
            const isBusy = busyAccountId === account.id || accountStatus === 'busy';
            const handle = githubAccountHandle(account);
            return (
              <div key={account.id} className="flex flex-col gap-1.5 px-2.5 py-2">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => void handleSwitch(account.id)}
                    title={isActive ? 'Active account' : 'Use this account'}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    {account.avatar_url ? (
                      <img
                        src={account.avatar_url}
                        alt=""
                        className="h-7 w-7 shrink-0 rounded-full border border-border"
                      />
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="flex items-center gap-1.5 truncate text-[11px] font-medium text-foreground">
                        {githubAccountDisplayName(account)}
                        {account.kind === 'token' && (
                          <span className="rounded bg-muted px-1 py-px text-[9px] font-normal text-muted-foreground">
                            Token
                          </span>
                        )}
                        {isInvalid && (
                          <span className="rounded bg-destructive/10 px-1 py-px text-[9px] font-normal text-destructive">
                            Session expired
                          </span>
                        )}
                      </span>
                      {handle && (
                        <span className="truncate text-[10px] text-muted-foreground">{handle}</span>
                      )}
                    </span>
                    {isActive &&
                      (isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                      ))}
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {isInvalid && account.kind === 'oauth' && (
                      <button
                        type="button"
                        onClick={() => void startLogin()}
                        title="Sign in again to refresh this account's token"
                        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-warning hover:bg-warning/10 transition-colors"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Reconnect
                      </button>
                    )}
                    {isInvalid && account.kind === 'token' && (
                      <button
                        type="button"
                        onClick={() => void handleRefresh(account.id)}
                        disabled={isBusy}
                        title="Recheck the access token"
                        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-warning hover:bg-warning/10 transition-colors"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Recheck
                      </button>
                    )}
                    {confirmRemoveId === account.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleRemove(account.id)}
                          className="rounded-md bg-destructive/10 px-1.5 py-1 text-[10px] text-destructive hover:bg-destructive/20 transition-colors"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(account.id)}
                        title={`Disconnect ${githubAccountDisplayName(account)}`}
                        className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      >
                        <LogOut className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
                {account.kind === 'oauth' && !hasWorkflowScope(account) && (
                  <div className="flex items-start gap-1.5 pl-9 text-[10px] text-warning">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      Missing the <code className="rounded bg-muted px-1 font-mono">workflow</code>{' '}
                      scope — pushes to{' '}
                      <code className="rounded bg-muted px-1 font-mono">.github/workflows/*</code>{' '}
                      will be rejected. Sign in again to grant it.
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {authError && (
        <span className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {authError}
        </span>
      )}

      {showTokenForm ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Add access token
          </p>
          <input
            value={tokenLabel}
            onChange={(e) => setTokenLabel(e.target.value)}
            placeholder="Label (e.g. CI token)"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
          />
          <input
            type="password"
            value={tokenValue}
            onChange={(e) => setTokenValue(e.target.value)}
            placeholder="github_pat_…"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
          />
          <p className="text-[10px] text-muted-foreground">
            The token is stored locally and used as a named account (it can be bound to remotes
            and selected per operation).
          </p>
          {tokenError && <p className="text-[10px] text-destructive">{tokenError}</p>}
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setShowTokenForm(false);
                setTokenError(null);
                setTokenValue('');
              }}
              className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleAddToken()}
              disabled={!tokenValue.trim() || accountStatus === 'busy'}
              className="rounded-md bg-primary px-2.5 py-1 text-[10px] text-primary-foreground disabled:opacity-40 transition-colors"
            >
              Add token
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void startLogin()}
            className="h-7 gap-1.5 text-[11px]"
          >
            <LogIn className="h-3.5 w-3.5" />
            {accounts.length === 0 ? 'Sign in with GitHub' : 'Add account'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTokenForm(true)}
            className="h-7 gap-1.5 text-[11px] text-muted-foreground"
          >
            <Plus className="h-3 w-3" />
            Add token
          </Button>
        </div>
      )}
    </div>
  );
}

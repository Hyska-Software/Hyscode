// ─── Codex ChatGPT Auth Row ──────────────────────────────────────────────────
// Checks whether the user has the Codex CLI installed (it is NOT bundled
// with HysCode). If missing, shows the install command and a re-check
// button. Once installed, signs in via the CLI's OAuth browser flow
// (`codex login`); credentials are cached by the CLI in ~/.codex/auth.json
// and this row polls the login status until the browser flow completes.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tauriInvoke } from '@/lib/tauri-invoke';
import { reinitProvider } from '@/lib/init-providers';

interface CodexAuthRowProps {
  className?: string;
}

interface LoginStatus {
  authenticated: boolean;
  method: string | null;
  has_api_key: boolean;
}

interface CliStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
}

const INSTALL_COMMAND = 'npm install -g @openai/codex';
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 5 * 60 * 1000;

export function CodexAuthRow({ className }: CodexAuthRowProps) {
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null);
  const [status, setStatus] = useState<LoginStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartedAtRef = useRef<number | null>(null);
  const pollActiveRef = useRef(false);

  const stopPolling = useCallback(() => {
    pollActiveRef.current = false;
    if (pollTimeoutRef.current !== null) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async (): Promise<LoginStatus | null> => {
    try {
      const s = await tauriInvoke('codex_login_status', {});
      setStatus(s);
      setError(null);
      return s;
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  const refreshCliStatus = useCallback(async (): Promise<CliStatus | null> => {
    try {
      const s = await tauriInvoke('codex_cli_status', {});
      setCliStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  // On mount: check CLI presence + auth state; re-register the provider if a
  // previous login exists so it is picked up before the user sends a message.
  useEffect(() => {
    refreshCliStatus().then((cli) => {
      if (!cli?.installed) return;
      refreshStatus().then((s) => {
        if (s?.authenticated) {
          reinitProvider('codex').catch(() => {});
        }
      });
    });
    return () => stopPolling();
  }, [refreshCliStatus, refreshStatus, stopPolling]);

  const recheck = async () => {
    const cli = await refreshCliStatus();
    if (cli?.installed) {
      await refreshStatus();
      await reinitProvider('codex').catch(() => {});
    }
  };

  const signIn = async () => {
    setError(null);
    setBusy(true);
    stopPolling();

    try {
      await tauriInvoke('codex_login', {});
      setSigningIn(true);
      pollActiveRef.current = true;
      pollStartedAtRef.current = Date.now();

      const schedulePoll = () => {
        if (!pollActiveRef.current) return;
        pollTimeoutRef.current = setTimeout(doPoll, POLL_INTERVAL_MS);
      };

      const doPoll = async () => {
        if (!pollActiveRef.current) return;
        const elapsed = Date.now() - (pollStartedAtRef.current ?? Date.now());
        if (elapsed > POLL_MAX_MS) {
          stopPolling();
          setSigningIn(false);
          setBusy(false);
          setError('Sign-in timed out. Please try again.');
          return;
        }

        const s = await refreshStatus();
        if (s?.authenticated) {
          stopPolling();
          setSigningIn(false);
          setBusy(false);
          await reinitProvider('codex').catch(() => {});
        } else {
          schedulePoll();
        }
      };

      schedulePoll();
    } catch (err) {
      setBusy(false);
      setSigningIn(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const signOut = async () => {
    setError(null);
    setBusy(true);
    stopPolling();
    try {
      await tauriInvoke('codex_logout', {});
      await refreshStatus();
      await reinitProvider('codex').catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copyCommand = async () => {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // CLI not installed — show install prompt instead of auth controls
  if (cliStatus !== null && !cliStatus.installed) {
    return (
      <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-2.5 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-foreground">
              Codex CLI not installed
            </span>
            <span className="text-[10px] leading-relaxed text-muted-foreground">
              Codex runs on the official Codex CLI, which is not bundled with
              HysCode. Install it, then re-check:
            </span>
            <div className="flex items-center gap-1.5">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                {INSTALL_COMMAND}
              </code>
              <button
                onClick={copyCommand}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Copy install command"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-success" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={recheck}
              disabled={busy}
              className="h-6 w-fit text-[10px] gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              I've installed it — check again
            </Button>
          </div>
        </div>
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    );
  }

  const authenticated = status?.authenticated ?? false;

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      {authenticated && (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Signed in with ChatGPT
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            disabled={busy}
            className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-destructive"
          >
            <LogOut className="h-3 w-3" />
            Sign out
          </Button>
        </div>
      )}

      {!authenticated && (
        <Button
          variant="ghost"
          size="sm"
          onClick={signIn}
          disabled={busy || signingIn}
          className="h-7 text-[11px] gap-1.5"
        >
          {signingIn ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LogIn className="h-3.5 w-3.5" />
          )}
          Sign in with ChatGPT
        </Button>
      )}

      {signingIn && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          A browser window opened — complete the login to continue...
        </div>
      )}

      {!signingIn && !busy && (
        <button
          onClick={recheck}
          className="flex w-fit items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className="h-2.5 w-2.5" />
          Refresh status
        </button>
      )}

      {status && !status.authenticated && status.has_api_key && (
        <span className="text-[10px] text-muted-foreground">
          API key configured — ChatGPT login is optional.
        </span>
      )}

      {cliStatus?.installed && cliStatus.version && (
        <span className="text-[10px] text-muted-foreground">
          Codex CLI {cliStatus.version} detected
        </span>
      )}

      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </div>
  );
}

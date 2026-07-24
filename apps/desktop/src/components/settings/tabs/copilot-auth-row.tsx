// ─── GitHub Copilot OAuth Auth Row ──────────────────────────────────────────
// Authenticates via the GitHub OAuth Device Flow using the official GitHub
// Copilot VS Code extension client ID. No custom OAuth App needed.

import { useState, useEffect, useRef } from 'react';
import { LogIn, LogOut, Loader2, Copy, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tauriInvoke } from '@/lib/tauri-invoke';
import { reinitProvider } from '@/lib/init-providers';

interface CopilotAuthRowProps {
  className?: string;
}

type AuthState =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'waiting'; userCode: string; verificationUri: string; deviceCode: string; interval: number }
  | { step: 'authenticated' }
  | { step: 'error'; message: string };

export function CopilotAuthRow({ className }: CopilotAuthRowProps) {
  const [authState, setAuthState] = useState<AuthState>({ step: 'idle' });
  const [copied, setCopied] = useState(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollActiveRef = useRef(false);

  // On mount: if already authenticated, silently refresh the short-lived token
  // so the provider is registered in the registry before the user sends a message.
  useEffect(() => {
    tauriInvoke('github_copilot_is_authenticated', {})
      .then(async (authed) => {
        if (!authed) return;
        try {
          await tauriInvoke('github_copilot_ensure_token', {});
          await reinitProvider('github-copilot');
          setAuthState({ step: 'authenticated' });
        } catch {
          // Revoked or expired — show idle so user can re-auth
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => { stopPolling(); };
  }, []);

  const stopPolling = () => {
    pollActiveRef.current = false;
    if (pollTimeoutRef.current !== null) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  };

  const extractErrorMessage = (err: unknown): string => {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object') {
      const obj = err as Record<string, unknown>;
      if (typeof obj.message === 'string') return obj.message;
      if (typeof obj.error === 'string') return obj.error;
      try { return JSON.stringify(err); } catch { /* fallback */ }
    }
    return String(err);
  };

  const startAuth = async () => {
    setAuthState({ step: 'loading' });
    stopPolling();

    try {
      const resp = await tauriInvoke('github_oauth_start', {});

      setAuthState({
        step: 'waiting',
        userCode: resp.user_code,
        verificationUri: resp.verification_uri,
        deviceCode: resp.device_code,
        interval: resp.interval,
      });

      let currentIntervalMs = Math.max(resp.interval, 5) * 1000;
      const deviceCode = resp.device_code;
      let pollCount = 0;
      pollActiveRef.current = true;

      const schedulePoll = () => {
        if (!pollActiveRef.current) return;
        pollTimeoutRef.current = setTimeout(doPoll, currentIntervalMs);
      };

      const doPoll = async () => {
        if (!pollActiveRef.current) return;
        pollCount++;
        console.log(`[CopilotAuth] Poll #${pollCount} — interval: ${currentIntervalMs}ms`);

        try {
          await tauriInvoke('github_oauth_poll', { deviceCode });
          stopPolling();
          console.log('[CopilotAuth] Poll succeeded, access_token obtained');

          try {
            await tauriInvoke('github_copilot_ensure_token', {});
            await reinitProvider('github-copilot');
            setAuthState({ step: 'authenticated' });
          } catch (tokenErr) {
            const msg = extractErrorMessage(tokenErr);
            console.error('[CopilotAuth] Copilot token exchange failed:', msg);
            setAuthState({ step: 'error', message: `Copilot token exchange failed: ${msg}` });
          }
        } catch (err) {
          const msg = extractErrorMessage(err);
          if (msg === 'slow_down') {
            currentIntervalMs += 5000;
            schedulePoll();
          } else if (msg === 'authorization_pending') {
            schedulePoll();
          } else {
            stopPolling();
            setAuthState({ step: 'error', message: msg });
          }
        }
      };

      schedulePoll();
    } catch (err) {
      setAuthState({ step: 'error', message: extractErrorMessage(err) });
    }
  };

  const disconnect = async () => {
    try {
      stopPolling();
      await tauriInvoke('github_copilot_disconnect', {});
      await reinitProvider('github-copilot');
      setAuthState({ step: 'idle' });
    } catch (err) {
      setAuthState({ step: 'error', message: extractErrorMessage(err) });
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={className}>
      {authState.step === 'idle' && (
        <Button variant="ghost" size="sm" onClick={startAuth} className="h-7 text-[11px] gap-1.5">
          <LogIn className="h-3.5 w-3.5" />
          Sign in with GitHub
        </Button>
      )}

      {authState.step === 'loading' && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Starting authentication...
        </div>
      )}

      {authState.step === 'waiting' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Enter code:</span>
            <code className="bg-muted px-2 py-0.5 rounded text-[12px] font-mono font-bold tracking-wider">
              {authState.userCode}
            </code>
            <button
              onClick={() => copyCode(authState.userCode)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <a
            href={authState.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Open GitHub to authorize
          </a>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for authorization...
          </div>
        </div>
      )}

      {authState.step === 'authenticated' && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-success">● Connected to GitHub Copilot</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={disconnect}
            className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-destructive"
          >
            <LogOut className="h-3 w-3" />
            Disconnect
          </Button>
        </div>
      )}

      {authState.step === 'error' && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-destructive">{authState.message}</span>
          <Button variant="ghost" size="sm" onClick={startAuth} className="h-6 text-[10px] gap-1 w-fit">
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

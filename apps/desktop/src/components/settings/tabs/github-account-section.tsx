// ─── GitHub Account Section (Settings → Git) ────────────────────────────────
// Sign in / sign out with the HysCode GitHub OAuth App via the device flow.

import { useEffect, useState } from 'react';
import { LogIn, LogOut, Loader2, Copy, Check, ExternalLink, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGithubStore } from '@/stores/github-store';

interface GithubAccountSectionProps {
  className?: string;
}

export function GithubAccountSection({ className }: GithubAccountSectionProps) {
  const authStatus = useGithubStore((s) => s.authStatus);
  const user = useGithubStore((s) => s.user);
  const scopes = useGithubStore((s) => s.scopes);
  const deviceFlow = useGithubStore((s) => s.deviceFlow);
  const authError = useGithubStore((s) => s.authError);

  const checkAuth = useGithubStore((s) => s.checkAuth);
  const startLogin = useGithubStore((s) => s.startLogin);
  const cancelLogin = useGithubStore((s) => s.cancelLogin);
  const logout = useGithubStore((s) => s.logout);

  const [copied, setCopied] = useState(false);

  const hasWorkflowScope = (scopes ?? '').split(',').map((s) => s.trim()).includes('workflow');

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (authStatus === 'checking' || authStatus === 'unknown') {
    return (
      <div className={`flex items-center gap-2 text-[11px] text-muted-foreground ${className ?? ''}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking GitHub authentication…
      </div>
    );
  }

  if (authStatus === 'signed-in' && user) {
    return (
      <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
        <div className="flex items-center gap-2.5">
          <img
            src={user.avatar_url}
            alt=""
            className="h-7 w-7 rounded-full border border-border"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] font-medium text-foreground">
              {user.name ?? user.login}
            </span>
            <a
              href={user.html_url}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-muted-foreground hover:text-primary"
            >
              @{user.login}
            </a>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void logout()}
            className="ml-auto h-6 gap-1 text-[10px] text-muted-foreground hover:text-destructive"
          >
            <LogOut className="h-3 w-3" />
            Sign Out
          </Button>
        </div>
        {!hasWorkflowScope && (
          <div className="flex items-start gap-1.5 rounded-md border border-warning/20 bg-warning/5 px-2 py-1.5 text-[10px] text-warning">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              The current token lacks the <code className="rounded bg-muted px-1 font-mono">workflow</code> scope.
              Sign out and sign in again to push changes to{' '}
              <code className="rounded bg-muted px-1 font-mono">.github/workflows/*</code> files.
            </span>
          </div>
        )}
      </div>
    );
  }

  if (deviceFlow) {
    return (
      <div className={`flex flex-col gap-2 ${className ?? ''}`}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Enter code:</span>
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

  if (authError) {
    return (
      <div className={`flex flex-col gap-1 ${className ?? ''}`}>
        <span className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {authError}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void startLogin()}
          className="h-6 w-fit gap-1 text-[10px]"
        >
          <LogIn className="h-3 w-3" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void startLogin()}
      className={`h-7 gap-1.5 text-[11px] ${className ?? ''}`}
    >
      <LogIn className="h-3.5 w-3.5" />
      Sign in with GitHub
    </Button>
  );
}

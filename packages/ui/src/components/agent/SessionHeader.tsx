import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface SessionHeaderProps {
  /** Working directory, e.g. "~/projects/aurora-ui". */
  cwd?: ReactNode;
  branch?: ReactNode;
  sessionId?: ReactNode;
  /** Right-aligned slot (e.g. PermissionModeSelector). */
  actions?: ReactNode;
  className?: string;
}

/** Session context bar: cwd, git branch and session id (Codex / Claude Code). */
export function SessionHeader({ cwd, branch, sessionId, actions, className }: SessionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md   bg-card px-3 py-2 text-xs",
        className,
      )}
    >
      {cwd && (
        <span className="flex items-center gap-1.5 font-mono text-foreground">
          <span className="text-neutral-400">❯</span>
          {cwd}
        </span>
      )}
      {branch && (
        <span className="flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-primary">
          <span className="text-neutral-400">⎇</span>
          {branch}
        </span>
      )}
      {sessionId && <span className="font-mono text-muted-foreground">#{sessionId}</span>}
      {actions && <span className="ml-auto flex items-center gap-2">{actions}</span>}
    </div>
  );
}

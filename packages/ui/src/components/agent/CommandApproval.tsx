import { type ReactNode } from "react";
import { ShieldAlert, Terminal } from "lucide-react";
import { cn } from "../../lib/cn";

export interface CommandApprovalProps {
  /** The command the agent wants to run. */
  command: string;
  /** Optional working directory / context line. */
  workdir?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  onAllow?: () => void;
  onAllowAlways?: () => void;
  onDeny?: () => void;
  /** Once decided, lock the card into this state. */
  decision?: "allowed" | "denied" | null;
  className?: string;
}

/** Permission prompt asking the user to approve an agent action/command. */
export function CommandApproval({
  command,
  workdir,
  title = "Allow command?",
  description = "The agent wants to run the following command.",
  onAllow,
  onAllowAlways,
  onDeny,
  decision = null,
  className,
}: CommandApprovalProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg   bg-warning-500/5",
        className,
      )}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="mx-3 flex items-center gap-2 rounded-md bg-[var(--terminal-bg)] px-3 py-2 font-mono text-xs text-[var(--terminal-fg)]">
        <Terminal className="size-3.5 shrink-0 text-primary" />
        <code className="truncate">{command}</code>
      </div>
      {workdir && <p className="px-3 pt-1.5 font-mono text-[0.7rem] text-muted-foreground">{workdir}</p>}
      <div className="flex items-center justify-end gap-2 p-3">
        {decision === "allowed" ? (
          <span className="text-xs font-medium text-success-600">Allowed</span>
        ) : decision === "denied" ? (
          <span className="text-xs font-medium text-danger-600">Denied</span>
        ) : (
          <>
            <button
              type="button"
              onClick={onDeny}
              className="inline-flex h-8 items-center rounded-md   px-3 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              Deny
            </button>
            {onAllowAlways && (
              <button
                type="button"
                onClick={onAllowAlways}
                className="inline-flex h-8 items-center rounded-md   px-3 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                Always allow
              </button>
            )}
            <button
              type="button"
              onClick={onAllow}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              Allow
            </button>
          </>
        )}
      </div>
    </div>
  );
}

import { type ReactNode } from "react";
import { Loader2, Square } from "lucide-react";
import { cn } from "../../lib/cn";

export interface AgentStatusBarProps {
  /** Current activity text, e.g. "Editing App.tsx…". */
  status?: ReactNode;
  working?: boolean;
  elapsed?: ReactNode;
  tokens?: ReactNode;
  onStop?: () => void;
  /** Extra content on the right (e.g. TokenUsage). */
  right?: ReactNode;
  className?: string;
}

/** Slim agent activity bar: what it's doing + elapsed/tokens + stop. */
export function AgentStatusBar({
  status = "Working…",
  working = true,
  elapsed,
  tokens,
  onStop,
  right,
  className,
}: AgentStatusBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg   bg-card px-3 py-2 text-sm",
        className,
      )}
    >
      {working && <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
      <span className="truncate text-foreground">{status}</span>
      <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        {elapsed != null && <span className="tabular-nums">{elapsed}</span>}
        {tokens != null && <span className="tabular-nums">{tokens}</span>}
        {right}
        {working && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-1 rounded-md   px-2 py-1 font-medium text-foreground transition hover:bg-muted"
          >
            <Square className="size-3 fill-current" /> Stop
          </button>
        )}
      </div>
    </div>
  );
}

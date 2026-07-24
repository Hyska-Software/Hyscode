import { type ReactNode } from "react";
import { Bot } from "lucide-react";
import { cn } from "../../lib/cn";
import { StatusIcon } from "./StatusIcon";
import type { AgentStatus } from "./types";

export interface SubagentCardProps {
  name: ReactNode;
  description?: ReactNode;
  /** The subagent task, e.g. "Explore auth flow". */
  task?: ReactNode;
  status?: AgentStatus;
  /** Collapsible result payload. */
  result?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/** Card representing a spawned sub-agent (Codex sub-agents / Claude Code Task tool). */
export function SubagentCard({
  name,
  description,
  task,
  status = "running",
  result,
  defaultOpen = false,
  className,
}: SubagentCardProps) {
  const hasResult = result != null;
  return (
    <div className={cn("rounded-lg   bg-card", className)}>
      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <span className="flex size-5 items-center justify-center rounded bg-info-500/10 text-info-600 dark:text-info-400 [&_svg]:size-3.5">
            <Bot />
          </span>
          <span className="text-sm font-medium text-foreground">{name}</span>
          {task && <span className="truncate text-xs text-muted-foreground">— {task}</span>}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusIcon status={status} className="size-3.5" />
            <span className="capitalize">{status}</span>
          </span>
          {hasResult && (
            <svg
              className="size-4 text-neutral-400 transition group-open:rotate-90"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          )}
        </summary>
        {hasResult && <div className="  px-3 py-2 text-sm text-foreground">{result}</div>}
      </details>
      {!hasResult && description && (
        <p className="px-3 pb-2 -mt-1 text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

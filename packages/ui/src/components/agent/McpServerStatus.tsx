import { type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { StatusIcon } from "./StatusIcon";
import type { AgentStatus } from "./types";

export interface McpServer {
  name: ReactNode;
  /** Number of tools exposed by the server. */
  tools?: number;
  status?: AgentStatus;
  description?: ReactNode;
}

export interface McpServerStatusProps {
  servers: McpServer[];
  /** Render as a compact inline row (Claude Code status line). */
  compact?: boolean;
  className?: string;
}

/** MCP server connection list with per-server tool counts (Claude Code / Codex). */
export function McpServerStatus({ servers, compact = false, className }: McpServerStatusProps) {
  return (
    <div className={cn("w-full", className)}>
      {!compact && (
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">MCP servers</div>
      )}
      <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")}>
        {servers.map((s, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-1.5 rounded-md   bg-card",
              compact ? "px-2 py-0.5 text-xs" : "px-2.5 py-1.5 text-sm",
            )}
          >
            <StatusIcon status={s.status ?? "success"} className="size-3.5" />
            <span className="font-medium text-foreground">{s.name}</span>
            {s.tools != null && (
              <span className="rounded-sm bg-muted px-1 text-[11px] tabular-nums text-muted-foreground">
                {s.tools}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface McpToolBadgeProps {
  name: ReactNode;
  server?: ReactNode;
  className?: string;
}

/** Inline badge representing an MCP tool reference. */
export function McpToolBadge({ name, server, className }: McpToolBadgeProps) {
  return (
    <code
      className={cn(
        "inline-flex items-center gap-1 rounded bg-info-500/10 px-1.5 py-0.5 font-mono text-xs text-info-600 dark:text-info-400",
        className,
      )}
    >
      <span>{name}</span>
      {server && <span className="text-neutral-400">·{server}</span>}
    </code>
  );
}

import { type ReactNode } from "react";
import { ChevronRight, Terminal } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../primitives/Collapsible";
import { StatusIcon } from "./StatusIcon";
import type { AgentStatus } from "./types";

export interface ToolCallProps {
  /** Tool name, e.g. "bash", "read_file", "edit". */
  name: string;
  status?: AgentStatus;
  /** Short one-line summary, e.g. the command or target file. */
  summary?: ReactNode;
  icon?: ReactNode;
  /** Tool input, typically rendered as code. */
  input?: ReactNode;
  /** Tool output/result. */
  output?: ReactNode;
  defaultOpen?: boolean;
  /** Elapsed time label, e.g. "1.2s". */
  duration?: ReactNode;
  className?: string;
}

/** Collapsible agent tool invocation card (Codex/Claude Code style). */
export function ToolCall({
  name,
  status = "success",
  summary,
  icon,
  input,
  output,
  defaultOpen = false,
  duration,
  className,
}: ToolCallProps) {
  const hasBody = input != null || output != null;
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={cn("overflow-hidden rounded-lg   bg-card", className)}
    >
      <CollapsibleTrigger
        disabled={!hasBody}
        className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:cursor-default"
      >
        {hasBody && (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        )}
        <span className="text-muted-foreground [&_svg]:size-4">{icon ?? <Terminal />}</span>
        <span className="font-mono text-xs font-medium text-foreground">{name}</span>
        {summary != null && (
          <span className="truncate font-mono text-xs text-muted-foreground">{summary}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {duration != null && <span className="text-xs text-muted-foreground">{duration}</span>}
          <StatusIcon status={status} />
        </span>
      </CollapsibleTrigger>
      {hasBody && (
        <CollapsibleContent className=" ">
          {input != null && (
            <div className="  bg-[var(--terminal-bg)] px-3 py-2 font-mono text-xs text-[var(--terminal-fg)]">
              {input}
            </div>
          )}
          {output != null && (
            <div className="max-h-64 overflow-auto bg-[var(--terminal-bg)] px-3 py-2 font-mono text-xs text-neutral-400">
              {output}
            </div>
          )}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

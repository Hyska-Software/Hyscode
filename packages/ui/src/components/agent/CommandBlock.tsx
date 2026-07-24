import { type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { StatusIcon } from "./StatusIcon";
import type { AgentStatus } from "./types";

export interface CommandBlockProps {
  /** Tool label, e.g. "Bash", "Read", "Edit". */
  tool?: ReactNode;
  /** The command or argument, e.g. "npm test". */
  command: ReactNode;
  /** Streamed / captured output. */
  output?: ReactNode;
  status?: AgentStatus;
  /** Truncate output to N lines with a "+N lines" note when a number is given. */
  maxLines?: number;
  hiddenLines?: number;
  className?: string;
}

/** Claude Code-style command block: a bullet + `Tool(command)` header with an
 *  indented, left- output stream. */
export function CommandBlock({
  tool = "Bash",
  command,
  output,
  status = "success",
  hiddenLines,
  className,
}: CommandBlockProps) {
  return (
    <div className={cn("font-mono text-xs", className)}>
      <div className="flex items-center gap-2">
        <span className="shrink-0">
          <StatusIcon status={status} className="size-3.5" />
        </span>
        <span className="text-foreground">
          <span className="font-medium">{tool}</span>
          <span className="text-muted-foreground">(</span>
          <span className="text-primary">{command}</span>
          <span className="text-muted-foreground">)</span>
        </span>
      </div>
      {output != null && (
        <div className="ml-[7px] mt-1   pl-3">
          <pre className="whitespace-pre-wrap break-words text-muted-foreground">{output}</pre>
          {hiddenLines != null && hiddenLines > 0 && (
            <p className="mt-0.5 text-neutral-500">… +{hiddenLines} lines</p>
          )}
        </div>
      )}
    </div>
  );
}

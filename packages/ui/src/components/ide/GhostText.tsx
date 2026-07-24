import { type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Kbd } from "../primitives/Typography";

export interface GhostTextProps {
  /** Text the user has already typed. */
  typed: string;
  /** Copilot-style suggested completion appended after `typed`. */
  suggestion: string;
  /** Hint shown when there is a suggestion (e.g. accept with Tab). */
  hint?: ReactNode;
  className?: string;
}

/** Inline AI completion preview (Copilot ghost text). Presentational. */
export function GhostText({ typed, suggestion, hint = "Tab", className }: GhostTextProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md bg-[var(--terminal-bg)] px-3 py-2 font-mono text-sm",
        className,
      )}
    >
      <code className="text-[var(--terminal-fg)]">
        {typed}
        <span className="text-neutral-500">{suggestion}</span>
      </code>
      {suggestion && (
        <span className="ml-auto flex items-center gap-1 text-xs text-neutral-500">
          accept <Kbd>{hint}</Kbd>
        </span>
      )}
    </div>
  );
}

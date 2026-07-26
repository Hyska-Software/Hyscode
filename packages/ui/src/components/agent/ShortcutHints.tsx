import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface ShortcutHint {
  keys: ReactNode[];
  label: ReactNode;
}

export interface ShortcutHintsProps {
  hints: ShortcutHint[];
  className?: string;
}

/** Kbd-style shortcut legend (e.g. Exit plan: Esc · Clear: Shift+Esc). */
export function ShortcutHints({ hints, className }: ShortcutHintsProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      {hints.map((h, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {h.keys.map((k, j) => (
              <kbd
                key={j}
                className="inline-flex min-w-[1.25rem] items-center justify-center rounded   bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground"
              >
                {k}
              </kbd>
            ))}
          </span>
          <span>{h.label}</span>
        </span>
      ))}
    </div>
  );
}

import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface StreamingTextProps {
  children: ReactNode;
  /** Show a blinking caret at the end while streaming. */
  streaming?: boolean;
  className?: string;
}

/** Renders streamed assistant text with an optional blinking caret. */
export function StreamingText({ children, streaming, className }: StreamingTextProps) {
  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {children}
      {streaming && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-[aurora-fade-in_0.8s_steps(2)_infinite] bg-current align-baseline"
        />
      )}
    </span>
  );
}

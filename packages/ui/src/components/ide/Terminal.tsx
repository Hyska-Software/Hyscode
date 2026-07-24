import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type TerminalLineKind = "command" | "output" | "error" | "success" | "info";

export interface TerminalLine {
  id?: string;
  kind: TerminalLineKind;
  text: ReactNode;
}

export interface TerminalProps {
  lines: TerminalLine[];
  /** Prompt string shown before command lines. Default "$". */
  prompt?: string;
  title?: string;
  maxHeight?: string;
  className?: string;
  /** Content rendered after the last line (e.g. a live input). */
  footer?: ReactNode;
}

const kindClass: Record<TerminalLineKind, string> = {
  command: "text-neutral-100",
  output: "text-neutral-400",
  error: "text-danger-500",
  success: "text-primary",
  info: "text-info-500",
};

/** Styled terminal / console output panel. */
export const Terminal = forwardRef<HTMLDivElement, TerminalProps>(
  ({ lines, prompt = "$", title, maxHeight = "20rem", className, footer }, ref) => (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden rounded-lg   bg-[var(--terminal-bg)] text-[var(--terminal-fg)]",
        className,
      )}
    >
      {title && (
        <div className="flex items-center gap-2   px-4 py-2">
          <span className="flex gap-1.5">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </span>
          <span className="ml-2 font-mono text-xs text-neutral-400">{title}</span>
        </div>
      )}
      <div className="overflow-auto p-4 font-mono text-sm leading-relaxed" style={{ maxHeight }}>
        {lines.map((line, i) => (
          <div key={line.id ?? i} className={cn("whitespace-pre-wrap break-words", kindClass[line.kind])}>
            {line.kind === "command" && <span className="mr-2 select-none text-primary">{prompt}</span>}
            {line.text}
          </div>
        ))}
        {footer}
      </div>
    </div>
  ),
);
Terminal.displayName = "Terminal";

import { type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { Kbd } from "../primitives/Typography";

export interface SuggestionCardProps {
  /** The suggestion body (often a <CodeBlock/> or text). */
  children: ReactNode;
  title?: ReactNode;
  icon?: ReactNode;
  onAccept?: () => void;
  onReject?: () => void;
  acceptLabel?: ReactNode;
  rejectLabel?: ReactNode;
  /** Show Tab/Esc keyboard hints. Default true. */
  showHints?: boolean;
  /** Pagination for multiple suggestions, e.g. "1/3". */
  counter?: ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  className?: string;
}

/** AI suggestion preview with accept/reject (Copilot next-edit suggestion). */
export function SuggestionCard({
  children,
  title = "Suggestion",
  icon,
  onAccept,
  onReject,
  acceptLabel = "Accept",
  rejectLabel = "Reject",
  showHints = true,
  counter,
  onPrev,
  onNext,
  className,
}: SuggestionCardProps) {
  return (
    <div className={cn("overflow-hidden rounded-lg   bg-card shadow-sm", className)}>
      <div className="flex items-center gap-2   bg-primary/5 px-3 py-1.5">
        <span className="text-primary [&_svg]:size-4">{icon ?? <Sparkles />}</span>
        <span className="text-xs font-medium text-foreground">{title}</span>
        {counter != null && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            {onPrev && (
              <button type="button" onClick={onPrev} className="rounded px-1 hover:bg-muted" aria-label="Previous suggestion">
                ‹
              </button>
            )}
            {counter}
            {onNext && (
              <button type="button" onClick={onNext} className="rounded px-1 hover:bg-muted" aria-label="Next suggestion">
                ›
              </button>
            )}
          </span>
        )}
      </div>
      <div className="p-0">{children}</div>
      <div className="flex items-center justify-end gap-2   px-3 py-2">
        <button
          type="button"
          onClick={onReject}
          className="inline-flex h-7 items-center gap-1.5 rounded-md   px-2.5 text-xs font-medium text-foreground transition hover:bg-muted"
        >
          {rejectLabel}
          {showHints && <Kbd>Esc</Kbd>}
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          {acceptLabel}
          {showHints && <Kbd className=" bg-white/15 text-primary-foreground">Tab</Kbd>}
        </button>
      </div>
    </div>
  );
}

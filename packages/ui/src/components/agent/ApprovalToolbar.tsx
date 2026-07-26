import { type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { cn } from "../../lib/cn";

export interface ApprovalToolbarProps {
  /** Summary, e.g. "3 files changed" or custom node. */
  summary?: ReactNode;
  count?: number;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
  acceptLabel?: ReactNode;
  rejectLabel?: ReactNode;
  /** Extra content (e.g. a DiffStat) between summary and actions. */
  children?: ReactNode;
  className?: string;
}

/** Sticky "accept all / reject all" bar for reviewing agent changes. */
export function ApprovalToolbar({
  summary,
  count,
  onAcceptAll,
  onRejectAll,
  acceptLabel = "Accept all",
  rejectLabel = "Reject all",
  children,
  className,
}: ApprovalToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg   bg-card px-3 py-2",
        className,
      )}
    >
      <span className="text-sm font-medium text-foreground">
        {summary ?? (count != null ? `${count} ${count === 1 ? "change" : "changes"}` : "Review changes")}
      </span>
      {children}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onRejectAll}
          className="inline-flex h-8 items-center gap-1.5 rounded-md   px-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          <X className="size-4" />
          {rejectLabel}
        </button>
        <button
          type="button"
          onClick={onAcceptAll}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          <Check className="size-4" />
          {acceptLabel}
        </button>
      </div>
    </div>
  );
}

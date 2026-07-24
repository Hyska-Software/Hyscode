import { type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "../../lib/cn";

export interface CompactionNoticeProps {
  /** Tokens summarized / dropped. */
  summary?: ReactNode;
  message?: ReactNode;
  className?: string;
}

/** Notice marking where the conversation was auto-compacted (Claude Code). */
export function CompactionNotice({
  summary,
  message = "Earlier context was compacted to save tokens.",
  className,
}: CompactionNoticeProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md    bg-neutral-50 px-3 py-2 text-xs text-muted-foreground dark: dark:bg-neutral-900/40",
        className,
      )}
    >
      <Trash2 className="size-3.5 shrink-0 text-neutral-500" />
      <span>{message}</span>
      {summary && <span className="ml-auto font-medium text-foreground">{summary}</span>}
    </div>
  );
}

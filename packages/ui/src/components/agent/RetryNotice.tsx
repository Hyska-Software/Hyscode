import { type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "../../lib/cn";

export interface RetryNoticeProps {
  attempts: number;
  message?: ReactNode;
  /** Reason for the failure that triggered the retry. */
  reason?: ReactNode;
  className?: string;
}

/** Notice shown when an agent operation is retried after a transient error. */
export function RetryNotice({ attempts, message, reason, className }: RetryNoticeProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md   bg-warning-500/10 px-3 py-2 text-xs text-warning-700 dark:text-warning-400",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="space-y-0.5">
        <p className="font-medium">
          {message ?? `Retrying… (attempt ${attempts})`}
        </p>
        {reason && <p className="text-muted-foreground">{reason}</p>}
      </div>
    </div>
  );
}

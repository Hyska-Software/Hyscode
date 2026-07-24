import { type ReactNode } from "react";
import { ClipboardList } from "lucide-react";
import { cn } from "../../lib/cn";

export interface PlanCardProps {
  /** Plan body — markdown-rendered content or a list. */
  children: ReactNode;
  title?: ReactNode;
  question?: ReactNode;
  onApprove?: () => void;
  onKeepPlanning?: () => void;
  approveLabel?: ReactNode;
  keepPlanningLabel?: ReactNode;
  /** Locks the card once a decision is made. */
  decided?: boolean;
  className?: string;
}

/** Plan-mode approval card (Claude Code ExitPlanMode): presents a proposed plan
 *  and asks the user to approve execution or keep planning. */
export function PlanCard({
  children,
  title = "Ready to code?",
  question = "Here is the plan. Approve to start making changes.",
  onApprove,
  onKeepPlanning,
  approveLabel = "Approve & run",
  keepPlanningLabel = "Keep planning",
  decided = false,
  className,
}: PlanCardProps) {
  return (
    <div className={cn("overflow-hidden rounded-xl   bg-card", className)}>
      <div className="flex items-center gap-2   bg-primary/5 px-4 py-2.5">
        <ClipboardList className="size-4 text-primary" />
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      <div className="space-y-2 px-4 py-3 text-sm leading-relaxed text-foreground [&_ol]:ml-4 [&_ol]:list-decimal [&_ul]:ml-4 [&_ul]:list-disc [&_li]:my-0.5">
        {children}
      </div>
      {!decided && (onApprove || onKeepPlanning) && (
        <div className="flex flex-col gap-2   px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          {question && <p className="text-xs text-muted-foreground">{question}</p>}
          <div className="flex items-center gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={onKeepPlanning}
              className="inline-flex h-8 items-center rounded-md   px-3 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              {keepPlanningLabel}
            </button>
            <button
              type="button"
              onClick={onApprove}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              {approveLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

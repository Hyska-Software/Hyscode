import { type ReactNode } from "react";
import { Zap } from "lucide-react";
import { cn } from "../../lib/cn";

export interface UsageMeterProps {
  used: number;
  total: number;
  label?: ReactNode;
  /** Unit shown after numbers, e.g. "credits", "messages". */
  unit?: ReactNode;
  icon?: ReactNode;
  /** Call-to-action (e.g. an upgrade button) shown on the right. */
  action?: ReactNode;
  variant?: "bar" | "compact";
  className?: string;
}

/** Credits / quota usage meter (Lovable / Replit / Copilot). */
export function UsageMeter({
  used,
  total,
  label = "Usage",
  unit = "credits",
  icon,
  action,
  variant = "bar",
  className,
}: UsageMeterProps) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const low = total - used <= total * 0.1;
  const barColor = pct >= 100 ? "bg-danger-500" : low ? "bg-warning-500" : "bg-primary";

  if (variant === "compact") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        {icon ?? <Zap className="size-3.5 text-primary" />}
        <span className="tabular-nums text-foreground">{Math.max(0, total - used)}</span>
        {unit} left
      </span>
    );
  }

  return (
    <div className={cn("rounded-lg   bg-card p-3", className)}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          {icon ?? <Zap className="size-4 text-primary" />}
          {label}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {used.toLocaleString()} / {total.toLocaleString()} {unit}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-500", barColor)} style={{ width: `${pct}%` }} />
      </div>
      {(low || action) && (
        <div className="mt-2 flex items-center justify-between">
          {low ? (
            <span className="text-xs text-warning-600">Running low on {unit}</span>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
    </div>
  );
}

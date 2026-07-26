import { type ComponentPropsWithoutRef, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "../../lib/cn";

export interface StatProps extends ComponentPropsWithoutRef<"div"> {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  /** Percentage change; sign controls the up/down arrow and color. */
  change?: number;
  helpText?: ReactNode;
}

/** KPI / metric display with optional trend indicator. */
export function Stat({ label, value, icon, change, helpText, className, ...props }: StatProps) {
  const positive = (change ?? 0) >= 0;
  return (
    <div className={cn("rounded-xl   bg-card p-5", className)} {...props}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        {change != null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              positive ? "text-success-600" : "text-danger-600",
            )}
          >
            {positive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(change)}%
          </span>
        )}
      </div>
      {helpText && <p className="mt-1 text-xs text-muted-foreground">{helpText}</p>}
    </div>
  );
}

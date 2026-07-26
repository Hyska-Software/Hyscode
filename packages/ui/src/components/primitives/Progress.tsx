import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export interface ProgressProps extends ComponentPropsWithoutRef<"div"> {
  /** 0–100. Omit for an indeterminate bar. */
  value?: number;
  max?: number;
  size?: "sm" | "md";
}

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, size = "md", ...props }, ref) => {
    const indeterminate = value == null;
    const pct = indeterminate ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={indeterminate ? undefined : value}
        className={cn(
          "w-full overflow-hidden rounded-full bg-muted",
          size === "sm" ? "h-1" : "h-2",
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-[width] duration-300 ease-out",
            indeterminate && "w-1/3 animate-[aurora-shimmer_1.2s_infinite]",
          )}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = "Progress";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export interface SkeletonProps extends ComponentPropsWithoutRef<"div"> {}

/** Content placeholder with a subtle shimmer. */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-md bg-muted",
        "before:absolute before:inset-0 before:-translate-x-full before:animate-[aurora-shimmer_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-black/5 before:to-transparent dark:before:via-white/10",
        className,
      )}
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";

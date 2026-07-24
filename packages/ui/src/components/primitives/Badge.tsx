import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full  font-medium transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: " bg-muted text-muted-foreground",
        primary: " bg-primary/15 text-primary",
        success: " bg-success-500/15 text-success-600",
        warning: " bg-warning-500/15 text-warning-600",
        danger: " bg-danger-500/15 text-danger-600",
        outline: " bg-transparent text-foreground",
      },
      size: {
        sm: "px-2 py-0.5 text-[0.7rem]",
        md: "px-2.5 py-0.5 text-xs",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  },
);

export interface BadgeProps
  extends ComponentPropsWithoutRef<"span">,
    VariantProps<typeof badgeVariants> {
  /** Show a leading status dot. */
  dot?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, dot, children, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  ),
);
Badge.displayName = "Badge";

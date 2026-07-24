import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const spinnerVariants = cva(
  "inline-block animate-spin rounded-full  ",
  {
    variants: {
      size: {
        xs: "size-3 ",
        sm: "size-4 ",
        md: "size-5 ",
        lg: "size-8 [3px]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface SpinnerProps
  extends ComponentPropsWithoutRef<"span">,
    VariantProps<typeof spinnerVariants> {
  label?: string;
}

export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(
  ({ className, size, label = "Loading", ...props }, ref) => (
    <span
      ref={ref}
      role="status"
      aria-label={label}
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    />
  ),
);
Spinner.displayName = "Spinner";

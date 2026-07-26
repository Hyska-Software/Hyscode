import { forwardRef, type ElementType, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export interface BoxProps extends ComponentPropsWithoutRef<"div"> {
  /** Render as a different element/component. */
  as?: ElementType;
}

/** The lowest-level layout primitive. */
export const Box = forwardRef<HTMLDivElement, BoxProps>(
  ({ as: Comp = "div", className, ...props }, ref) => {
    return <Comp ref={ref} className={cn(className)} {...props} />;
  },
);
Box.displayName = "Box";

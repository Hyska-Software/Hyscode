import { forwardRef, type ComponentPropsWithoutRef } from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "../../lib/cn";

export interface DividerProps
  extends ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  /** Optional label rendered in the middle (horizontal only). */
  label?: string;
}

/** Visual/semantic separator. */
export const Divider = forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  DividerProps
>(({ className, orientation = "horizontal", decorative = true, label, ...props }, ref) => {
  if (label && orientation === "horizontal") {
    return (
      <div className="flex items-center gap-3 text-muted-foreground" role="separator">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      orientation={orientation}
      decorative={decorative}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
});
Divider.displayName = "Divider";

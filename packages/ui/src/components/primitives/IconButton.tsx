import { forwardRef, type ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";
import { cn } from "../../lib/cn";

export interface IconButtonProps extends Omit<ButtonProps, "leftIcon" | "rightIcon" | "children"> {
  /** Accessible label — required for icon-only buttons. */
  "aria-label": string;
  icon: ReactNode;
}

/** Square, icon-only button. Requires an aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, className, size = "icon", variant = "ghost", ...props }, ref) => (
    <Button
      ref={ref}
      size={size === "icon" ? "icon" : size}
      variant={variant}
      className={cn(size !== "icon" && "aspect-square px-0", className)}
      {...props}
    >
      {icon}
    </Button>
  ),
);
IconButton.displayName = "IconButton";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

export interface SelectProps extends Omit<ComponentPropsWithoutRef<"select">, "size"> {
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
}

/** Styled native <select> for simple option lists. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size = "md", invalid, children, ...props }, ref) => (
    <div className="relative inline-flex w-full items-center">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full appearance-none rounded-md  bg-card pr-9 text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          size === "sm" && "h-8 px-2.5 text-sm",
          size === "md" && "h-9 px-3 text-sm",
          size === "lg" && "h-11 px-4 text-base",
          invalid ? " focus:ring-destructive" : "",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted-foreground" />
    </div>
  ),
);
Select.displayName = "Select";

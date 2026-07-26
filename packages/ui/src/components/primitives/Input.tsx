import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const inputWrapperVariants = cva(
  "flex items-center gap-2 rounded-md  bg-card transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
  {
    variants: {
      size: {
        sm: "h-8 px-2.5 text-sm",
        md: "h-9 px-3 text-sm",
        lg: "h-11 px-4 text-base",
      },
      invalid: {
        true: " focus-within:ring-destructive",
        false: "",
      },
    },
    defaultVariants: { size: "md", invalid: false },
  },
);

export interface InputProps
  extends Omit<ComponentPropsWithoutRef<"input">, "size">,
    VariantProps<typeof inputWrapperVariants> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, invalid, leftIcon, rightIcon, disabled, ...props }, ref) => (
    <div
      className={cn(
        inputWrapperVariants({ size, invalid }),
        disabled && "cursor-not-allowed opacity-50",
        "text-muted-foreground",
        className,
      )}
    >
      {leftIcon && <span className="flex shrink-0 [&_svg]:size-4">{leftIcon}</span>}
      <input
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        {...props}
      />
      {rightIcon && <span className="flex shrink-0 [&_svg]:size-4">{rightIcon}</span>}
    </div>
  ),
);
Input.displayName = "Input";

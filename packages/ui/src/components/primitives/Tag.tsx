import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

const tagVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md  font-medium transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        solid: " bg-muted text-foreground",
        outline: " bg-transparent text-foreground",
        primary: " bg-primary/15 text-primary",
      },
      size: {
        sm: "h-6 px-2 text-xs",
        md: "h-7 px-2.5 text-sm",
      },
    },
    defaultVariants: { variant: "solid", size: "md" },
  },
);

export interface TagProps
  extends ComponentPropsWithoutRef<"span">,
    VariantProps<typeof tagVariants> {
  icon?: ReactNode;
  /** Renders a remove (×) button and calls this handler. */
  onRemove?: () => void;
}

/** Compact, optionally removable chip. */
export const Tag = forwardRef<HTMLSpanElement, TagProps>(
  ({ className, variant, size, icon, onRemove, children, ...props }, ref) => (
    <span ref={ref} className={cn(tagVariants({ variant, size }), className)} {...props}>
      {icon}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="-mr-0.5 ml-0.5 flex items-center justify-center rounded-sm text-muted-foreground transition hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  ),
);
Tag.displayName = "Tag";

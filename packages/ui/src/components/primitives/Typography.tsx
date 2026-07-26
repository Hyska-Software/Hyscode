import { forwardRef, type ComponentPropsWithoutRef, type ElementType } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/* ---------------------------------- Heading -------------------------------- */
const headingVariants = cva("font-semibold tracking-tight text-foreground", {
  variants: {
    size: {
      xs: "text-base",
      sm: "text-lg",
      md: "text-xl",
      lg: "text-2xl",
      xl: "text-3xl",
      "2xl": "text-4xl",
      "3xl": "text-5xl leading-[1.05]",
      "4xl": "text-6xl leading-[1.02]",
    },
  },
  defaultVariants: { size: "lg" },
});

export interface HeadingProps
  extends ComponentPropsWithoutRef<"h2">,
    VariantProps<typeof headingVariants> {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ as: Comp = "h2", size, className, ...props }, ref) => (
    <Comp ref={ref} className={cn(headingVariants({ size }), className)} {...props} />
  ),
);
Heading.displayName = "Heading";

/* ----------------------------------- Text ---------------------------------- */
const textVariants = cva("", {
  variants: {
    size: {
      xs: "text-xs",
      sm: "text-sm",
      md: "text-base",
      lg: "text-lg",
    },
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
      bold: "font-bold",
    },
    tone: {
      default: "text-foreground",
      muted: "text-muted-foreground",
      primary: "text-primary",
      danger: "text-destructive",
    },
    align: {
      left: "text-left",
      center: "text-center",
      right: "text-right",
    },
  },
  defaultVariants: { size: "md", weight: "normal", tone: "default" },
});

export interface TextProps
  extends Omit<ComponentPropsWithoutRef<"p">, "color">,
    VariantProps<typeof textVariants> {
  as?: ElementType;
}

export const Text = forwardRef<HTMLParagraphElement, TextProps>(
  ({ as: Comp = "p", size, weight, tone, align, className, ...props }, ref) => (
    <Comp
      ref={ref}
      className={cn(textVariants({ size, weight, tone, align }), className)}
      {...props}
    />
  ),
);
Text.displayName = "Text";

/* ----------------------------------- Code ---------------------------------- */
export interface CodeProps extends ComponentPropsWithoutRef<"code"> {}

export const Code = forwardRef<HTMLElement, CodeProps>(
  ({ className, ...props }, ref) => (
    <code
      ref={ref}
      className={cn(
        "rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground",
        className,
      )}
      {...props}
    />
  ),
);
Code.displayName = "Code";

/* ------------------------------------ Kbd ---------------------------------- */
export interface KbdProps extends ComponentPropsWithoutRef<"kbd"> {}

export const Kbd = forwardRef<HTMLElement, KbdProps>(
  ({ className, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded   bg-muted px-1.5 font-mono text-[0.7rem] font-medium text-muted-foreground shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)]",
        className,
      )}
      {...props}
    />
  ),
);
Kbd.displayName = "Kbd";

/* ----------------------------------- Link ---------------------------------- */
export interface LinkProps extends ComponentPropsWithoutRef<"a"> {
  underline?: "always" | "hover" | "none";
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ className, underline = "hover", ...props }, ref) => (
    <a
      ref={ref}
      className={cn(
        "rounded-sm text-primary transition-colors hover:text-primary",
        underline === "always" && "underline underline-offset-4",
        underline === "hover" && "hover:underline underline-offset-4",
        className,
      )}
      {...props}
    />
  ),
);
Link.displayName = "Link";

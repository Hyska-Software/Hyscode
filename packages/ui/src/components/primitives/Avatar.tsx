import { forwardRef, type ComponentPropsWithoutRef } from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const avatarVariants = cva(
  "relative flex shrink-0 overflow-hidden rounded-full bg-muted",
  {
    variants: {
      size: {
        xs: "size-6 text-[0.6rem]",
        sm: "size-8 text-xs",
        md: "size-10 text-sm",
        lg: "size-12 text-base",
        xl: "size-16 text-lg",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface AvatarProps
  extends ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {
  src?: string;
  alt?: string;
  /** Fallback shown while/if the image fails (e.g. initials). */
  fallback?: string;
}

export const Avatar = forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Root>,
  AvatarProps
>(({ className, size, src, alt, fallback, ...props }, ref) => (
  <AvatarPrimitive.Root ref={ref} className={cn(avatarVariants({ size }), className)} {...props}>
    {src && (
      <AvatarPrimitive.Image
        src={src}
        alt={alt}
        className="aspect-square size-full object-cover"
      />
    )}
    <AvatarPrimitive.Fallback className="flex size-full items-center justify-center font-medium text-muted-foreground">
      {fallback}
    </AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>
));
Avatar.displayName = "Avatar";

export interface AvatarGroupProps extends ComponentPropsWithoutRef<"div"> {
  /** Negative overlap spacing utility, default -space-x-2. */
  spacing?: string;
}

export const AvatarGroup = forwardRef<HTMLDivElement, AvatarGroupProps>(
  ({ className, spacing = "-space-x-2", ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center [&>*]:ring-2 [&>*]:ring-background", spacing, className)}
      {...props}
    />
  ),
);
AvatarGroup.displayName = "AvatarGroup";

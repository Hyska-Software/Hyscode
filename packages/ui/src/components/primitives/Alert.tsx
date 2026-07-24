import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Info, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "../../lib/cn";

const alertVariants = cva(
  "relative flex gap-3 rounded-lg  p-4 text-sm [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        info: " bg-info-500/10 text-info-600 [&_svg]:text-info-500",
        success:
          " bg-success-500/10 text-success-600 [&_svg]:text-success-500",
        warning:
          " bg-warning-500/10 text-warning-600 [&_svg]:text-warning-500",
        danger:
          " bg-danger-500/10 text-danger-600 [&_svg]:text-danger-500",
        neutral: " bg-muted text-foreground [&_svg]:text-muted-foreground",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  neutral: Info,
} as const;

export interface AlertProps
  extends Omit<ComponentPropsWithoutRef<"div">, "title">,
    VariantProps<typeof alertVariants> {
  title?: ReactNode;
  icon?: ReactNode | false;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", title, icon, children, ...props }, ref) => {
    const Icon = icons[variant ?? "info"];
    return (
      <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
        {icon !== false && (icon ?? <Icon />)}
        <div className="flex-1 space-y-1">
          {title && <div className="font-medium text-foreground">{title}</div>}
          {children && <div className="text-muted-foreground">{children}</div>}
        </div>
      </div>
    );
  },
);
Alert.displayName = "Alert";

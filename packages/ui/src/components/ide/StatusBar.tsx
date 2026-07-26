import { type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface StatusBarProps extends ComponentPropsWithoutRef<"div"> {
  left?: ReactNode;
  right?: ReactNode;
}

/** VS Code-style bottom status bar. */
export function StatusBar({ left, right, className, children, ...props }: StatusBarProps) {
  return (
    <div
      className={cn(
        "flex h-6 items-center justify-between bg-primary px-3 text-xs text-primary-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <div className="flex items-center gap-3">{left}</div>
          <div className="flex items-center gap-3">{right}</div>
        </>
      )}
    </div>
  );
}

export interface StatusBarItemProps extends ComponentPropsWithoutRef<"button"> {
  icon?: ReactNode;
}

export function StatusBarItem({ icon, children, className, ...props }: StatusBarItemProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1 transition-colors hover:bg-white/15 [&_svg]:size-3.5",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

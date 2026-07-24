import { type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface AppShellProps extends ComponentPropsWithoutRef<"div"> {
  sidebar?: ReactNode;
  topbar?: ReactNode;
  statusbar?: ReactNode;
  /** Sidebar width utility class. Default w-64. */
  sidebarWidth?: string;
}

/** Full-height application layout: topbar + sidebar + content (+ optional status bar). */
export function AppShell({
  sidebar,
  topbar,
  statusbar,
  sidebarWidth = "w-64",
  className,
  children,
  ...props
}: AppShellProps) {
  return (
    <div className={cn("flex h-screen flex-col overflow-hidden bg-background", className)} {...props}>
      {topbar && (
        <header className="flex h-14 shrink-0 items-center   px-4">
          {topbar}
        </header>
      )}
      <div className="flex min-h-0 flex-1">
        {sidebar && (
          <aside className={cn("shrink-0 overflow-y-auto  ", sidebarWidth)}>
            {sidebar}
          </aside>
        )}
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
      {statusbar && <footer className="shrink-0">{statusbar}</footer>}
    </div>
  );
}

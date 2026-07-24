import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";

export interface FilePathBreadcrumbProps {
  /** File path, e.g. "src/components/Button.tsx". */
  path: string;
  separator?: string;
  onSegmentClick?: (segment: string, index: number, fullPath: string) => void;
  /** Icon shown before the final (file) segment. */
  fileIcon?: ReactNode;
  className?: string;
}

/** Compact editor path breadcrumb (VS Code style). */
export function FilePathBreadcrumb({
  path,
  separator = "/",
  onSegmentClick,
  fileIcon,
  className,
}: FilePathBreadcrumbProps) {
  const segments = path.split(separator).filter(Boolean);
  return (
    <nav
      aria-label="File path"
      className={cn("flex items-center gap-1 overflow-x-auto text-xs text-muted-foreground", className)}
    >
      {segments.map((seg, i) => {
        const last = i === segments.length - 1;
        const full = segments.slice(0, i + 1).join(separator);
        return (
          <Fragment key={i}>
            <button
              type="button"
              onClick={() => onSegmentClick?.(seg, i, full)}
              className={cn(
                "flex items-center gap-1 rounded-sm px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground",
                last && "font-medium text-foreground",
              )}
            >
              {last && fileIcon}
              {seg}
            </button>
            {!last && <ChevronRight className="size-3 shrink-0 text-neutral-400" />}
          </Fragment>
        );
      })}
    </nav>
  );
}

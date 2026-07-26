import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/cn";

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Sibling pages shown around the current page. Default 1. */
  siblingCount?: number;
  className?: string;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function usePages(page: number, pageCount: number, siblingCount: number): (number | "…")[] {
  const totalNumbers = siblingCount * 2 + 5;
  if (pageCount <= totalNumbers) return range(1, pageCount);

  const left = Math.max(page - siblingCount, 1);
  const right = Math.min(page + siblingCount, pageCount);
  const showLeftDots = left > 2;
  const showRightDots = right < pageCount - 1;

  if (!showLeftDots && showRightDots) {
    return [...range(1, 3 + siblingCount * 2), "…", pageCount];
  }
  if (showLeftDots && !showRightDots) {
    return [1, "…", ...range(pageCount - (2 + siblingCount * 2), pageCount)];
  }
  return [1, "…", ...range(left, right), "…", pageCount];
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  className,
}: PaginationProps) {
  const pages = usePages(page, pageCount, siblingCount);
  const btn =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40";

  return (
    <nav aria-label="Pagination" className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground")}
      >
        <ChevronLeft className="size-4" />
      </button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`dots-${i}`} className="flex h-9 w-9 items-center justify-center text-muted-foreground">
            <MoreHorizontal className="size-4" />
          </span>
        ) : (
          <button
            key={p}
            type="button"
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPageChange(p)}
            className={cn(
              btn,
              p === page
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted",
            )}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground")}
      >
        <ChevronRight className="size-4" />
      </button>
    </nav>
  );
}

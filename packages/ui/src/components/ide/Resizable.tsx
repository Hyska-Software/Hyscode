import {
  Children,
  isValidElement,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";

export interface ResizablePanelProps {
  children: ReactNode;
  /** Initial size in percent (0–100). */
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  className?: string;
}

/** Marker component; sizing is handled by ResizablePanelGroup. */
export function ResizablePanel({ children, className }: ResizablePanelProps) {
  return <div className={cn("min-h-0 min-w-0 overflow-auto", className)}>{children}</div>;
}

export interface ResizablePanelGroupProps {
  direction?: "horizontal" | "vertical";
  children: ReactNode;
  className?: string;
}

/** Two-panel resizable layout with a draggable . */
export function ResizablePanelGroup({
  direction = "horizontal",
  children,
  className,
}: ResizablePanelGroupProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panels = Children.toArray(children).filter(isValidElement);
  const first = panels[0] as React.ReactElement<ResizablePanelProps> | undefined;
  const [size, setSize] = useState(first?.props.defaultSize ?? 50);
  const dragging = useRef(false);

  const isH = direction === "horizontal";
  const min = first?.props.minSize ?? 10;
  const max = first?.props.maxSize ?? 90;

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = isH
        ? ((e.clientX - rect.left) / rect.width) * 100
        : ((e.clientY - rect.top) / rect.height) * 100;
      setSize(Math.min(max, Math.max(min, pct)));
    },
    [isH, min, max],
  );

  const stop = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stop);
  }, [onPointerMove]);

  const start = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = isH ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
  }, [isH, onPointerMove, stop]);

  return (
    <div
      ref={containerRef}
      className={cn("flex min-h-0 min-w-0", isH ? "flex-row" : "flex-col", className)}
    >
      <div style={{ flexBasis: `${size}%` }} className="min-h-0 min-w-0 overflow-hidden">
        {panels[0]}
      </div>
      <div
        role="separator"
        aria-orientation={isH ? "vertical" : "horizontal"}
        onPointerDown={start}
        className={cn(
          "group relative flex shrink-0 items-center justify-center bg-border transition-colors hover:bg-primary/50",
          isH ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        )}
      >
        <span
          className={cn(
            "absolute",
            isH ? "inset-y-0 -left-1 -right-1" : "inset-x-0 -top-1 -bottom-1",
          )}
        />
      </div>
      <div style={{ flexBasis: `${100 - size}%` }} className="min-h-0 min-w-0 overflow-hidden">
        {panels[1]}
      </div>
    </div>
  );
}

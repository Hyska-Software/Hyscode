import { type ReactNode } from "react";
import { GitCommitHorizontal, History, RotateCcw } from "lucide-react";
import { cn } from "../../lib/cn";

export interface Checkpoint {
  id: string;
  label: ReactNode;
  time?: ReactNode;
  description?: ReactNode;
  /** The currently active/restored checkpoint. */
  current?: boolean;
}

export interface CheckpointListProps {
  checkpoints: Checkpoint[];
  title?: ReactNode;
  onRestore?: (id: string) => void;
  onSelect?: (id: string) => void;
  className?: string;
}

/** Version history / restore points (Lovable / Replit / bolt checkpoints). */
export function CheckpointList({
  checkpoints,
  title = "History",
  onRestore,
  onSelect,
  className,
}: CheckpointListProps) {
  return (
    <div className={cn("overflow-hidden rounded-lg   bg-card", className)}>
      {title && (
        <div className="flex items-center gap-2   px-3 py-2 text-sm font-medium text-foreground">
          <History className="size-4 text-muted-foreground" />
          {title}
        </div>
      )}
      <ol className="relative p-2">
        {checkpoints.map((cp, i) => {
          const last = i === checkpoints.length - 1;
          return (
            <li key={cp.id} className="group relative flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
              <div className="flex flex-col items-center">
                <GitCommitHorizontal
                  className={cn("size-4 shrink-0", cp.current ? "text-primary" : "text-muted-foreground")}
                />
                {!last && <span className="mt-1 w-px flex-1 bg-border" />}
              </div>
              <button
                type="button"
                onClick={() => onSelect?.(cp.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("truncate text-sm", cp.current ? "font-medium text-foreground" : "text-foreground")}>
                    {cp.label}
                  </span>
                  {cp.current && (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-primary">
                      current
                    </span>
                  )}
                </div>
                {cp.description && (
                  <p className="truncate text-xs text-muted-foreground">{cp.description}</p>
                )}
                {cp.time && <p className="text-xs text-muted-foreground">{cp.time}</p>}
              </button>
              {onRestore && !cp.current && (
                <button
                  type="button"
                  onClick={() => onRestore(cp.id)}
                  className="inline-flex h-7 shrink-0 items-center gap-1 self-center rounded-md   px-2 text-xs font-medium text-foreground opacity-0 transition hover:bg-muted group-hover:opacity-100"
                >
                  <RotateCcw className="size-3.5" /> Restore
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

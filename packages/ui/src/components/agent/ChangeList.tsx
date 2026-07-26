import { type ReactNode } from "react";
import { Check, FileDiff, FilePlus2, FileX2, X } from "lucide-react";
import { cn } from "../../lib/cn";
import type { FileChangeKind } from "./FileGenerationList";

/* ---------------------------------- DiffStat ------------------------------- */
export interface DiffStatProps {
  additions?: number;
  deletions?: number;
  /** Number of squares in the visual bar. Default 5. */
  segments?: number;
  showCounts?: boolean;
  className?: string;
}

/** GitHub-style +/- diff stat with a colored square bar. */
export function DiffStat({
  additions = 0,
  deletions = 0,
  segments = 5,
  showCounts = true,
  className,
}: DiffStatProps) {
  const total = additions + deletions;
  const addSeg = total === 0 ? 0 : Math.round((additions / total) * segments);
  const delSeg = total === 0 ? 0 : Math.min(segments - addSeg, Math.round((deletions / total) * segments));
  const neutral = segments - addSeg - delSeg;

  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs", className)}>
      {showCounts && (
        <>
          <span className="text-success-600">+{additions}</span>
          <span className="text-danger-600">-{deletions}</span>
        </>
      )}
      <span className="inline-flex gap-0.5">
        {Array.from({ length: addSeg }, (_, i) => (
          <span key={`a${i}`} className="size-2 rounded-[2px] bg-success-500" />
        ))}
        {Array.from({ length: delSeg }, (_, i) => (
          <span key={`d${i}`} className="size-2 rounded-[2px] bg-danger-500" />
        ))}
        {Array.from({ length: neutral }, (_, i) => (
          <span key={`n${i}`} className="size-2 rounded-[2px] bg-muted" />
        ))}
      </span>
    </span>
  );
}

/* --------------------------------- ChangeList ------------------------------ */
export type ChangeState = "pending" | "accepted" | "rejected";

export interface FileChange {
  id?: string;
  path: string;
  kind?: FileChangeKind;
  additions?: number;
  deletions?: number;
  state?: ChangeState;
}

export interface ChangeListProps {
  changes: FileChange[];
  title?: ReactNode;
  onSelect?: (change: FileChange) => void;
  onAccept?: (change: FileChange) => void;
  onReject?: (change: FileChange) => void;
  className?: string;
}

const kindIcon: Record<FileChangeKind, ReactNode> = {
  create: <FilePlus2 className="size-4 text-success-500" />,
  edit: <FileDiff className="size-4 text-primary" />,
  delete: <FileX2 className="size-4 text-danger-500" />,
};

/** Multi-file change review list with per-file accept/reject (Cursor / Copilot). */
export function ChangeList({ changes, title, onSelect, onAccept, onReject, className }: ChangeListProps) {
  return (
    <div className={cn("overflow-hidden rounded-lg   bg-card", className)}>
      {title && (
        <div className="  px-3 py-2 text-xs font-medium text-muted-foreground">
          {title}
        </div>
      )}
      <ul className=" ">
        {changes.map((change, i) => {
          const state = change.state ?? "pending";
          return (
            <li
              key={change.id ?? i}
              className={cn(
                "group flex items-center gap-2 px-3 py-2 text-sm",
                state === "rejected" && "opacity-50",
              )}
            >
              <span className="shrink-0">{kindIcon[change.kind ?? "edit"]}</span>
              <button
                type="button"
                onClick={() => onSelect?.(change)}
                className="min-w-0 flex-1 truncate text-left font-mono text-xs text-foreground hover:underline"
              >
                {change.path}
              </button>
              <DiffStat additions={change.additions} deletions={change.deletions} showCounts={false} />
              {state === "pending" && (onAccept || onReject) ? (
                <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  {onReject && (
                    <button
                      type="button"
                      onClick={() => onReject(change)}
                      aria-label="Reject"
                      className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                  {onAccept && (
                    <button
                      type="button"
                      onClick={() => onAccept(change)}
                      aria-label="Accept"
                      className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-success-600"
                    >
                      <Check className="size-3.5" />
                    </button>
                  )}
                </span>
              ) : state === "accepted" ? (
                <Check className="size-4 text-success-500" />
              ) : state === "rejected" ? (
                <X className="size-4 text-muted-foreground" />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

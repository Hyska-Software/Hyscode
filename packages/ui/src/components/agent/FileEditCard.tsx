import { type ReactNode } from "react";
import { Check, FilePlus2, FileX2, FileDiff, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { DiffViewer } from "../ide/DiffViewer";
import type { AgentStatus } from "./types";

export type EditKind = "create" | "edit" | "delete";

export interface FileEditCardProps {
  path: string;
  kind?: EditKind;
  oldValue?: string;
  newValue?: string;
  /** Lines added / removed summary (overrides auto count). */
  additions?: number;
  deletions?: number;
  status?: AgentStatus | "proposed";
  onAccept?: () => void;
  onReject?: () => void;
  diffMode?: "unified" | "split";
  maxHeight?: string;
  className?: string;
  children?: ReactNode;
}

const kindIcon: Record<EditKind, ReactNode> = {
  create: <FilePlus2 className="size-4 text-success-500" />,
  edit: <FileDiff className="size-4 text-primary" />,
  delete: <FileX2 className="size-4 text-danger-500" />,
};

function countDiff(oldValue = "", newValue = "") {
  const a = oldValue ? oldValue.split("\n").length : 0;
  const b = newValue ? newValue.split("\n").length : 0;
  return { additions: Math.max(0, b - a), deletions: Math.max(0, a - b) };
}

/** Proposed file change from an agent, with diff and accept/reject actions. */
export function FileEditCard({
  path,
  kind = "edit",
  oldValue = "",
  newValue = "",
  additions,
  deletions,
  status = "proposed",
  onAccept,
  onReject,
  diffMode = "unified",
  maxHeight = "20rem",
  className,
  children,
}: FileEditCardProps) {
  const auto = countDiff(oldValue, newValue);
  const add = additions ?? auto.additions;
  const del = deletions ?? auto.deletions;
  const showActions = status === "proposed" && (onAccept || onReject);

  return (
    <div className={cn("overflow-hidden rounded-lg   bg-card", className)}>
      <div className="flex items-center gap-2   px-3 py-2">
        {kindIcon[kind]}
        <span className="truncate font-mono text-xs font-medium text-foreground">{path}</span>
        <span className="ml-1 flex items-center gap-1.5 font-mono text-xs">
          {add > 0 && <span className="text-success-600">+{add}</span>}
          {del > 0 && <span className="text-danger-600">-{del}</span>}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {status === "success" && (
            <span className="inline-flex items-center gap-1 text-xs text-success-600">
              <Check className="size-3.5" /> Applied
            </span>
          )}
          {status === "error" && (
            <span className="inline-flex items-center gap-1 text-xs text-danger-600">
              <X className="size-3.5" /> Failed
            </span>
          )}
          {showActions && (
            <>
              <button
                type="button"
                onClick={onReject}
                className="inline-flex h-7 items-center gap-1 rounded-md   px-2 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                <X className="size-3.5" /> Reject
              </button>
              <button
                type="button"
                onClick={onAccept}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                <Check className="size-3.5" /> Accept
              </button>
            </>
          )}
        </div>
      </div>
      {children ??
        (kind === "create" ? (
          <DiffViewer oldValue="" newValue={newValue} mode={diffMode} maxHeight={maxHeight} className="rounded-none " />
        ) : kind === "delete" ? (
          <DiffViewer oldValue={oldValue} newValue="" mode={diffMode} maxHeight={maxHeight} className="rounded-none " />
        ) : (
          <DiffViewer oldValue={oldValue} newValue={newValue} mode={diffMode} maxHeight={maxHeight} className="rounded-none " />
        ))}
    </div>
  );
}

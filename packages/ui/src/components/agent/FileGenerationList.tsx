import { type ReactNode } from "react";
import { FilePlus2, FileDiff, FileX2, Loader2, Check } from "lucide-react";
import { cn } from "../../lib/cn";
import type { AgentStatus } from "./types";

export type FileChangeKind = "create" | "edit" | "delete";

export interface GeneratedFile {
  id?: string;
  path: string;
  kind?: FileChangeKind;
  status?: AgentStatus;
  additions?: number;
  deletions?: number;
}

export interface FileGenerationListProps {
  files: GeneratedFile[];
  title?: ReactNode;
  onSelect?: (file: GeneratedFile) => void;
  className?: string;
}

const kindIcon: Record<FileChangeKind, ReactNode> = {
  create: <FilePlus2 className="size-4 text-success-500" />,
  edit: <FileDiff className="size-4 text-primary" />,
  delete: <FileX2 className="size-4 text-danger-500" />,
};

/** Live list of files being created/edited by the agent (bolt / Lovable). */
export function FileGenerationList({ files, title, onSelect, className }: FileGenerationListProps) {
  return (
    <div className={cn("overflow-hidden rounded-lg   bg-card", className)}>
      {title && (
        <div className="  px-3 py-2 text-xs font-medium text-muted-foreground">
          {title}
        </div>
      )}
      <ul className=" ">
        {files.map((file, i) => {
          const status = file.status ?? "success";
          return (
            <li key={file.id ?? i}>
              <button
                type="button"
                onClick={() => onSelect?.(file)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
              >
                <span className="shrink-0">{kindIcon[file.kind ?? "edit"]}</span>
                <span className="truncate font-mono text-xs text-foreground">{file.path}</span>
                <span className="ml-auto flex items-center gap-2 font-mono text-xs">
                  {file.additions ? <span className="text-success-600">+{file.additions}</span> : null}
                  {file.deletions ? <span className="text-danger-600">-{file.deletions}</span> : null}
                  {status === "running" ? (
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                  ) : status === "success" ? (
                    <Check className="size-3.5 text-success-500" />
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

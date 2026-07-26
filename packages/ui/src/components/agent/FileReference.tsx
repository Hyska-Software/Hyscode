import { type ReactNode } from "react";
import { AtSign, FileCode, X } from "lucide-react";
import { cn } from "../../lib/cn";

export interface FileReferenceProps {
  /** File path, e.g. "src/App.tsx". */
  path: string;
  /** Optional line number (or start line). */
  line?: number;
  endLine?: number;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}

/** Clickable `file:line` reference chip used in agent output. */
export function FileReference({ path, line, endLine, icon, onClick, className }: FileReferenceProps) {
  const name = path.split("/").pop() ?? path;
  const loc = line != null ? `:${line}${endLine != null ? `-${endLine}` : ""}` : "";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${path}${loc}`}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md   bg-muted/60 px-1.5 py-0.5 align-middle font-mono text-xs text-foreground transition-colors hover:bg-muted [&_svg]:size-3.5",
        className,
      )}
    >
      {icon ?? <FileCode className="text-muted-foreground" />}
      <span className="truncate">{name}</span>
      {loc && <span className="text-muted-foreground">{loc}</span>}
    </button>
  );
}

export interface ContextPillProps {
  label: ReactNode;
  icon?: ReactNode;
  onRemove?: () => void;
  className?: string;
}

/** `@mention` context chip shown attached to a prompt (files, symbols, docs). */
export function ContextPill({ label, icon, onRemove, className }: ContextPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md   bg-card px-1.5 py-0.5 text-xs text-foreground [&_svg]:size-3",
        className,
      )}
    >
      {icon ?? <AtSign className="text-muted-foreground" />}
      <span className="max-w-[10rem] truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove context"
          className="text-muted-foreground transition hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

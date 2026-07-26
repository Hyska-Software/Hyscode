import { type ReactNode } from "react";
import { File as FileIcon, FileText, Image as ImageIcon, X } from "lucide-react";
import { cn } from "../../lib/cn";

export interface AttachmentData {
  id: string;
  name: string;
  /** e.g. "image/png", "application/pdf". */
  type?: string;
  size?: number;
  /** Preview URL for images. */
  url?: string;
}

export interface AttachmentChipProps {
  attachment: AttachmentData;
  onRemove?: (id: string) => void;
  className?: string;
}

function formatSize(bytes?: number): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function iconFor(type?: string): ReactNode {
  if (type?.startsWith("image/")) return <ImageIcon />;
  if (type?.includes("pdf") || type?.startsWith("text/")) return <FileText />;
  return <FileIcon />;
}

/** File attachment chip for chat inputs and messages. */
export function AttachmentChip({ attachment, onRemove, className }: AttachmentChipProps) {
  const size = formatSize(attachment.size);
  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg   bg-card p-2 pr-3",
        className,
      )}
    >
      {attachment.url && attachment.type?.startsWith("image/") ? (
        <img src={attachment.url} alt={attachment.name} className="size-9 rounded-md object-cover" />
      ) : (
        <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
          {iconFor(attachment.type)}
        </span>
      )}
      <div className="min-w-0">
        <p className="max-w-[10rem] truncate text-sm font-medium text-foreground">{attachment.name}</p>
        {size && <p className="text-xs text-muted-foreground">{size}</p>}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          aria-label={`Remove ${attachment.name}`}
          className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full   bg-card text-muted-foreground opacity-0 shadow-sm transition hover:text-foreground group-hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

export interface AttachmentListProps {
  attachments: AttachmentData[];
  onRemove?: (id: string) => void;
  className?: string;
}

export function AttachmentList({ attachments, onRemove, className }: AttachmentListProps) {
  if (attachments.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((a) => (
        <AttachmentChip key={a.id} attachment={a} onRemove={onRemove} />
      ))}
    </div>
  );
}

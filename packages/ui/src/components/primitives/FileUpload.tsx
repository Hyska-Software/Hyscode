import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "../../lib/cn";

export interface FileUploadProps {
  onFiles?: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  icon?: ReactNode;
  label?: ReactNode;
  description?: ReactNode;
}

/** Drag-and-drop file dropzone with click-to-browse. */
export function FileUpload({
  onFiles,
  accept,
  multiple = true,
  disabled,
  className,
  icon,
  label = "Click to upload or drag and drop",
  description,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    onFiles?.(Array.from(list));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-lg   px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        dragging ? " bg-primary/5" : " hover: dark:hover:",
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
        {icon ?? <UploadCloud />}
      </span>
      <span className="text-sm font-medium text-foreground">{label}</span>
      {description && <span className="text-xs text-muted-foreground">{description}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
        className="sr-only"
      />
    </button>
  );
}

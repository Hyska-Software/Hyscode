import { type ReactNode } from "react";
import { Loader2, Play, RotateCw, Square } from "lucide-react";
import { cn } from "../../lib/cn";

export type RunState = "idle" | "running" | "stopped";

export interface RunControlsProps {
  state?: RunState;
  onRun?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  /** Status text shown next to the buttons (e.g. "Port 3000"). */
  status?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

/** Run / stop / restart controls for a dev server or task (Replit / bolt). */
export function RunControls({
  state = "idle",
  onRun,
  onStop,
  onRestart,
  status,
  size = "md",
  className,
}: RunControlsProps) {
  const running = state === "running";
  const h = size === "sm" ? "h-7 text-xs" : "h-8 text-sm";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {running ? (
        <button
          type="button"
          onClick={onStop}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 font-medium text-destructive-foreground transition hover:bg-danger-600 [&_svg]:size-4",
            h,
          )}
        >
          <Square className="fill-current" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={onRun}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground transition hover:bg-primary/90 [&_svg]:size-4",
            h,
          )}
        >
          <Play className="fill-current" />
          Run
        </button>
      )}
      <button
        type="button"
        onClick={onRestart}
        aria-label="Restart"
        className={cn(
          "inline-flex items-center justify-center rounded-md   px-2 text-muted-foreground transition hover:bg-muted hover:text-foreground [&_svg]:size-4",
          h,
        )}
      >
        <RotateCw />
      </button>
      {status != null && (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {running && <Loader2 className="size-3.5 animate-spin text-primary" />}
          {status}
        </span>
      )}
    </div>
  );
}

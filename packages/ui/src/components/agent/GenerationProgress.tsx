import { type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { StatusIcon } from "./StatusIcon";
import type { AgentStatus } from "./types";

export interface GenerationStep {
  id?: string;
  label: ReactNode;
  status: AgentStatus;
  detail?: ReactNode;
}

export interface GenerationProgressProps {
  steps: GenerationStep[];
  title?: ReactNode;
  /** Show the "n of m" and a progress bar. Default true. */
  showBar?: boolean;
  className?: string;
}

/** "Building your app…" multi-step generation progress (Lovable / v0 / bolt). */
export function GenerationProgress({
  steps,
  title = "Building your app",
  showBar = true,
  className,
}: GenerationProgressProps) {
  const done = steps.filter((s) => s.status === "success").length;
  const running = steps.some((s) => s.status === "running");
  const pct = steps.length ? (done / steps.length) * 100 : 0;

  return (
    <div className={cn("overflow-hidden rounded-xl   bg-card p-4", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className={cn("size-2 rounded-full", running ? "animate-pulse bg-primary" : done === steps.length ? "bg-success-500" : "bg-muted-foreground")} />
          {title}
        </div>
        <span className="text-xs text-muted-foreground">
          {done}/{steps.length}
        </span>
      </div>

      {showBar && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <ol className="mt-3 space-y-2">
        {steps.map((step, i) => (
          <li key={step.id ?? i} className="flex items-start gap-2.5 text-sm">
            <span className="mt-0.5 shrink-0">
              <StatusIcon status={step.status} />
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  step.status === "success" && "text-muted-foreground",
                  step.status === "running" && "font-medium text-foreground",
                  step.status === "pending" && "text-muted-foreground",
                  step.status === "error" && "text-danger-600",
                  step.status === "skipped" && "text-muted-foreground line-through",
                )}
              >
                {step.label}
              </p>
              {step.detail && <p className="text-xs text-muted-foreground">{step.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

import { cn } from "../../lib/cn";

export interface ContextMeterProps {
  /** Tokens used. */
  used: number;
  /** Total context window size in tokens. */
  total: number;
  /** Tokens until auto-compaction triggers (if enabled). */
  compactAt?: number;
  /** Show auto-compact label. */
  autoCompact?: boolean;
  size?: "sm" | "md";
  className?: string;
}

function formatTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;
}

/** Context-window usage bar (Codex / Claude Code) with auto-compact threshold. */
export function ContextMeter({
  used,
  total,
  compactAt,
  autoCompact = false,
  size = "sm",
  className,
}: ContextMeterProps) {
  const pct = Math.max(0, Math.min(100, (used / total) * 100));
  const compactPct = compactAt ? Math.min(100, (compactAt / total) * 100) : null;
  const tone =
    pct >= 85 ? "bg-danger-600" : pct >= 65 ? "bg-warning-500" : "bg-primary";
  const label = `${formatTokens(used)} / ${formatTokens(total)} tokens`;

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>Context</span>
        <span className="font-medium tabular-nums text-foreground">{label}</span>
      </div>
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-muted",
          size === "sm" ? "h-1.5" : "h-2",
        )}
      >
        <div
          className={cn("h-full rounded-full transition-all", tone)}
          style={{ width: `${pct}%` }}
        />
        {compactPct != null && (
          <span
            className="absolute top-0 h-full w-px bg-warning-600"
            style={{ left: `${compactPct}%` }}
            title="Auto-compact threshold"
          />
        )}
      </div>
      {autoCompact && compactAt != null && (
        <p className="mt-1 text-[11px] text-warning-600">
          Auto-compacts at {formatTokens(compactAt)} tokens
        </p>
      )}
    </div>
  );
}

import { ArrowDown, ArrowUp, Coins } from "lucide-react";
import { cn } from "../../lib/cn";

export interface TokenUsageProps {
  input?: number;
  output?: number;
  /** Total tokens; computed from input+output when omitted. */
  total?: number;
  /** Optional monetary cost, already formatted or a number in USD. */
  cost?: number | string;
  /** Context window size to render a usage bar (e.g. 200000). */
  contextWindow?: number;
  variant?: "inline" | "detailed";
  className?: string;
}

function fmt(n?: number): string {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Token consumption / cost display for an agent turn. */
export function TokenUsage({
  input = 0,
  output = 0,
  total,
  cost,
  contextWindow,
  variant = "inline",
  className,
}: TokenUsageProps) {
  const sum = total ?? input + output;
  const costLabel = typeof cost === "number" ? `$${cost.toFixed(4)}` : cost;

  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <span className="inline-flex items-center gap-0.5">
          <ArrowUp className="size-3" />
          {fmt(input)}
        </span>
        <span className="inline-flex items-center gap-0.5">
          <ArrowDown className="size-3" />
          {fmt(output)}
        </span>
        {costLabel && (
          <span className="inline-flex items-center gap-0.5">
            <Coins className="size-3" />
            {costLabel}
          </span>
        )}
      </span>
    );
  }

  const pct = contextWindow ? Math.min(100, (sum / contextWindow) * 100) : null;

  return (
    <div className={cn("space-y-1.5 text-xs", className)}>
      <div className="flex items-center justify-between text-muted-foreground">
        <span>Tokens</span>
        <span className="tabular-nums text-foreground">
          {fmt(sum)}
          {contextWindow ? ` / ${fmt(contextWindow)}` : ""}
        </span>
      </div>
      {pct != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", pct > 90 ? "bg-danger-500" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="inline-flex items-center gap-0.5">
          <ArrowUp className="size-3" /> {fmt(input)} in
        </span>
        <span className="inline-flex items-center gap-0.5">
          <ArrowDown className="size-3" /> {fmt(output)} out
        </span>
        {costLabel && (
          <span className="inline-flex items-center gap-0.5">
            <Coins className="size-3" /> {costLabel}
          </span>
        )}
      </div>
    </div>
  );
}

import { type ReactNode } from "react";
import { CheckCircle2, ExternalLink, Loader2, Rocket, XCircle } from "lucide-react";
import { cn } from "../../lib/cn";

export type DeployStatus = "idle" | "building" | "deploying" | "live" | "error";

export interface DeployBarProps {
  status?: DeployStatus;
  /** Live URL, shown when deployed. */
  url?: string;
  /** Environment/branch label, e.g. "production". */
  environment?: ReactNode;
  onDeploy?: () => void;
  lastDeployed?: ReactNode;
  className?: string;
}

const statusMap: Record<DeployStatus, { label: string; icon: ReactNode; tone: string }> = {
  idle: { label: "Not deployed", icon: <Rocket className="size-4" />, tone: "text-muted-foreground" },
  building: { label: "Building…", icon: <Loader2 className="size-4 animate-spin" />, tone: "text-primary" },
  deploying: { label: "Deploying…", icon: <Loader2 className="size-4 animate-spin" />, tone: "text-primary" },
  live: { label: "Live", icon: <CheckCircle2 className="size-4" />, tone: "text-success-600" },
  error: { label: "Deploy failed", icon: <XCircle className="size-4" />, tone: "text-danger-600" },
};

/** Publish / deploy status bar with live URL (Replit / Lovable / v0). */
export function DeployBar({
  status = "idle",
  url,
  environment,
  onDeploy,
  lastDeployed,
  className,
}: DeployBarProps) {
  const s = statusMap[status];
  const busy = status === "building" || status === "deploying";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg   bg-card px-3 py-2",
        className,
      )}
    >
      <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", s.tone)}>
        {s.icon}
        {s.label}
      </span>
      {environment && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {environment}
        </span>
      )}
      {status === "live" && url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 text-xs text-primary hover:underline"
        >
          <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>
      )}
      <div className="ml-auto flex items-center gap-3">
        {lastDeployed && <span className="text-xs text-muted-foreground">{lastDeployed}</span>}
        <button
          type="button"
          onClick={onDeploy}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
          {status === "live" ? "Redeploy" : "Deploy"}
        </button>
      </div>
    </div>
  );
}

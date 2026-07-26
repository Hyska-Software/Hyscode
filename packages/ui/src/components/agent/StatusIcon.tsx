import { Check, CircleDashed, Loader2, X, MinusCircle } from "lucide-react";
import { cn } from "../../lib/cn";
import type { AgentStatus } from "./types";

export interface StatusIconProps {
  status: AgentStatus;
  className?: string;
}

/** Small status glyph shared by agent components. */
export function StatusIcon({ status, className }: StatusIconProps) {
  switch (status) {
    case "running":
      return <Loader2 className={cn("size-4 animate-spin text-primary", className)} />;
    case "success":
      return <Check className={cn("size-4 text-success-500", className)} />;
    case "error":
      return <X className={cn("size-4 text-danger-500", className)} />;
    case "skipped":
      return <MinusCircle className={cn("size-4 text-muted-foreground", className)} />;
    case "pending":
    default:
      return <CircleDashed className={cn("size-4 text-muted-foreground", className)} />;
  }
}

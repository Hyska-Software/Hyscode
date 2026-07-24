import { cn } from "../../lib/cn";

export type PermissionMode = "default" | "acceptEdits" | "bypass" | "plan";

export interface PermissionModeOption {
  value: PermissionMode;
  label: React.ReactNode;
  description?: string;
}

export interface PermissionModeSelectorProps {
  value: PermissionMode;
  onChange?: (mode: PermissionMode) => void;
  modes?: PermissionModeOption[];
  size?: "sm" | "md";
  className?: string;
}

const DEFAULT_MODES: PermissionModeOption[] = [
  { value: "default", label: "Default", description: "Ask before edits" },
  { value: "acceptEdits", label: "Accept edits", description: "Auto-apply edits" },
  { value: "bypass", label: "Bypass", description: "Auto-run commands" },
  { value: "plan", label: "Plan", description: "Plan only" },
];

const DOT: Record<PermissionMode, string> = {
  default: "bg-neutral-400",
  acceptEdits: "bg-success-600",
  bypass: "bg-primary",
  plan: "bg-info-600",
};

/** Claude Code-style permission mode cycle (Default / AcceptEdits / Bypass / Plan). */
export function PermissionModeSelector({
  value,
  onChange,
  modes = DEFAULT_MODES,
  size = "sm",
  className,
}: PermissionModeSelectorProps) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "inline-flex items-center rounded-full   bg-card p-0.5",
        className,
      )}
    >
      {modes.map((m) => {
        const active = m.value === value;
        return (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={m.description}
            onClick={() => onChange?.(m.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full font-medium transition",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", active ? "bg-current" : DOT[m.value])} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

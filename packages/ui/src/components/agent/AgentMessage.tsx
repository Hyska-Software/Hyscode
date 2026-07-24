import { type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";

export interface TurnFooterProps {
  model?: ReactNode;
  tokens?: ReactNode;
  duration?: ReactNode;
  cost?: ReactNode;
  extra?: ReactNode;
  className?: string;
}

/** Metadata row shown under an agent turn: model • tokens • duration • cost. */
export function TurnFooter({ model, tokens, duration, cost, extra, className }: TurnFooterProps) {
  const parts = [model, duration, tokens, cost].filter((p) => p != null);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-neutral-400">·</span>}
          {p}
        </span>
      ))}
      {extra}
    </div>
  );
}

export interface AgentMessageProps {
  children: ReactNode;
  /** Model / agent name shown in the header. */
  model?: ReactNode;
  avatar?: ReactNode;
  /** Metadata row rendered at the bottom (e.g. <TurnFooter/>). */
  footer?: ReactNode;
  /** Hover actions (copy, retry…). */
  actions?: ReactNode;
  className?: string;
}

/** Container for an assistant/agent turn — groups text, tool calls and thinking
 *  under a single model-labelled block (Codex / Claude Code turn). */
export function AgentMessage({ children, model, avatar, footer, actions, className }: AgentMessageProps) {
  return (
    <div className={cn("group flex gap-3", className)}>
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-4">
        {avatar ?? <Sparkles />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {(model || actions) && (
          <div className="flex items-center gap-2">
            {model && <span className="text-sm font-semibold text-foreground">{model}</span>}
            {actions && (
              <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
                {actions}
              </span>
            )}
          </div>
        )}
        <div className="space-y-2 text-sm leading-relaxed text-foreground">{children}</div>
        {footer && <div className="pt-1">{footer}</div>}
      </div>
    </div>
  );
}

import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface QueuedMessagesProps {
  /** Pending user messages waiting behind the running agent. */
  messages: ReactNode[];
  className?: string;
}

/** Stack of user messages queued while the agent is busy (Codex / Claude Code). */
export function QueuedMessages({ messages, className }: QueuedMessagesProps) {
  if (messages.length === 0) return null;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="text-xs text-muted-foreground">
        {messages.length} queued {messages.length === 1 ? "message" : "messages"}
      </div>
      {messages.map((m, i) => (
        <div
          key={i}
          className="rounded-lg    bg-muted/40 px-3 py-2 text-sm text-foreground"
        >
          {m}
        </div>
      ))}
    </div>
  );
}

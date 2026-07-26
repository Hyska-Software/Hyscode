import { type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Avatar } from "../primitives/Avatar";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessageProps {
  role: ChatRole;
  children: ReactNode;
  /** Avatar image src (assistant/user). */
  avatarSrc?: string;
  avatarFallback?: string;
  name?: ReactNode;
  timestamp?: ReactNode;
  /** Actions shown on hover (copy, regenerate, etc.). */
  actions?: ReactNode;
  className?: string;
}

/** ChatGPT-style message row. */
export function ChatMessage({
  role,
  children,
  avatarSrc,
  avatarFallback,
  name,
  timestamp,
  actions,
  className,
}: ChatMessageProps) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "group flex gap-3 px-4 py-5",
        role === "assistant" && "bg-muted/40",
        className,
      )}
    >
      <Avatar
        size="sm"
        src={avatarSrc}
        fallback={avatarFallback ?? (isUser ? "You" : "AI")}
        className={cn(!avatarSrc && (isUser ? "bg-neutral-700 text-white" : "bg-primary text-primary-foreground"))}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {name ?? (isUser ? "You" : "Assistant")}
          </span>
          {timestamp && <span className="text-xs text-muted-foreground">{timestamp}</span>}
        </div>
        <div className="prose-sm max-w-none text-sm leading-relaxed text-foreground">
          {children}
        </div>
        {actions && (
          <div className="flex items-center gap-1 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

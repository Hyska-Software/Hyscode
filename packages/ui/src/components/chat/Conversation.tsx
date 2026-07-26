import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "../../lib/cn";

export interface ConversationProps {
  children: ReactNode;
  /** Auto-scroll to bottom when children change (e.g. new tokens). */
  autoScroll?: boolean;
  className?: string;
}

/** Scrollable message container with auto-scroll and a jump-to-bottom button. */
export function Conversation({ children, autoScroll = true, className }: ConversationProps) {
  const ref = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    if (autoScroll && atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  });

  const scrollToBottom = () =>
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="h-full overflow-y-auto"
      >
        {children}
        <div ref={bottomRef} />
      </div>
      <button
        type="button"
        onClick={scrollToBottom}
        aria-label="Scroll to bottom"
        className="absolute bottom-4 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full   bg-card text-muted-foreground shadow-md transition hover:text-foreground"
      >
        <ArrowDown className="size-4" />
      </button>
    </div>
  );
}

import { cn } from "../../lib/cn";

export interface TypingIndicatorProps {
  label?: string;
  className?: string;
}

/** Animated three-dot "assistant is typing" indicator. */
export function TypingIndicator({ label = "Assistant is typing", className }: TypingIndicatorProps) {
  return (
    <div role="status" aria-label={label} className={cn("inline-flex items-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "1s" }}
        />
      ))}
    </div>
  );
}

import { type ReactNode } from "react";
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp, Volume2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { useClipboard } from "../../lib/hooks/useClipboard";
import { Tooltip } from "../primitives/Tooltip";

export interface MessageActionsProps {
  /** Text copied by the copy button. */
  copyText?: string;
  onRegenerate?: () => void;
  onLike?: () => void;
  onDislike?: () => void;
  onSpeak?: () => void;
  feedback?: "like" | "dislike" | null;
  extra?: ReactNode;
  className?: string;
}

function ActionButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4",
          active && "text-primary",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** Row of hover actions for a chat message (copy, regenerate, feedback). */
export function MessageActions({
  copyText,
  onRegenerate,
  onLike,
  onDislike,
  onSpeak,
  feedback,
  extra,
  className,
}: MessageActionsProps) {
  const { copied, copy } = useClipboard();
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {copyText != null && (
        <ActionButton label={copied ? "Copied" : "Copy"} onClick={() => copy(copyText)}>
          {copied ? <Check /> : <Copy />}
        </ActionButton>
      )}
      {onRegenerate && (
        <ActionButton label="Regenerate" onClick={onRegenerate}>
          <RefreshCw />
        </ActionButton>
      )}
      {onSpeak && (
        <ActionButton label="Read aloud" onClick={onSpeak}>
          <Volume2 />
        </ActionButton>
      )}
      {onLike && (
        <ActionButton label="Good response" active={feedback === "like"} onClick={onLike}>
          <ThumbsUp />
        </ActionButton>
      )}
      {onDislike && (
        <ActionButton label="Bad response" active={feedback === "dislike"} onClick={onDislike}>
          <ThumbsDown />
        </ActionButton>
      )}
      {extra}
    </div>
  );
}

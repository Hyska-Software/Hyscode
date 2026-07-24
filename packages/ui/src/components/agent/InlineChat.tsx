import { useState, type ReactNode } from "react";
import { CornerDownLeft, Sparkles, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useControllableState } from "../../lib/hooks/useControllableState";

export interface InlineChatProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  onSubmit?: (v: string) => void;
  onClose?: () => void;
  placeholder?: string;
  loading?: boolean;
  /** Assistant response / preview shown under the input. */
  response?: ReactNode;
  /** Shown when a response exists: accept/discard the change. */
  onAccept?: () => void;
  onDiscard?: () => void;
  /** Context chips (e.g. selection range) shown in the header. */
  context?: ReactNode;
  className?: string;
}

/** Compact in-editor inline chat widget (Copilot Cmd+I / Cursor inline edit). */
export function InlineChat({
  value,
  defaultValue = "",
  onValueChange,
  onSubmit,
  onClose,
  placeholder = "Edit or generate code…",
  loading,
  response,
  onAccept,
  onDiscard,
  context,
  className,
}: InlineChatProps) {
  const [text, setText] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const [focused, setFocused] = useState(false);

  const submit = () => {
    const v = text.trim();
    if (v) onSubmit?.(v);
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg  bg-card shadow-lg transition-colors",
        focused ? "" : "",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-2.5 pt-2">
        <Sparkles className="size-4 shrink-0 text-primary" />
        <div className="flex flex-1 flex-wrap items-center gap-1">{context}</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="flex items-end gap-2 px-2.5 py-2">
        <textarea
          rows={1}
          value={text}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-32 flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={submit}
          disabled={loading || !text.trim()}
          aria-label="Submit"
          className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
        >
          <CornerDownLeft className="size-4" />
        </button>
      </div>
      {response != null && (
        <div className=" ">
          <div className="max-h-64 overflow-auto p-2.5 text-sm">{response}</div>
          {(onAccept || onDiscard) && (
            <div className="flex items-center justify-end gap-2   px-2.5 py-2">
              <button
                type="button"
                onClick={onDiscard}
                className="inline-flex h-7 items-center rounded-md   px-2.5 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={onAccept}
                className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Accept
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

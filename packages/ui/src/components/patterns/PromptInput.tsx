import {
  forwardRef,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "../../lib/cn";
import { useControllableState } from "../../lib/hooks/useControllableState";

export interface PromptInputProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When true, shows a stop button instead of send. */
  loading?: boolean;
  onStop?: () => void;
  /** Toolbar rendered on the left (e.g. attach, model select). */
  toolbar?: ReactNode;
  /** Content rendered above the textarea, e.g. an <AttachmentList />. */
  attachments?: ReactNode;
  maxRows?: number;
  className?: string;
}

/** ChatGPT-style auto-growing prompt input with send/stop controls. */
export const PromptInput = forwardRef<HTMLTextAreaElement, PromptInputProps>(
  (
    {
      value,
      defaultValue = "",
      onValueChange,
      onSubmit,
      placeholder = "Send a message…",
      disabled,
      loading,
      onStop,
      toolbar,
      attachments,
      maxRows = 8,
      className,
    },
    ref,
  ) => {
    const [text, setText] = useControllableState({
      value,
      defaultValue,
      onChange: onValueChange,
    });
    const taRef = useRef<HTMLTextAreaElement | null>(null);

    const autosize = (el: HTMLTextAreaElement) => {
      el.style.height = "auto";
      const lineHeight = 24;
      el.style.height = `${Math.min(el.scrollHeight, maxRows * lineHeight + 16)}px`;
    };

    const submit = () => {
      const v = text.trim();
      if (!v || disabled || loading) return;
      onSubmit?.(v);
      setText("");
      if (taRef.current) taRef.current.style.height = "auto";
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    };

    return (
      <div
        className={cn(
          "flex flex-col gap-2 rounded-2xl   bg-card p-2 shadow-sm transition-colors focus-within: dark:focus-within:",
          className,
        )}
      >
        {attachments && <div className="px-1 pt-1">{attachments}</div>}
        <textarea
          ref={(node) => {
            taRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            autosize(e.target);
          }}
          onKeyDown={onKeyDown}
          className="max-h-[40vh] w-full resize-none bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">{toolbar}</div>
          {loading ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="flex size-8 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !text.trim()}
              aria-label="Send message"
              className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    );
  },
);
PromptInput.displayName = "PromptInput";

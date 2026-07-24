import { forwardRef, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { Highlight, type Language } from "prism-react-renderer";
import { cn } from "../../lib/cn";
import { useControllableState } from "../../lib/hooks/useControllableState";
import { auroraPrismTheme } from "./prismTheme";

export interface CodeEditorProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  language?: Language | string;
  placeholder?: string;
  readOnly?: boolean;
  showLineNumbers?: boolean;
  /** Spaces inserted on Tab. Default 2. */
  tabSize?: number;
  className?: string;
  minHeight?: string;
  "aria-label"?: string;
}

/** Lightweight controlled code editor: a transparent textarea over a
 *  syntax-highlighted layer. No heavy editor dependency required. */
export const CodeEditor = forwardRef<HTMLTextAreaElement, CodeEditorProps>(
  (
    {
      value,
      defaultValue = "",
      onChange,
      language = "tsx",
      placeholder,
      readOnly,
      showLineNumbers = true,
      tabSize = 2,
      className,
      minHeight = "12rem",
      "aria-label": ariaLabel = "Code editor",
    },
    ref,
  ) => {
    const [code, setCode] = useControllableState({ value, defaultValue, onChange });
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => setCode(e.target.value);

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.currentTarget;
        const { selectionStart, selectionEnd } = ta;
        const insert = " ".repeat(tabSize);
        const next = code.slice(0, selectionStart) + insert + code.slice(selectionEnd);
        setCode(next);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = selectionStart + insert.length;
        });
      }
    };

    const lineCount = code.split("\n").length;

    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-lg   bg-[var(--terminal-bg)] font-mono text-sm leading-relaxed",
          className,
        )}
      >
        <div className="relative flex" style={{ minHeight }}>
          {showLineNumbers && (
            <div
              aria-hidden
              className="select-none   px-3 py-4 text-right text-neutral-600"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <div className="relative flex-1">
            <Highlight theme={auroraPrismTheme} code={code || " "} language={language as Language}>
              {({ tokens, getLineProps, getTokenProps }) => (
                <pre
                  aria-hidden
                  className="pointer-events-none m-0 overflow-hidden whitespace-pre-wrap break-words p-4"
                  style={{ backgroundColor: "transparent" }}
                >
                  {tokens.map((line, i) => (
                    <div key={i} {...getLineProps({ line })}>
                      {line.map((token, key) => (
                        <span key={key} {...getTokenProps({ token })} />
                      ))}
                    </div>
                  ))}
                </pre>
              )}
            </Highlight>
            <textarea
              ref={(node) => {
                innerRef.current = node;
                if (typeof ref === "function") ref(node);
                else if (ref) ref.current = node;
              }}
              value={code}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              readOnly={readOnly}
              placeholder={placeholder}
              spellCheck={false}
              aria-label={ariaLabel}
              className="absolute inset-0 size-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent p-4 text-transparent caret-white outline-none placeholder:text-neutral-600"
            />
          </div>
        </div>
      </div>
    );
  },
);
CodeEditor.displayName = "CodeEditor";

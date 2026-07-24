import { forwardRef, useMemo, type ReactNode } from "react";
import { Highlight, type Language } from "prism-react-renderer";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/cn";
import { useClipboard } from "../../lib/hooks/useClipboard";
import { auroraPrismTheme } from "./prismTheme";

export interface CodeBlockProps {
  /** Source code to render. */
  code: string;
  language?: Language | string;
  /** Filename/title shown in the header. */
  title?: string;
  showLineNumbers?: boolean;
  /** 1-based line numbers to highlight. */
  highlightLines?: number[];
  showCopy?: boolean;
  /** Max height before the block scrolls (e.g. "24rem"). */
  maxHeight?: string;
  className?: string;
  headerActions?: ReactNode;
}

/** Read-only, syntax-highlighted code block with a copy button. */
export const CodeBlock = forwardRef<HTMLDivElement, CodeBlockProps>(
  (
    {
      code,
      language = "tsx",
      title,
      showLineNumbers = true,
      highlightLines = [],
      showCopy = true,
      maxHeight,
      className,
      headerActions,
    },
    ref,
  ) => {
    const { copied, copy } = useClipboard();
    const highlightSet = useMemo(() => new Set(highlightLines), [highlightLines]);
    const trimmed = code.replace(/\n$/, "");

    return (
      <div
        ref={ref}
        className={cn(
          "overflow-hidden rounded-lg   bg-[var(--terminal-bg)] text-sm",
          className,
        )}
      >
        {(title || showCopy || headerActions) && (
          <div className="flex items-center justify-between   px-4 py-2">
            <span className="font-mono text-xs text-neutral-400">{title}</span>
            <div className="flex items-center gap-1">
              {headerActions}
              {showCopy && (
                <button
                  onClick={() => copy(trimmed)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100"
                  aria-label="Copy code"
                >
                  {copied ? (
                    <>
                      <Check className="size-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" /> Copy
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
        <div className="overflow-auto" style={{ maxHeight }}>
          <Highlight theme={auroraPrismTheme} code={trimmed} language={language as Language}>
            {({ className: cls, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={cn(cls, "min-w-full p-4 font-mono leading-relaxed")}
                style={{ ...style, backgroundColor: "transparent" }}
              >
                {tokens.map((line, i) => {
                  const lineProps = getLineProps({ line });
                  const isHl = highlightSet.has(i + 1);
                  return (
                    <div
                      key={i}
                      {...lineProps}
                      className={cn(
                        lineProps.className,
                        "table-row",
                        isHl && "bg-primary/10",
                      )}
                    >
                      {showLineNumbers && (
                        <span className="table-cell select-none pr-4 text-right text-neutral-600">
                          {i + 1}
                        </span>
                      )}
                      <span className="table-cell">
                        {line.map((token, key) => (
                          <span key={key} {...getTokenProps({ token })} />
                        ))}
                      </span>
                    </div>
                  );
                })}
              </pre>
            )}
          </Highlight>
        </div>
      </div>
    );
  },
);
CodeBlock.displayName = "CodeBlock";

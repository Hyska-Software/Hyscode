import { memo, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Copy, Check, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MermaidBlock } from '@/components/ui/mermaid-block';

// ─── Code Block with Copy Button ───────────────────────────────────────────────

function extractTextContent(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextContent).join('');
  if (typeof node === 'object' && node !== null && 'props' in (node as object)) {
    return extractTextContent(((node as React.ReactElement).props as { children?: React.ReactNode }).children);
  }
  return '';
}

export function CodeBlock({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const handleCopy = useCallback(() => {
    const text = codeRef.current?.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const isInline = !className;
  if (isInline) {
    return (
      <code className="rounded-[3px] bg-accent/8 px-1.5 py-[1px] text-[11.5px] font-mono text-accent select-text cursor-text" {...props}>
        {children}
      </code>
    );
  }

  const rawLang = className?.replace('hljs language-', '').replace('language-', '') ?? '';
  const [lang, filePath] = rawLang.split(/:(.+)/);

  // Render Mermaid diagrams inline
  if (lang === 'mermaid') {
    const code = extractTextContent(children).trim();
    return <MermaidBlock code={code} />;
  }

  // Extract a status line from the beginning of the code
  let statusBadge: string | null = null;
  let renderedChildren = children;
  if (typeof children === 'string' && children.trimStart().startsWith('Edit applied successfully.')) {
    statusBadge = 'Edit applied successfully.';
    renderedChildren = children.trimStart().slice('Edit applied successfully.'.length).replace(/^\n/, '');
  }

  return (
    <div className="group/code relative my-2.5 overflow-hidden rounded-lg border border-border/30 bg-[var(--color-surface)] shadow-sm shadow-black/10">
      {/* Header bar */}
      <div className="flex h-8 items-center justify-between border-b border-border/20 bg-[var(--color-surface-raised)]/80 px-3">
        <div className="flex items-center gap-1.5 min-w-0">
          {filePath ? (
            <>
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground/50" />
              <span className="truncate text-[10px] font-mono text-muted-foreground/70">{filePath}</span>
            </>
          ) : (
            <>
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/15" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/15" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/15" />
              </div>
              <span className="ml-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">{lang || 'code'}</span>
            </>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-all hover:bg-white/5 hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Status badge */}
      {statusBadge && (
        <div className="flex items-center gap-1.5 border-b border-border/10 bg-[var(--color-success)]/[0.08] px-3 py-1.5">
          <Check className="h-3 w-3 text-[var(--color-success)]" />
          <span className="text-[10px] font-medium text-[var(--color-success)]">{statusBadge}</span>
        </div>
      )}

      <pre className="overflow-x-auto p-3.5 text-[11.5px] leading-[1.7] select-text cursor-text">
        <code ref={codeRef} className={className} {...props}>
          {renderedChildren}
        </code>
      </pre>
    </div>
  );
}

// ─── Markdown Component Map ────────────────────────────────────────────────────

export const MARKDOWN_COMPONENTS = {
  code: CodeBlock as any,
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,

  // Paragraphs & text
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-1.5 leading-[1.75]">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic text-foreground/75">{children}</em>,
  del: ({ children }: { children?: React.ReactNode }) => <del className="line-through text-muted-foreground/60">{children}</del>,

  // Headings
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-2 mt-5 flex items-center gap-2 text-[15px] font-semibold text-foreground">
      <span className="inline-block h-4 w-[3px] rounded-full bg-accent/70" />{children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-1.5 mt-4 flex items-center gap-2 text-[14px] font-semibold text-foreground">
      <span className="inline-block h-3.5 w-[2px] rounded-full bg-accent/50" />{children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="mb-1 mt-3 text-[13px] font-semibold text-foreground">{children}</h3>,
  h4: ({ children }: { children?: React.ReactNode }) => <h4 className="mb-0.5 mt-2.5 text-[12.5px] font-semibold text-foreground/90">{children}</h4>,
  h5: ({ children }: { children?: React.ReactNode }) => <h5 className="mb-0.5 mt-2 text-[12px] font-medium text-foreground/85">{children}</h5>,
  h6: ({ children }: { children?: React.ReactNode }) => <h6 className="mb-0.5 mt-1.5 text-[11.5px] font-medium text-foreground/75">{children}</h6>,

  // Lists
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-2 ml-4 list-disc space-y-1 marker:text-muted-foreground/40">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="my-2 ml-4 list-decimal space-y-1 marker:text-muted-foreground/40">{children}</ol>,
  li: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isTaskItem = className?.includes('task-list-item');
    return (
      <li className={cn('text-foreground/85 pl-0.5', isTaskItem && 'list-none -ml-4 flex items-center gap-1.5')}>
        {children}
      </li>
    );
  },

  // Task list checkbox
  input: ({ type, checked, disabled, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          disabled={disabled}
          className="h-3.5 w-3.5 shrink-0 cursor-default rounded border border-border/50 accent-accent"
          {...props}
        />
      );
    }
    return <input type={type} {...props} />;
  },

  // Links & media
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} className="text-accent underline decoration-accent/30 underline-offset-2 transition-colors hover:decoration-accent hover:text-accent/90" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) => (
    <img
      src={src}
      alt={alt ?? ''}
      className="my-2 max-w-full rounded-lg border border-border/30 object-contain shadow-sm shadow-black/10"
      loading="lazy"
    />
  ),

  // Block elements
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2.5 rounded-r-md border-l-[3px] border-accent/40 bg-accent/[0.04] py-1 pl-3 pr-2 text-muted-foreground italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-0 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />,

  // Tables
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2.5 overflow-x-auto rounded-lg border border-border/30 shadow-sm shadow-black/5">
      <table className="w-full text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-surface-raised/60">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="border-b border-border/30 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="border-b border-border/15 px-3 py-1.5 text-foreground/80">{children}</td>,

  // Footnotes / superscript / subscript
  sup: ({ children }: { children?: React.ReactNode }) => <sup className="text-[9px] text-accent/80">{children}</sup>,
  sub: ({ children }: { children?: React.ReactNode }) => <sub className="text-[9px] text-muted-foreground/70">{children}</sub>,
} as const;

// ─── Plugin Arrays ─────────────────────────────────────────────────────────────

export const REMARK_PLUGINS = [remarkGfm, remarkMath] as const;
export const REHYPE_PLUGINS = [[rehypeKatex], [rehypeHighlight, { ignoreMissing: true }]] as const;

// ─── Content Cleaner ───────────────────────────────────────────────────────────

export function cleanMarkdownContent(content: string): string {
  return content
    .replace(/\s*\[Image\s+\d+\][^\n]*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── MarkdownContent ───────────────────────────────────────────────────────────

export const MarkdownContent = memo(function MarkdownContent({ content, className }: { content: string; className?: string }) {
  const cleaned = cleanMarkdownContent(content);
  return (
    <div className={cn('agent-markdown select-text cursor-text text-[12.5px] leading-[1.7] text-foreground/90', className)}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS as any}
        rehypePlugins={REHYPE_PLUGINS as any}
        components={MARKDOWN_COMPONENTS as any}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
});

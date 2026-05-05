import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Copy, Check, FileText, ZoomIn, ZoomOut, Maximize2, X, RotateCcw } from 'lucide-react';
import { useSettingsStore } from '@/stores';
import { cn } from '@/lib/utils';

// ─── Mermaid Block ─────────────────────────────────────────────────────────────

type MermaidTheme = 'dark' | 'default' | 'neutral' | 'forest' | 'base';

function getMermaidTheme(themeId: string): MermaidTheme {
  return themeId.includes('light') ? 'default' : 'dark';
}

/**
 * Strip fixed pixel dimensions Mermaid sets on <svg> so the SVG scales as a
 * true vector inside its container. The viewBox is preserved, so aspect-ratio
 * and all paths stay sharp at any size.
 */
function processMermaidSvg(svgStr: string): string {
  return svgStr
    // Remove fixed width / height attributes from the root <svg> element
    .replace(/(<svg\b[^>]*?)\s+width="[^"]*"/i, '$1')
    .replace(/(<svg\b[^>]*?)\s+height="[^"]*"/i, '$1')
    // Remove Mermaid's inline max-width: NNNpx style restriction
    .replace(/max-width\s*:\s*[\d.]+px\s*;?\s*/g, '');
}

function MermaidBlock({ code }: { code: string }) {
  const themeId = useSettingsStore((s) => s.themeId);
  const mermaidTheme = getMermaidTheme(themeId);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prevSvgRef = useRef<string | null>(null);
  const prevThemeRef = useRef<MermaidTheme>(mermaidTheme);

  // In-chat zoom
  const [scale, setScale] = useState(1);
  const wheelContainerRef = useRef<HTMLDivElement>(null);

  // Modal + copy
  const [showModal, setShowModal] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Native non-passive wheel listener so e.preventDefault() actually blocks browser zoom.
  // Depends on displaySvg so it re-runs after the SVG renders (ref is null on first mount).
  const displaySvg = svg ?? prevSvgRef.current;

  useEffect(() => {
    const el = wheelContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      setScale((s) => Math.max(0.25, Math.min(4, parseFloat((s + (e.deltaY > 0 ? -0.1 : 0.1)).toFixed(2)))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!displaySvg]); // re-attach when SVG goes null→string (div mounts)

  useEffect(() => {
    let cancelled = false;

    if (prevThemeRef.current !== mermaidTheme) {
      prevThemeRef.current = mermaidTheme;
      prevSvgRef.current = null;
      setSvg(null);
    }

    async function render() {
      try {
        const mermaid = await import('mermaid').then((m) => m.default);
        mermaid.initialize({ startOnLoad: false, theme: mermaidTheme, securityLevel: 'loose' });
        const id = `mermaid-${crypto.randomUUID().replace(/-/g, '')}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) {
          const processed = processMermaidSvg(rendered);
          prevSvgRef.current = processed;
          setSvg(processed);
          setError(null);
        }
      } catch {
        if (!cancelled && !prevSvgRef.current) {
          setError('Rendering…');
        }
      }
    }

    const timer = setTimeout(render, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, mermaidTheme]);

  const clampScale = (v: number) => Math.max(0.25, Math.min(4, parseFloat(v.toFixed(2))));

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  }, [code]);

  if (!displaySvg && error && error !== 'Rendering…') {
    return (
      <div className="my-2.5 overflow-hidden rounded-lg border border-red-500/20 bg-red-500/[0.06]">
        <div className="flex h-7 items-center gap-1.5 border-b border-red-500/10 px-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-red-400/70">Mermaid error</span>
        </div>
        <p className="px-3 py-2 text-[11px] text-red-300/80">{error}</p>
      </div>
    );
  }

  if (!displaySvg) {
    return (
      <div className="my-2.5 flex h-16 items-center justify-center rounded-lg border border-border/20 bg-surface-raised/20">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/50" />
          Rendering diagram…
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="group/mermaid my-2.5 overflow-hidden rounded-lg border border-border/20 bg-surface-raised/20">
        {/* Toolbar */}
        <div className="flex h-8 items-center justify-between border-b border-border/10 bg-surface-raised/50 px-2.5 opacity-0 transition-opacity group-hover/mermaid:opacity-100">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">diagram</span>
          <div className="flex items-center gap-0.5">
            {/* Copy code */}
            <button
              onClick={copyCode}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              title="Copy source code"
            >
              {codeCopied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
              <span className={codeCopied ? 'text-green-400' : ''}>{codeCopied ? 'Copied!' : 'Copy code'}</span>
            </button>
            <div className="mx-1 h-3.5 w-px bg-border/30" />
            {/* Zoom out */}
            <button
              onClick={() => setScale((s) => clampScale(s - 0.25))}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              title="Zoom out (Ctrl+scroll)"
            >
              <ZoomOut className="h-3 w-3" />
            </button>
            {/* Scale indicator / reset */}
            <button
              onClick={() => setScale(1)}
              className="min-w-[34px] rounded px-1 py-0.5 text-center text-[10px] tabular-nums text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              title="Reset zoom"
            >
              {Math.round(scale * 100)}%
            </button>
            {/* Zoom in */}
            <button
              onClick={() => setScale((s) => clampScale(s + 0.25))}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              title="Zoom in (Ctrl+scroll)"
            >
              <ZoomIn className="h-3 w-3" />
            </button>
            <div className="mx-1 h-3.5 w-px bg-border/30" />
            {/* Fullscreen */}
            <button
              onClick={() => setShowModal(true)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              title="Open in fullscreen"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Diagram — width scales the SVG as a true vector so overflow-x scroll works */}
        <div ref={wheelContainerRef} className="overflow-x-auto">
          <div
            className="agent-mermaid p-4"
            style={{ width: `${scale * 100}%` }}
            dangerouslySetInnerHTML={{ __html: displaySvg }}
          />
        </div>
      </div>

      {showModal && createPortal(
        <MermaidModal svg={displaySvg} code={code} onClose={() => setShowModal(false)} />,
        document.body,
      )}
    </>
  );
}

// ─── Mermaid Fullscreen Modal ──────────────────────────────────────────────────

function MermaidModal({ svg, code, onClose }: { svg: string; code: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [codeCopied, setCodeCopied] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [isDraggingState, setIsDraggingState] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Native non-passive wheel so preventDefault blocks browser/webview zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setScale((s) => Math.max(0.1, Math.min(10, parseFloat((s + (e.deltaY > 0 ? -0.15 : 0.15)).toFixed(2)))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const clampScale = (v: number) => Math.max(0.1, Math.min(10, parseFloat(v.toFixed(2))));

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    setIsDraggingState(true);
  }, [offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    setIsDraggingState(false);
  }, []);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  }, [code]);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-background/97 backdrop-blur-sm">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/30 px-4">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
          Mermaid Diagram
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={copyCode}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            {codeCopied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span className={codeCopied ? 'text-green-400' : ''}>{codeCopied ? 'Copied!' : 'Copy code'}</span>
          </button>
          <div className="mx-1 h-4 w-px bg-border/30" />
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="relative flex-1 overflow-hidden select-none"
        style={{ cursor: isDraggingState ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Outer translate layer for pan (no will-change to avoid GPU rasterization) */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          {/* Inner zoom layer — CSS transform scales visually so pan works + overflow:hidden acts as viewport */}
          <div
            className="agent-mermaid"
            style={{
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              width: '80%',
              maxWidth: '1200px',
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
        {/* Zoom hint */}
        <div className="pointer-events-none absolute bottom-16 right-4 text-[10px] text-muted-foreground/30 select-none">
          scroll to zoom · drag to pan
        </div>
      </div>

      {/* Footer zoom controls */}
      <div className="flex h-11 shrink-0 items-center justify-center gap-1 border-t border-border/20">
        <button
          onClick={() => setScale((s) => clampScale(s - 0.25))}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          onClick={reset}
          className="min-w-[52px] rounded-md px-2 py-1 text-center text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          title="Reset zoom & pan"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={() => setScale((s) => clampScale(s + 0.25))}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <div className="mx-2 h-4 w-px bg-border/30" />
        <button
          onClick={reset}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          title="Reset zoom & pan"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>
    </div>
  );
}

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

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, ZoomIn, ZoomOut, Maximize2, X, RotateCcw } from 'lucide-react';
import { useSettingsStore } from '@/stores';

// ─── Types & helpers ───────────────────────────────────────────────────────────

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
    .replace(/(<svg\b[^>]*?)\s+width="[^"]*"/i, '$1')
    .replace(/(<svg\b[^>]*?)\s+height="[^"]*"/i, '$1')
    .replace(/max-width\s*:\s*[\d.]+px\s*;?\s*/g, '');
}

// ─── Fullscreen Modal ──────────────────────────────────────────────────────────

function MermaidModal({ svg, code, onClose }: { svg: string; code: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [codeCopied, setCodeCopied] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [isDraggingState, setIsDraggingState] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

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
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
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

// ─── MermaidBlock ──────────────────────────────────────────────────────────────

export function MermaidBlock({ code }: { code: string }) {
  const themeId = useSettingsStore((s) => s.themeId);
  const mermaidTheme = getMermaidTheme(themeId);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prevSvgRef = useRef<string | null>(null);
  const prevThemeRef = useRef<MermaidTheme>(mermaidTheme);

  const [scale, setScale] = useState(1);
  const wheelContainerRef = useRef<HTMLDivElement>(null);

  const [showModal, setShowModal] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

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
  }, [!!displaySvg]);

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
            <button
              onClick={copyCode}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              title="Copy source code"
            >
              {codeCopied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
              <span className={codeCopied ? 'text-green-400' : ''}>{codeCopied ? 'Copied!' : 'Copy code'}</span>
            </button>
            <div className="mx-1 h-3.5 w-px bg-border/30" />
            <button
              onClick={() => setScale((s) => clampScale(s - 0.25))}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              title="Zoom out (Ctrl+scroll)"
            >
              <ZoomOut className="h-3 w-3" />
            </button>
            <button
              onClick={() => setScale(1)}
              className="min-w-[34px] rounded px-1 py-0.5 text-center text-[10px] tabular-nums text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              title="Reset zoom"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              onClick={() => setScale((s) => clampScale(s + 0.25))}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              title="Zoom in (Ctrl+scroll)"
            >
              <ZoomIn className="h-3 w-3" />
            </button>
            <div className="mx-1 h-3.5 w-px bg-border/30" />
            <button
              onClick={() => setShowModal(true)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              title="Open in fullscreen"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Diagram */}
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

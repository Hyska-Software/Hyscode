import { useEffect, useState, useRef, useMemo } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import { Loader2, ZoomIn, ZoomOut, Maximize2, Image as ImageIcon } from 'lucide-react';
import { tauriFs } from '../../../lib/tauri-fs';

interface ImageViewerProps {
  filePath: string;
}

function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
  };
  return mimeMap[ext] ?? 'image/png';
}

function isSvg(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.svg');
}

export function ImageViewer({ filePath }: ImageViewerProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() ?? filePath, [filePath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSvgContent(null);
    setImageSrc(null);
    setZoom(100);
    setDimensions(null);

    (async () => {
      try {
        if (isSvg(filePath)) {
          const text = await tauriFs.readFile(filePath);
          if (!cancelled) {
            // Sanitize SVG: parse and re-serialize to strip scripts
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'image/svg+xml');
            // Remove script tags
            doc.querySelectorAll('script').forEach((el) => el.remove());
            // Remove event handler attributes
            const allEls = doc.querySelectorAll('*');
            allEls.forEach((el) => {
              for (const attr of Array.from(el.attributes)) {
                if (attr.name.startsWith('on')) {
                  el.removeAttribute(attr.name);
                }
              }
            });
            const sanitized = new XMLSerializer().serializeToString(doc.documentElement);
            setSvgContent(sanitized);
          }
        } else {
          const bytes = await readFile(filePath);
          if (!cancelled) {
            const mime = getMimeType(filePath);
            // Convert Uint8Array to base64
            let binary = '';
            const len = bytes.length;
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            setImageSrc(`data:${mime};base64,${base64}`);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const handleZoom = (delta: number) => {
    setZoom((z) => Math.max(10, Math.min(500, z + delta)));
  };

  const fitToWindow = () => {
    if (!dimensions || !containerRef.current) return;
    const container = containerRef.current;
    const scaleX = (container.clientWidth - 40) / dimensions.w;
    const scaleY = (container.clientHeight - 40) / dimensions.h;
    const scale = Math.min(scaleX, scaleY, 1) * 100;
    setZoom(Math.round(scale));
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <ImageIcon className="h-8 w-8 opacity-30" />
        <p className="text-xs">Failed to load image</p>
        <p className="text-[10px] opacity-60">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
        <ImageIcon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{fileName}</span>
        {dimensions && (
          <span className="text-[10px] text-muted-foreground/60">
            {dimensions.w} × {dimensions.h}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => handleZoom(-25)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[3rem] text-center text-[10px] text-muted-foreground">
            {zoom}%
          </span>
          <button
            onClick={() => handleZoom(25)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={fitToWindow}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Fit to window"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center overflow-auto bg-[#0e0e0e]"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Crect width=\'10\' height=\'10\' fill=\'%23181818\'/%3E%3Crect x=\'10\' y=\'10\' width=\'10\' height=\'10\' fill=\'%23181818\'/%3E%3Crect x=\'10\' width=\'10\' height=\'10\' fill=\'%23121212\'/%3E%3Crect y=\'10\' width=\'10\' height=\'10\' fill=\'%23121212\'/%3E%3C/svg%3E")' }}
      >
        {svgContent ? (
          <div
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center' }}
            className="transition-transform"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        ) : imageSrc ? (
          <img
            src={imageSrc}
            alt={fileName}
            onLoad={handleImageLoad}
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center' }}
            className="max-w-none transition-transform"
            draggable={false}
          />
        ) : null}
      </div>
    </div>
  );
}

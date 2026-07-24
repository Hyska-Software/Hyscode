import { useEffect, useState, useMemo } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import * as XLSX from 'xlsx';
import { Loader2, Presentation, Info } from 'lucide-react';

interface PptxViewerProps {
  filePath: string;
}

interface SlideData {
  index: number;
  title: string;
  content: string[];
}

export function PptxViewer({ filePath }: PptxViewerProps) {
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() ?? filePath, [filePath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSlides([]);

    (async () => {
      try {
        const bytes = await readFile(filePath);
        if (cancelled) return;
        const wb = XLSX.read(bytes, { type: 'array' });

        // SheetJS reads PPTX slides as "sheets"
        const extractedSlides: SlideData[] = wb.SheetNames.map((name, idx) => {
          const sheet = wb.Sheets[name];
          if (!sheet) return { index: idx + 1, title: name, content: [] };
          // Extract all text cells
          const rows: string[] = [];
          const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
          for (const row of data) {
            if (Array.isArray(row)) {
              const text = row.filter(Boolean).join(' ').trim();
              if (text) rows.push(text);
            }
          }
          return { index: idx + 1, title: name, content: rows };
        });

        if (!cancelled) setSlides(extractedSlides);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath]);

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
        <Presentation className="h-8 w-8 opacity-30" />
        <p className="text-xs">Failed to load presentation</p>
        <p className="text-[10px] opacity-60">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
        <Presentation className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{fileName}</span>
        <span className="text-[10px] text-muted-foreground/60">
          {slides.length} slide{slides.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Info banner */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/30 bg-blue-950/20 px-3 py-1.5">
        <Info className="h-3 w-3 text-blue-400" />
        <span className="text-[10px] text-blue-300/80">
          Text content extracted from presentation. Full graphical rendering is not supported.
        </span>
      </div>

      {/* Slide cards */}
      <div className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4 max-w-3xl mx-auto">
          {slides.map((slide) => (
            <div
              key={slide.index}
              className="rounded-lg border border-border/40 bg-[#1e1e1e] overflow-hidden"
            >
              {/* Slide header */}
              <div className="flex items-center gap-2 border-b border-border/30 bg-surface-raised px-4 py-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/20 text-[10px] font-bold text-primary">
                  {slide.index}
                </span>
                <span className="text-[11px] font-medium text-foreground">{slide.title}</span>
              </div>
              {/* Slide content */}
              <div className="p-4 min-h-[80px]">
                {slide.content.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {slide.content.map((text, i) => (
                      <p key={i} className="text-[12px] text-foreground/85 leading-relaxed">
                        {text}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground italic">
                    No text content on this slide
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

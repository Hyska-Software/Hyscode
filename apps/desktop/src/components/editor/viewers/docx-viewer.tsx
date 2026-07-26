import { useEffect, useState, useMemo } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import mammoth from 'mammoth';
import { Loader2, FileText, AlertTriangle } from 'lucide-react';

interface DocxViewerProps {
  filePath: string;
}

export function DocxViewer({ filePath }: DocxViewerProps) {
  const [html, setHtml] = useState<string>('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showWarnings, setShowWarnings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() ?? filePath, [filePath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml('');
    setWarnings([]);

    (async () => {
      try {
        const bytes = await readFile(filePath);
        if (cancelled) return;
        const result = await mammoth.convertToHtml({
          arrayBuffer: bytes.buffer as ArrayBuffer,
        });
        if (!cancelled) {
          setHtml(result.value);
          setWarnings(result.messages.map((m) => m.message));
        }
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
        <FileText className="h-8 w-8 opacity-30" />
        <p className="text-xs">Failed to load document</p>
        <p className="text-[10px] opacity-60">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
        <FileText className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{fileName}</span>
        {warnings.length > 0 && (
          <button
            onClick={() => setShowWarnings((v) => !v)}
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-amber-400 hover:bg-muted transition-colors"
          >
            <AlertTriangle className="h-3 w-3" />
            {warnings.length} warning{warnings.length > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Warnings panel */}
      {showWarnings && warnings.length > 0 && (
        <div className="shrink-0 border-b border-border/30 bg-amber-950/20 px-3 py-2 max-h-32 overflow-auto">
          {warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-300/80">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Document content */}
      <div className="flex-1 overflow-auto p-6">
        <article className="docx-content prose prose-invert prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-a:text-primary prose-strong:text-foreground prose-table:text-foreground/80">
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      </div>

      <style>{`
        .docx-content table {
          border-collapse: collapse;
          width: 100%;
        }
        .docx-content th,
        .docx-content td {
          border: 1px solid #333;
          padding: 6px 10px;
        }
        .docx-content img {
          max-width: 100%;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}

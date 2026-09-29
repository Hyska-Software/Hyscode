import { useEffect, useState } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import { Loader2, FileText } from 'lucide-react';

interface PdfViewerProps {
  filePath: string;
}

export function PdfViewer({ filePath }: PdfViewerProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDataUrl(null);

    (async () => {
      try {
        const bytes = await readFile(filePath);
        if (cancelled) return;
        let binary = '';
        const len = bytes.length;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        setDataUrl(`data:application/pdf;base64,${base64}`);
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
        <p className="text-xs">Failed to load PDF</p>
        <p className="text-[10px] opacity-60">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
        <FileText className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">
          {filePath.split(/[\\/]/).pop()}
        </span>
      </div>
      <iframe
        src={dataUrl ?? ''}
        className="flex-1 border-0 bg-white"
        title="PDF Viewer"
      />
    </div>
  );
}

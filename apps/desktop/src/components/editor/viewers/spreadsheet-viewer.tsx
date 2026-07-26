import { useEffect, useState, useMemo } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import * as XLSX from 'xlsx';
import { Loader2, Table } from 'lucide-react';

interface SpreadsheetViewerProps {
  filePath: string;
}

export function SpreadsheetViewer({ filePath }: SpreadsheetViewerProps) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() ?? filePath, [filePath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setWorkbook(null);
    setActiveSheet('');

    (async () => {
      try {
        const bytes = await readFile(filePath);
        if (cancelled) return;
        const wb = XLSX.read(bytes, { type: 'array' });
        setWorkbook(wb);
        setActiveSheet(wb.SheetNames[0] ?? '');
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

  const tableHtml = useMemo(() => {
    if (!workbook || !activeSheet) return '';
    const sheet = workbook.Sheets[activeSheet];
    if (!sheet) return '';
    return XLSX.utils.sheet_to_html(sheet, { editable: false });
  }, [workbook, activeSheet]);

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
        <Table className="h-8 w-8 opacity-30" />
        <p className="text-xs">Failed to load spreadsheet</p>
        <p className="text-[10px] opacity-60">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar with sheet selector */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
        <Table className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{fileName}</span>
      </div>

      {/* Sheet tabs */}
      {workbook && workbook.SheetNames.length > 1 && (
        <div className="flex shrink-0 items-center gap-0.5 border-b border-border/30 bg-surface-raised px-2 overflow-x-auto">
          {workbook.SheetNames.map((name) => (
            <button
              key={name}
              onClick={() => setActiveSheet(name)}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors rounded-t-md ${
                activeSheet === name
                  ? 'bg-muted text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Table content */}
      <div className="flex-1 overflow-auto">
        <div
          className="spreadsheet-table min-w-full"
          dangerouslySetInnerHTML={{ __html: tableHtml }}
        />
      </div>

      {/* Scoped styles for the SheetJS HTML table */}
      <style>{`
        .spreadsheet-table table {
          border-collapse: collapse;
          font-size: 12px;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          color: #f0f0f0;
          width: 100%;
        }
        .spreadsheet-table th,
        .spreadsheet-table td {
          border: 1px solid #2a2a2a;
          padding: 4px 8px;
          text-align: left;
          white-space: nowrap;
        }
        .spreadsheet-table th {
          background: #1e1e1e;
          font-weight: 600;
          color: #b0b0b0;
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .spreadsheet-table tr:hover td {
          background: #ffffff08;
        }
      `}</style>
    </div>
  );
}

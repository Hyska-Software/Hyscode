import { useCallback, useState } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layout,
  LayoutTemplate,
  Download,
  Upload,
  Database,
  Plus,
  RotateCcw,
  FileCode,
  FileText,
  Braces,
  RefreshCw,
  Save,
  ChevronDown,
} from 'lucide-react';
import { useSchemaDiagramStore } from '../../../../stores/schema-diagram-store';
import { toSqlDdl, toPrismaSchema, toDrizzleSchema, toMermaidEr } from '../../../../lib/schema-exporters';
import { writeClipboard } from '../../../../lib/utils';
import type { SchemaGraph } from '../../../../lib/schema-parsers/types';

interface SchemaToolbarProps {
  onAutoLayout: (direction: 'LR' | 'TB') => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onOpenFile: () => void;
  onConnectSqlite: () => void;
  onAddTable: () => void;
  onSaveToFile?: () => void;
  onReloadFromFile?: () => void;
}

export function SchemaToolbar({
  onAutoLayout,
  onZoomIn,
  onZoomOut,
  onFitView,
  onOpenFile,
  onConnectSqlite,
  onAddTable,
  onSaveToFile,
  onReloadFromFile,
}: SchemaToolbarProps) {
  const { tables, relations, diagramName, isDirty } = useSchemaDiagramStore();
  const [exportOpen, setExportOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const graph: SchemaGraph = { tables, relations };

  const handleExport = useCallback(async (format: 'sql' | 'prisma' | 'drizzle' | 'mermaid') => {
    let content = '';
    switch (format) {
      case 'sql': content = toSqlDdl(graph); break;
      case 'prisma': content = toPrismaSchema(graph); break;
      case 'drizzle': content = toDrizzleSchema(graph); break;
      case 'mermaid': content = toMermaidEr(graph); break;
    }
    await writeClipboard(content);
    setCopied(format);
    setTimeout(() => setCopied(null), 2000);
    setExportOpen(false);
  }, [graph]);

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/30 bg-background px-2">
      {/* Diagram name */}
      <span className="mr-2 text-[11px] font-medium text-foreground/70">
        {diagramName}
        {isDirty && <span className="ml-1 text-muted-foreground">•</span>}
      </span>

      <div className="h-4 w-px bg-border/30" />

      {/* Add table */}
      <button
        className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        onClick={onAddTable}
        title="Add table"
      >
        <Plus className="h-3.5 w-3.5" />
        Table
      </button>

      <div className="h-4 w-px bg-border/30" />

      {/* Layout dropdown */}
      <div className="relative">
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          onClick={() => setLayoutOpen((v) => !v)}
          title="Auto-layout diagram"
        >
          <Layout className="h-3.5 w-3.5" />
          Layout
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
        {layoutOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-md border border-border/40 bg-popover shadow-lg">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-muted/40"
              onClick={() => { onAutoLayout('LR'); setLayoutOpen(false); }}
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
              Horizontal (Left → Right)
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-muted/40"
              onClick={() => { onAutoLayout('TB'); setLayoutOpen(false); }}
            >
              <LayoutTemplate className="h-3.5 w-3.5 rotate-90" />
              Vertical (Top → Bottom)
            </button>
          </div>
        )}
      </div>

      {/* Zoom controls */}
      <button
        className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        onClick={onZoomOut}
        title="Zoom out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <button
        className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        onClick={onFitView}
        title="Fit view"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      <button
        className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        onClick={onZoomIn}
        title="Zoom in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>

      <div className="flex-1" />

      {/* Import */}
      <button
        className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        onClick={onOpenFile}
        title="Open schema file (.sql, .prisma, .ts)"
      >
        <Upload className="h-3.5 w-3.5" />
        Open file
      </button>

      {/* Connect SQLite */}
      <button
        className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        onClick={onConnectSqlite}
        title="Connect to SQLite database"
      >
        <Database className="h-3.5 w-3.5" />
        SQLite
      </button>

      {onReloadFromFile && (
        <button
          className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          onClick={onReloadFromFile}
          title="Reload from source file"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}

      {onSaveToFile && (
        <button
          className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          onClick={onSaveToFile}
          title="Save to source file now"
        >
          <Save className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="h-4 w-px bg-border/30" />

      {/* Layout menu outside click */}
      {layoutOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setLayoutOpen(false)}
        />
      )}

      {/* Export menu */}
      <div className="relative">
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          onClick={() => setExportOpen((v) => !v)}
          title="Export schema"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
        {exportOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[150px] overflow-hidden rounded-md border border-border/40 bg-popover shadow-lg">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-muted/40"
              onClick={() => handleExport('sql')}
            >
              <FileText className="h-3.5 w-3.5" />
              {copied === 'sql' ? 'Copied!' : 'Copy as SQL DDL'}
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-muted/40"
              onClick={() => handleExport('prisma')}
            >
              <FileCode className="h-3.5 w-3.5" />
              {copied === 'prisma' ? 'Copied!' : 'Copy as Prisma'}
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-muted/40"
              onClick={() => handleExport('drizzle')}
            >
              <Braces className="h-3.5 w-3.5" />
              {copied === 'drizzle' ? 'Copied!' : 'Copy as Drizzle'}
            </button>
            <div className="my-1 border-t border-border/30" />
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-muted/40"
              onClick={() => handleExport('mermaid')}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {copied === 'mermaid' ? 'Copied!' : 'Copy as Mermaid ER'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

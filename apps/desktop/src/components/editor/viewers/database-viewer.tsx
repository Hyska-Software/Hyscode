import { useEffect, useState, useCallback } from 'react';
import {
  Database,
  Table2,
  Code2,
  GitGraph,
  Rows3,
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { connectSQLite, closeConnection } from '../../../lib/db-engine';
import { useDbViewerStore } from '../../../stores/db-viewer-store';
import { DbExplorer } from './db-explorer';
import { DbDataGrid } from './db-data-grid';
import { DbTableSchema } from './db-table-schema';
import { DbSqlEditor } from './db-sql-editor';
import { DbSchemaViewer } from './db-schema/db-schema-viewer';

interface DatabaseViewerProps {
  filePath: string;
}

type DbTab = 'data' | 'schema' | 'query' | 'diagram';

const TABS: { id: DbTab; label: string; icon: React.ReactNode }[] = [
  { id: 'data', label: 'Data', icon: <Rows3 className="h-3 w-3" /> },
  { id: 'schema', label: 'Schema', icon: <Table2 className="h-3 w-3" /> },
  { id: 'query', label: 'Query', icon: <Code2 className="h-3 w-3" /> },
  { id: 'diagram', label: 'Diagram', icon: <GitGraph className="h-3 w-3" /> },
];

export function DatabaseViewer({ filePath }: DatabaseViewerProps) {
  const {
    connection,
    isConnecting,
    connectionError,
    selectedTable,
    tableInfo,
    activeTab,
    error,
    setConnection,
    setConnecting,
    setConnectionError,
    setError,
    setActiveTab,
    reset,
  } = useDbViewerStore();

  const [localError, setLocalError] = useState<string | null>(null);

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  // Connect on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setConnecting(true);
      setConnectionError(null);
      try {
        const conn = await connectSQLite(filePath);
        if (!cancelled) {
          setConnection(conn);
        } else {
          await closeConnection(conn.id);
        }
      } catch (err: any) {
        if (!cancelled) {
          setConnectionError(err.message ?? 'Failed to connect to database');
        }
      } finally {
        if (!cancelled) {
          setConnecting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      // Cleanup connection on unmount
      const conn = useDbViewerStore.getState().connection;
      if (conn) {
        closeConnection(conn.id).catch(() => {});
        reset();
      }
    };
  }, [filePath]);

  const dismissError = useCallback(() => {
    setError(null);
    setLocalError(null);
  }, [setError]);

  if (isConnecting) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
          <Database className="h-3 w-3 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">{fileName}</span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-xs text-muted-foreground">Connecting to database...</span>
        </div>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
          <Database className="h-3 w-3 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">{fileName}</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <AlertCircle className="h-8 w-8 text-destructive/60" />
          <p className="text-xs font-medium">Failed to open database</p>
          <p className="max-w-md text-center text-[10px] opacity-60">{connectionError}</p>
        </div>
      </div>
    );
  }

  if (!connection) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
          <Database className="h-3 w-3 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">{fileName}</span>
        </div>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p className="text-xs">No database connection</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
        <Database className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">{fileName}</span>
        {connection && (
          <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
            {connection.type}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">{filePath}</span>
      </div>

      {/* Error banner */}
      {(error || localError) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-1.5">
          <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
          <span className="flex-1 text-[11px] text-red-600">{error || localError}</span>
          <button onClick={dismissError} className="rounded p-0.5 hover:bg-destructive/10">
            <X className="h-3 w-3 text-destructive" />
          </button>
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Explorer sidebar */}
            <DbExplorer />

        {/* Content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border/40 bg-surface-raised px-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground',
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'data' && <DbDataGrid />}

            {activeTab === 'schema' && (
              <>
                {tableInfo ? (
                  <DbTableSchema tableInfo={tableInfo} />
                ) : selectedTable ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <p className="text-xs">Select a table to view its schema</p>
                  </div>
                )}
              </>
            )}

            {activeTab === 'query' && <DbSqlEditor />}

            {activeTab === 'diagram' && (
              <DbSchemaViewer sourceFile={filePath} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

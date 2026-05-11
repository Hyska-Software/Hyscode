import { useCallback, useEffect, useState } from 'react';
import { Database, Table2, Eye, Search, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useDbViewerStore } from '../../../stores/db-viewer-store';
import { getTables, getViews } from '../../../lib/db-engine';

export function DbExplorer() {
  const { tables, views, selectedTable, setTables, setViews, selectTable, setLoading, setError } =
    useDbViewerStore();

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['tables']));
  const [searchTerm, setSearchTerm] = useState('');

  const loadSchema = useCallback(async () => {
    const conn = useDbViewerStore.getState().connection;
    console.log('[DbExplorer] loadSchema, connection:', conn?.id, conn?.name);
    if (!conn) return;

    setLoading(true);
    setError(null);
    try {
      const [tableList, viewList] = await Promise.all([getTables(conn), getViews(conn)]);
      console.log('[DbExplorer] Loaded tables:', tableList.length, 'views:', viewList.length);
      setTables(tableList);
      setViews(viewList);
    } catch (err: any) {
      console.error('[DbExplorer] loadSchema error:', err);
      setError(err.message ?? 'Failed to load schema');
    } finally {
      setLoading(false);
    }
  }, [setTables, setViews, setLoading, setError]);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const filteredTables = tables.filter((t) => t.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredViews = views.filter((v) => v.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r border-border/40 bg-background">
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/40 px-2">
        <Database className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground">Explorer</span>
        <button
          onClick={loadSchema}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Search */}
      <div className="relative border-b border-border/40 px-2 py-1.5">
        <Search className="absolute left-3.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
        <input
          type="text"
          placeholder="Filter..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded bg-muted/50 py-1 pl-6 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Tables */}
        <div className="select-none">
          <button
            onClick={() => toggleSection('tables')}
            className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          >
            {expandedSections.has('tables') ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Table2 className="h-3 w-3" />
            Tables ({filteredTables.length})
          </button>

          {expandedSections.has('tables') && (
            <div className="pb-1">
              {filteredTables.map((table) => (
                <button
                  key={table}
                  onClick={() => selectTable(table)}
                  className={cn(
                    'flex w-full items-center gap-1.5 px-5 py-0.5 text-[11px] transition-colors',
                    selectedTable === table
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground/70 hover:bg-muted/30 hover:text-foreground',
                  )}
                >
                  <Table2 className="h-3 w-3 opacity-60" />
                  {table}
                </button>
              ))}
              {filteredTables.length === 0 && (
                <div className="px-5 py-1 text-[10px] text-muted-foreground/50">No tables</div>
              )}
            </div>
          )}
        </div>

        {/* Views */}
        {filteredViews.length > 0 && (
          <div className="select-none mt-1">
            <button
              onClick={() => toggleSection('views')}
              className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              {expandedSections.has('views') ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Eye className="h-3 w-3" />
              Views ({filteredViews.length})
            </button>

            {expandedSections.has('views') && (
              <div className="pb-1">
                {filteredViews.map((view) => (
                  <button
                    key={view}
                    onClick={() => selectTable(view)}
                    className={cn(
                      'flex w-full items-center gap-1.5 px-5 py-0.5 text-[11px] transition-colors',
                      selectedTable === view
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-foreground/70 hover:bg-muted/30 hover:text-foreground',
                    )}
                  >
                    <Eye className="h-3 w-3 opacity-60" />
                    {view}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

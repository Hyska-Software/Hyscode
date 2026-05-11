import { useEffect } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Save, RotateCcw } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatCellValue } from '../../../lib/db-engine';
import { useDbViewerStore } from '../../../stores/db-viewer-store';
import { getTableData, getTableSchema, updateCell, buildWhereClause } from '../../../lib/db-engine';

export function DbDataGrid() {
  const {
    selectedTable,
    tableData,
    tableDataTotal,
    page,
    pageSize,
    tableInfo,
    isLoading,
    isSaving,
    editingCell,
    pendingChanges,
    setTableData,
    setTableInfo,
    setPage,
    setLoading,
    setError,
    setEditingCell,
    stageCellChange,
    clearPendingChanges,
    setIsSaving,
  } = useDbViewerStore();

  const totalPages = Math.max(1, Math.ceil(tableDataTotal / pageSize));
  const pendingCount = pendingChanges.size;

  // Load data when table/page changes
  useEffect(() => {
    if (!selectedTable) return;

    const conn = useDbViewerStore.getState().connection;
    if (!conn) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const [schema, data] = await Promise.all([
          getTableSchema(conn, selectedTable),
          getTableData(conn, selectedTable, page, pageSize),
        ]);

        if (!cancelled) {
          setTableInfo(schema);
          setTableData(data.rows, data.total);
          clearPendingChanges();
        }
      } catch (err: any) {
        console.error('[DbDataGrid] Failed to load data:', err);
        if (!cancelled) {
          const msg = err?.message || err?.toString?.() || 'Failed to load data';
          setError(msg);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedTable, page, pageSize]);

  const handleCellDoubleClick = (rowIndex: number, column: string, value: unknown) => {
    if (!tableInfo) return;
    if (column === 'rowid') return;
    setEditingCell({ rowIndex, column, value: value ?? '' });
  };

  const handleCellEdit = (rowIndex: number, column: string, value: unknown) => {
    const oldValue = tableData[rowIndex]?.[column];
    stageCellChange(rowIndex, column, oldValue, value);
    setEditingCell(null);
  };

  const handleSaveChanges = async () => {
    if (pendingCount === 0 || !selectedTable || !tableInfo) return;

    const conn = useDbViewerStore.getState().connection;
    if (!conn) return;

    setIsSaving(true);
    setError(null);

    const changes = Array.from(pendingChanges.values());
    const failed: string[] = [];

    for (const change of changes) {
      try {
        const row = tableData[change.rowIndex];
        if (!row) continue;

        const { clause } = buildWhereClause(tableInfo.columns, row);
        if (!clause) {
          failed.push(`${change.column}: no WHERE clause`);
          continue;
        }

        // Normalize value: empty string -> null for nullable columns
        const col = tableInfo.columns.find((c) => c.name === change.column);
        let valueToSave = change.newValue;
        if (valueToSave === '' && col && !col.notNull) {
          valueToSave = null;
        }

        await updateCell(conn, selectedTable, change.column, valueToSave, clause);
      } catch (err: any) {
        console.error('[DbDataGrid] Failed to save cell:', err);
        failed.push(`${change.column}: ${err.message}`);
      }
    }

    setIsSaving(false);

    if (failed.length > 0) {
      setError(`Failed to save ${failed.length} of ${changes.length} changes: ${failed.join(', ')}`);
    } else {
      clearPendingChanges();
    }
  };

  const handleRevertChanges = async () => {
    if (!selectedTable) return;

    const conn = useDbViewerStore.getState().connection;
    if (!conn) return;

    setLoading(true);
    setError(null);

    try {
      const data = await getTableData(conn, selectedTable, page, pageSize);
      setTableData(data.rows, data.total);
      clearPendingChanges();
    } catch (err: any) {
      setError(err.message ?? 'Failed to reload data');
    } finally {
      setLoading(false);
    }
  };

  const columns = tableInfo?.columns ?? [];
  const hasData = tableData.length > 0;

  if (!selectedTable) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-xs">Select a table to view data</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 bg-surface-raised px-3">
        <span className="text-[11px] font-medium text-foreground">{selectedTable}</span>
        <span className="text-[10px] text-muted-foreground">
          {tableDataTotal.toLocaleString()} rows
        </span>

        {pendingCount > 0 && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
            {pendingCount} pending
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {pendingCount > 0 && (
            <>
              <button
                onClick={handleSaveChanges}
                disabled={isSaving}
                className="flex items-center gap-1 rounded bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 hover:bg-green-500/20 disabled:opacity-40 transition-colors"
              >
                {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </button>
              <button
                onClick={handleRevertChanges}
                disabled={isSaving || isLoading}
                className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/80 disabled:opacity-40 transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Revert
              </button>
            </>
          )}
          {(isLoading || isSaving) && (
            <Loader2 className="ml-1 h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {columns.length > 0 ? (
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border/40 bg-muted/50">
                {columns.map((col) => (
                  <th
                    key={col.name}
                    className={cn(
                      'whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground',
                      col.isPk && 'text-amber-600',
                    )}
                  >
                    <div className="flex items-center gap-1">
                      {col.name}
                      <span className="text-[10px] text-muted-foreground/60">{col.type}</span>
                      {col.notNull && <span className="text-red-400">*</span>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hasData ? (
                tableData.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-border/10 hover:bg-muted/20">
                    {columns.map((col) => {
                      const isEditing =
                        editingCell?.rowIndex === rowIndex && editingCell?.column === col.name;
                      const cellValue = row[col.name];
                      const isNull = cellValue === null || cellValue === undefined;
                      const pendingKey = `${rowIndex}:${col.name}`;
                      const isDirty = pendingChanges.has(pendingKey);

                      return (
                        <td
                          key={col.name}
                          className={cn(
                            'whitespace-nowrap px-3 py-1',
                            isNull && 'text-muted-foreground/40 italic',
                            isEditing && 'p-0',
                            isDirty && !isEditing && 'bg-amber-500/10',
                          )}
                          onDoubleClick={() => handleCellDoubleClick(rowIndex, col.name, cellValue)}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              autoFocus
                              defaultValue={cellValue === null || cellValue === undefined ? '' : String(cellValue)}
                              className="w-full px-2 py-1 text-[11px] outline-none bg-primary/5 ring-1 ring-primary/30"
                              onBlur={(e) => handleCellEdit(rowIndex, col.name, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleCellEdit(rowIndex, col.name, e.currentTarget.value);
                                } else if (e.key === 'Escape') {
                                  setEditingCell(null);
                                }
                              }}
                            />
                          ) : (
                            <span className="block truncate max-w-[300px]" title={formatCellValue(cellValue)}>
                              {isNull ? 'NULL' : formatCellValue(cellValue)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                    <p className="text-xs">Table is empty</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p className="text-xs">No data</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {tableDataTotal > 0 && (
        <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border/40 bg-surface-raised px-3">
          <div className="text-[10px] text-muted-foreground">
            {page * pageSize + 1} – {Math.min((page + 1) * pageSize, tableDataTotal)} of{' '}
            {tableDataTotal.toLocaleString()}
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
            </button>

            <span className="min-w-[3rem] text-center text-[10px] text-muted-foreground">
              {page + 1} / {totalPages}
            </span>

            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          <select
            value={pageSize}
            onChange={(e) => useDbViewerStore.getState().setPageSize(Number(e.target.value))}
            className="rounded border border-border/40 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>
      )}
    </div>
  );
}

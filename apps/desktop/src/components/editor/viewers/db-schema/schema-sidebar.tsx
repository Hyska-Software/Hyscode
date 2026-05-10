import { useState, useCallback } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useSchemaDiagramStore } from '../../../../stores/schema-diagram-store';
import type { SchemaColumn } from '../../../../lib/schema-parsers/types';

const COMMON_TYPES = ['TEXT', 'INTEGER', 'BIGINT', 'REAL', 'BOOLEAN', 'VARCHAR', 'UUID', 'TIMESTAMP', 'JSON', 'BLOB'];

interface SchemaSidebarProps {
  onClose: () => void;
}

export function SchemaSidebar({ onClose }: SchemaSidebarProps) {
  const { tables, selectedIds, updateTable, addColumn, updateColumn, removeColumn, removeTable } = useSchemaDiagramStore();
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  const selectedTables = tables.filter((t) => selectedIds.includes(t.id));
  const displayTables = selectedTables.length > 0 ? selectedTables : tables;

  const toggleExpand = (id: string) =>
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleUpdateColumn = useCallback(
    (tableId: string, colName: string, patch: Partial<SchemaColumn>) => {
      updateColumn(tableId, colName, patch);
    },
    [updateColumn],
  );

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-l border-border/30 bg-background">
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-border/30 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Schema Properties
        </span>
        <button
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {displayTables.length === 0 && (
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            No tables. Add one from the toolbar.
          </p>
        )}
        {displayTables.map((table) => (
          <div key={table.id} className="mb-2 rounded-md border border-border/30 overflow-hidden">
            {/* Table header */}
            <div className="flex items-center gap-1 bg-muted/20 px-2 py-1.5">
              <button className="flex-1 text-left" onClick={() => toggleExpand(table.id)}>
                <input
                  className="w-full bg-transparent text-[11px] font-semibold text-foreground outline-none"
                  defaultValue={table.name}
                  onBlur={(e) => updateTable(table.id, { name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </button>
              <button onClick={() => toggleExpand(table.id)} className="text-muted-foreground">
                {expandedTables.has(table.id)
                  ? <ChevronUp className="h-3 w-3" />
                  : <ChevronDown className="h-3 w-3" />}
              </button>
              <button
                className="text-muted-foreground hover:text-destructive"
                onClick={() => removeTable(table.id)}
                title="Delete table"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>

            {/* Columns list */}
            {expandedTables.has(table.id) && (
              <div className="divide-y divide-border/20">
                {table.columns.map((col) => (
                  <div key={col.name} className="px-2 py-1.5 text-[10px]">
                    <div className="flex items-center gap-1 mb-1">
                      <input
                        className="flex-1 bg-transparent text-foreground outline-none"
                        defaultValue={col.name}
                        onBlur={(e) => {
                          if (e.target.value !== col.name)
                            handleUpdateColumn(table.id, col.name, { name: e.target.value });
                        }}
                      />
                      <button
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeColumn(table.id, col.name)}
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="flex-1 rounded bg-muted/30 px-1 py-0.5 text-[10px] text-foreground outline-none"
                        value={col.type}
                        onChange={(e) => handleUpdateColumn(table.id, col.name, { type: e.target.value })}
                      >
                        {COMMON_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                        {!COMMON_TYPES.includes(col.type) && (
                          <option value={col.type}>{col.type}</option>
                        )}
                      </select>
                      <label className="flex items-center gap-0.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-2.5 w-2.5"
                          checked={!col.nullable}
                          onChange={(e) => handleUpdateColumn(table.id, col.name, { nullable: !e.target.checked })}
                        />
                        <span className="text-muted-foreground">NN</span>
                      </label>
                      <label className="flex items-center gap-0.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-2.5 w-2.5"
                          checked={col.isPrimary}
                          onChange={(e) => handleUpdateColumn(table.id, col.name, { isPrimary: e.target.checked })}
                        />
                        <span className="text-muted-foreground">PK</span>
                      </label>
                    </div>
                  </div>
                ))}
                {/* Add column */}
                <button
                  className="flex w-full items-center gap-1 px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/20"
                  onClick={() => addColumn(table.id, {
                    name: 'new_column',
                    type: 'TEXT',
                    nullable: true,
                    isPrimary: false,
                    isForeign: false,
                    isUnique: false,
                  })}
                >
                  <Plus className="h-3 w-3" />
                  Add column
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

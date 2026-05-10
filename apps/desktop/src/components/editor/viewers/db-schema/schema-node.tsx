import { memo, useState, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Key, Link, Plus, Trash2 } from 'lucide-react';
import { useSchemaDiagramStore } from '../../../../stores/schema-diagram-store';
import type { SchemaTable } from '../../../../lib/schema-parsers/types';

export interface SchemaNodeData extends Record<string, unknown> {
  table: SchemaTable;
}

export const SchemaNode = memo(({ data, selected }: NodeProps) => {
  const { table } = data as SchemaNodeData;
  const { removeTable, addColumn, removeColumn } = useSchemaDiagramStore();
  const [editingName, setEditingName] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [showAddCol, setShowAddCol] = useState(false);
  const updateTable = useSchemaDiagramStore((s) => s.updateTable);

  const handleAddColumn = useCallback(() => {
    if (!newColName.trim()) return;
    addColumn(table.id, {
      name: newColName.trim(),
      type: 'TEXT',
      nullable: true,
      isPrimary: false,
      isForeign: false,
      isUnique: false,
    });
    setNewColName('');
    setShowAddCol(false);
  }, [newColName, addColumn, table.id]);

  return (
    <div
      className={`
        min-w-[220px] rounded-xl border bg-card shadow-sm
        ${selected ? 'border-primary/60 ring-2 ring-primary/20' : 'border-border/60'}
        overflow-hidden transition-shadow
      `}
    >
      {/* Table header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/40 px-3 py-2">
        {editingName ? (
          <input
            autoFocus
            className="flex-1 bg-transparent text-[12px] font-semibold text-foreground outline-none"
            defaultValue={table.name}
            onBlur={(e) => {
              updateTable(table.id, { name: e.target.value });
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateTable(table.id, { name: (e.target as HTMLInputElement).value });
                setEditingName(false);
              } else if (e.key === 'Escape') {
                setEditingName(false);
              }
            }}
          />
        ) : (
          <span
            className="flex-1 cursor-text text-[12px] font-semibold text-foreground"
            onDoubleClick={() => setEditingName(true)}
          >
            {table.name}
          </span>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => setShowAddCol((v) => !v)}
            title="Add column"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            className="rounded p-0.5 text-muted-foreground hover:text-destructive"
            onClick={() => removeTable(table.id)}
            title="Delete table"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Columns */}
      <div className="divide-y divide-border/20">
        {table.columns.map((col) => (
          <div
            key={col.name}
            className="group/col relative flex items-center gap-1.5 px-3 py-1.5"
          >
            {/* Source handle for FK relations */}
            <Handle
              type="source"
              position={Position.Right}
              id={`${table.id}__${col.name}__src`}
              className="!h-2.5 !w-2.5 !border !border-border/60 !bg-primary/80"
              style={{ right: -6, zIndex: 10 }}
              title={`Connect from ${col.name}`}
            />
            <Handle
              type="target"
              position={Position.Left}
              id={`${table.id}__${col.name}__tgt`}
              className="!h-2.5 !w-2.5 !border !border-border/60 !bg-primary/80"
              style={{ left: -6, zIndex: 10 }}
              title={`Connect to ${col.name}`}
            />

            {/* PK / FK badge */}
            <span className="w-3.5 shrink-0 flex items-center justify-center">
              {col.isPrimary && <Key className="h-3 w-3 text-amber-500" />}
              {!col.isPrimary && col.isForeign && <Link className="h-3 w-3 text-blue-500" />}
            </span>

            {/* Column name */}
            <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
              {col.name}
            </span>

            {/* Column type */}
            <span className="ml-1 shrink-0 rounded bg-muted/60 px-1 py-0.5 text-[9px] font-mono uppercase text-muted-foreground">
              {col.type.split('(')[0]}
            </span>

            {/* Nullable dot */}
            {col.nullable && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" title="Nullable" />
            )}

            {/* Delete column button (hover) */}
            <button
              className="ml-1 hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover/col:block"
              onClick={() => removeColumn(table.id, col.name)}
              title="Remove column"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add column inline form */}
      {showAddCol && (
        <div className="flex items-center gap-1 border-t border-border/30 px-2 py-1.5">
          <input
            autoFocus
            placeholder="column name"
            className="flex-1 rounded bg-muted/50 px-2 py-0.5 text-[11px] text-foreground placeholder-muted-foreground/50 outline-none"
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddColumn();
              else if (e.key === 'Escape') setShowAddCol(false);
            }}
          />
          <button
            className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/20"
            onClick={handleAddColumn}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
});

SchemaNode.displayName = 'SchemaNode';

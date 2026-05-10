import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { listen } from '@tauri-apps/api/event';
import { Loader2, PanelRightOpen, PanelRightClose } from 'lucide-react';

import { SchemaNode, type SchemaNodeData } from './schema-node';
import { SchemaEdge } from './schema-edge';
import { SchemaToolbar } from './schema-toolbar';
import { SchemaSidebar } from './schema-sidebar';
import { useSchemaDiagramStore } from '../../../../stores/schema-diagram-store';
import { parseSchema, detectSourceType } from '../../../../lib/schema-parsers';
import { toSqlDdl, toPrismaSchema, toDrizzleSchema } from '../../../../lib/schema-exporters';
import type { SchemaGraph } from '../../../../lib/schema-parsers/types';
import { tauriInvoke } from '../../../../lib/tauri-invoke';
import { openFileDialog } from '../../../../lib/tauri-dialog';

// ─── Custom node/edge types ────────────────────────────────────────────────

const NODE_TYPES = { schemaTable: SchemaNode };
const EDGE_TYPES = { schemaRelation: SchemaEdge };

// ─── Dagre layout ──────────────────────────────────────────────────────────

const NODE_WIDTH = 220;
const NODE_HEIGHT_BASE = 80;
const ROW_HEIGHT = 26;

function buildLayout(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'LR',
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: direction === 'LR' ? 120 : 100,
    marginx: 40,
    marginy: 40,
    ranker: 'network-simplex',
  });

  for (const node of nodes) {
    const data = node.data as SchemaNodeData;
    const h = NODE_HEIGHT_BASE + (data.table.columns.length * ROW_HEIGHT);
    g.setNode(node.id, { width: NODE_WIDTH, height: h });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const laidOut = nodes.map((node) => {
    const pos = g.node(node.id);
    const data = node.data as SchemaNodeData;
    const h = NODE_HEIGHT_BASE + (data.table.columns.length * ROW_HEIGHT);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - h / 2,
      },
    };
  });

  return { nodes: laidOut, edges };
}

// ─── Graph → React Flow conversion ────────────────────────────────────────

function graphToFlow(
  graph: SchemaGraph,
  positions: Record<string, { x: number; y: number }>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.tables.map((table) => ({
    id: table.id,
    type: 'schemaTable',
    position: positions[table.id] ?? { x: 0, y: 0 },
    data: { table } as SchemaNodeData,
    className: 'group',
  }));

  const tableById = new Map(graph.tables.map((t) => [t.id, t]));
  const tableByIdLower = new Map(graph.tables.map((t) => [t.id.toLowerCase(), t]));

  const edges: Edge[] = graph.relations.flatMap((rel) => {
    const sourceTable = tableById.get(rel.fromTable) ?? tableByIdLower.get(rel.fromTable.toLowerCase());
    const targetTable = tableById.get(rel.toTable) ?? tableByIdLower.get(rel.toTable.toLowerCase());
    if (!sourceTable || !targetTable) return [];

    const sourceCol = sourceTable.columns.find((c) => c.name === rel.fromColumn)
      ?? sourceTable.columns.find((c) => c.name.toLowerCase() === rel.fromColumn.toLowerCase());
    const targetCol = targetTable.columns.find((c) => c.name === rel.toColumn)
      ?? targetTable.columns.find((c) => c.name.toLowerCase() === rel.toColumn.toLowerCase());

    return [{
      id: rel.id,
      source: sourceTable.id,
      target: targetTable.id,
      sourceHandle: sourceCol ? `${sourceTable.id}__${sourceCol.name}__src` : undefined,
      targetHandle: targetCol ? `${targetTable.id}__${targetCol.name}__tgt` : undefined,
      type: 'schemaRelation',
      animated: true,
      data: { label: rel.fromColumn, cardinality: rel.cardinality },
    }];
  });

  return { nodes, edges };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function exportForFile(graph: SchemaGraph, filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'prisma') return toPrismaSchema(graph);
  if (ext === 'ts' || ext === 'js') return toDrizzleSchema(graph);
  return toSqlDdl(graph);
}

const SQLITE_EXTS = new Set(['db', 'sqlite', 'sqlite3']);

function isSqliteFile(filePath: string): boolean {
  return SQLITE_EXTS.has(filePath.split('.').pop()?.toLowerCase() ?? '');
}

async function loadSqliteGraph(dbPath: string): Promise<SchemaGraph> {
  const extracted = await tauriInvoke('db_extract_schema', { dbPath });
  return {
    tables: extracted.map((t) => ({
      id: t.name.toLowerCase(),
      name: t.name,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.col_type || 'TEXT',
        nullable: !c.not_null,
        isPrimary: c.is_pk,
        isForeign: t.foreign_keys.some((fk) => fk.from_col === c.name),
        isUnique: false,
        defaultValue: c.default_value ?? undefined,
      })),
    })),
    relations: extracted.flatMap((t) =>
      t.foreign_keys.map((fk) => ({
        id: `${t.name.toLowerCase()}_${fk.from_col}_${fk.to_table.toLowerCase()}_${fk.id}`,
        fromTable: t.name.toLowerCase(),
        fromColumn: fk.from_col,
        toTable: fk.to_table.toLowerCase(),
        toColumn: fk.to_col,
        cardinality: 'N-1' as const,
      })),
    ),
  };
}

// ─── Stable RF props (outside component to avoid new refs per render) ─────────

const FIT_VIEW_OPTIONS = { padding: 0.15 };
const CANVAS_STYLE: React.CSSProperties = { backgroundColor: 'var(--background)' };
const PRO_OPTIONS = { hideAttribution: true };
const MINIMAP_NODE_COLOR = () => 'var(--muted)';
const DEFAULT_EDGE_OPTIONS = {
  type: 'schemaRelation' as const,
};
const CONNECTION_LINE_STYLE: React.CSSProperties = {
  stroke: 'color-mix(in oklch, var(--primary) 60%, transparent)',
  strokeWidth: 2,
};

// ─── Main component ────────────────────────────────────────────────────────

interface DbSchemaViewerProps {
  sourceFile?: string | null;
}

function DbSchemaViewerInner({ sourceFile }: DbSchemaViewerProps) {
  // ── Selective store subscriptions (only re-render on these specific fields) ──
  const tables = useSchemaDiagramStore((s) => s.tables);
  const relations = useSchemaDiagramStore((s) => s.relations);
  const tableCount = useSchemaDiagramStore((s) => s.tables.length);

  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const selectedEdgeIdsRef = useRef<string[]>([]);

  // ── Load source file on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!sourceFile || initialized) return;
    setLoading(true);
    const load = isSqliteFile(sourceFile)
      ? loadSqliteGraph(sourceFile)
      : tauriInvoke('read_file', { path: sourceFile }).then((content) => {
          const type = detectSourceType(sourceFile, content);
          return parseSchema(content, type);
        });
    load
      .then((graph) => useSchemaDiagramStore.getState().loadGraph(graph, sourceFile))
      .catch(() => useSchemaDiagramStore.getState().loadGraph({ tables: [], relations: [] }, sourceFile))
      .finally(() => { setLoading(false); setInitialized(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFile]);

  // ── Sync store → React Flow nodes/edges ───────────────────────────────
  useEffect(() => {
    // Read nodePositions fresh (not subscribed — avoids re-render on every drag)
    const { nodePositions } = useSchemaDiagramStore.getState();
    const { nodes: fn, edges: fe } = graphToFlow({ tables, relations }, nodePositions);

    const hasPositions = Object.keys(nodePositions).length > 0;
    if (!hasPositions && fn.length > 0) {
      const { nodes: ln, edges: le } = buildLayout(fn, fe);
      const positions: Record<string, { x: number; y: number }> = {};
      ln.forEach((n) => { positions[n.id] = n.position; });
      useSchemaDiagramStore.getState().setNodePositions(positions);
      setNodes(ln);
      setEdges(le);
      setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 50);
    } else {
      setNodes(fn);
      setEdges(fe);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, relations]);

  // ── Read-only guard (SQLite binaries cannot be overwritten with DDL) ──
  const isReadOnly = sourceFile ? isSqliteFile(sourceFile) : false;

  // ── File → Diagram watch (skip for SQLite binaries) ───────────────────
  useEffect(() => {
    if (!sourceFile || isReadOnly) return;
    let unlisten: (() => void) | undefined;

    tauriInvoke('fs_watch', { path: sourceFile }).catch(() => {});
    listen<{ kind: string; paths: string[] }>('fs:changed', (event) => {
      const changed = event.payload.paths.some((p) =>
        p.replace(/\\/g, '/') === sourceFile.replace(/\\/g, '/'),
      );
      if (!changed || event.payload.kind !== 'modify') return;
      tauriInvoke('read_file', { path: sourceFile })
        .then((content) => {
          const type = detectSourceType(sourceFile, content);
          useSchemaDiagramStore.getState().loadGraph(parseSchema(content, type), sourceFile);
        })
        .catch(() => {});
    }).then((fn) => { unlisten = fn; }).catch(() => {});

    return () => {
      unlisten?.();
      tauriInvoke('fs_unwatch', { path: sourceFile }).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFile]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const s = useSchemaDiagramStore.getState();
        s.selectedIds.forEach((id) => s.removeTable(id));
        s.setSelected([]);
        const edgeIds = selectedEdgeIdsRef.current;
        edgeIds.forEach((id) => useSchemaDiagramStore.getState().removeRelation(id));
        selectedEdgeIdsRef.current = [];
        setEdges((eds) => eds.filter((e) => !edgeIds.includes(e.id)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        useSchemaDiagramStore.getState().undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        useSchemaDiagramStore.getState().redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setEdges]);

  // ── Drag & drop files ──────────────────────────────────────────────────
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      const graphs: SchemaGraph[] = [];

      for (const file of files) {
        const text = await file.text();
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        const type = ext === 'sql' ? 'sql' : ext === 'prisma' ? 'prisma' : 'drizzle';
        graphs.push(parseSchema(text, type));
      }

      if (graphs.length > 0) {
        const merged: SchemaGraph = {
          tables: graphs.flatMap((g) => g.tables),
          relations: graphs.flatMap((g) => g.relations),
        };
        useSchemaDiagramStore.getState().loadGraph(merged);
      }
    };

    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
    };
  }, []);

  // ── Toolbar actions ────────────────────────────────────────────────────
  const handleAutoLayout = useCallback((direction: 'LR' | 'TB' = 'LR') => {
    const { nodes: ln, edges: le } = buildLayout(nodes, edges, direction);
    const positions: Record<string, { x: number; y: number }> = {};
    ln.forEach((n) => { positions[n.id] = n.position; });
    useSchemaDiagramStore.getState().setNodePositions(positions);
    setNodes(ln);
    setEdges(le);
    requestAnimationFrame(() => {
      setTimeout(() => fitView({ padding: 0.15, duration: 500 }), 50);
    });
  }, [nodes, edges, setNodes, setEdges, fitView]);

  const handleOpenFile = useCallback(async () => {
    const path = await openFileDialog({
      filters: [{ name: 'Schema files', extensions: ['sql', 'prisma', 'ts', 'js'] }],
    });
    if (!path) return;
    const content = await tauriInvoke('read_file', { path });
    const type = detectSourceType(path, content);
    const graph = parseSchema(content, type);
    useSchemaDiagramStore.getState().loadGraph(graph, path);
  }, []);

  const handleConnectSqlite = useCallback(async () => {
    const path = await openFileDialog({
      filters: [{ name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    if (!path) return;
    setLoading(true);
    try {
      const graph = await loadSqliteGraph(path);
      useSchemaDiagramStore.getState().loadGraph(graph, path);
    } catch (err) {
      console.error('Failed to extract schema:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAddTable = useCallback(() => {
    const id = `table_${Date.now()}`;
    const s = useSchemaDiagramStore.getState();
    s.addTable({
      id,
      name: 'new_table',
      columns: [{ name: 'id', type: 'INTEGER', nullable: false, isPrimary: true, isForeign: false, isUnique: true }],
    });
    s.setNodePosition(id, { x: 100 + Math.random() * 300, y: 100 + Math.random() * 200 });
  }, []);

  const handleSaveToFile = useCallback(async () => {
    if (!sourceFile) return;
    const { tables: t, relations: r } = useSchemaDiagramStore.getState();
    await tauriInvoke('write_file', { path: sourceFile, content: exportForFile({ tables: t, relations: r }, sourceFile) }).catch(() => {});
  }, [sourceFile]);

  const handleReloadFromFile = useCallback(async () => {
    if (!sourceFile) return;
    setLoading(true);
    try {
      const graph = isSqliteFile(sourceFile)
        ? await loadSqliteGraph(sourceFile)
        : await tauriInvoke('read_file', { path: sourceFile }).then((c) => parseSchema(c, detectSourceType(sourceFile, c)));
      useSchemaDiagramStore.getState().loadGraph(graph, sourceFile);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [sourceFile]);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      const relId = `${params.source}_${params.target}_${Date.now()}`;
      useSchemaDiagramStore.getState().addRelation({
        id: relId,
        fromTable: params.source,
        fromColumn: params.sourceHandle?.split('__')[1] ?? 'id',
        toTable: params.target,
        toColumn: params.targetHandle?.split('__')[1] ?? 'id',
        cardinality: 'N-1',
      });
      setEdges((eds) => addEdge({
        ...params,
        type: 'schemaRelation',
        id: relId,
        animated: true,
        data: { cardinality: 'N-1' },
      }, eds));
    },
    [setEdges],
  );

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    useSchemaDiagramStore.getState().setNodePosition(node.id, node.position);
  }, []);

  const onSelectionChange = useCallback(({ nodes: sel, edges: selEdges }: { nodes: Node[]; edges: Edge[] }) => {
    useSchemaDiagramStore.getState().setSelected(sel.map((n) => n.id));
    selectedEdgeIdsRef.current = selEdges.map((e) => e.id);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SchemaToolbar
        onAutoLayout={handleAutoLayout}
        onZoomIn={() => zoomIn({ duration: 200 })}
        onZoomOut={() => zoomOut({ duration: 200 })}
        onFitView={() => fitView({ padding: 0.1, duration: 300 })}
        onOpenFile={handleOpenFile}
        onConnectSqlite={handleConnectSqlite}
        onAddTable={handleAddTable}
        onSaveToFile={sourceFile && !isReadOnly ? handleSaveToFile : undefined}
        onReloadFromFile={sourceFile ? handleReloadFromFile : undefined}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div ref={dropRef} className="flex-1 overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onSelectionChange={onSelectionChange}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            minZoom={0.1}
            maxZoom={3}
            deleteKeyCode={null}
            proOptions={PRO_OPTIONS}
            style={CANVAS_STYLE}
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            connectionLineStyle={CONNECTION_LINE_STYLE}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="opacity-20" />
            <Controls showInteractive={false} className="!bg-card !border-border/40 !rounded-md !shadow-sm" />
            <MiniMap
              nodeColor={MINIMAP_NODE_COLOR}
              maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
              className="!bg-card !border-border/40 !rounded-md"
            />

            {/* Sidebar toggle */}
            <Panel position="top-right">
              <button
                className="flex items-center gap-1 rounded-md border border-border/40 bg-card px-2 py-1.5 text-[11px] text-muted-foreground shadow-sm hover:text-foreground"
                onClick={() => setShowSidebar((v) => !v)}
                title="Toggle properties panel"
              >
                {showSidebar
                  ? <PanelRightClose className="h-3.5 w-3.5" />
                  : <PanelRightOpen className="h-3.5 w-3.5" />}
              </button>
            </Panel>

            {/* Empty state */}
            {tableCount === 0 && (
              <Panel position="top-center">
                <div className="mt-16 flex flex-col items-center gap-2 text-center">
                  <p className="text-[13px] font-medium text-foreground/60">No schema loaded</p>
                  <p className="text-[11px] text-muted-foreground">
                    Drop a .sql, .prisma, or Drizzle .ts file here,<br />
                    click <strong>Open file</strong>, or connect to a <strong>SQLite</strong> database.
                  </p>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>

        {/* Properties sidebar */}
        {showSidebar && <SchemaSidebar onClose={() => setShowSidebar(false)} />}
      </div>
    </div>
  );
}

// Wrap with ReactFlowProvider at this level
export function DbSchemaViewer({ sourceFile }: DbSchemaViewerProps) {
  return (
    <ReactFlowProvider>
      <DbSchemaViewerInner sourceFile={sourceFile} />
    </ReactFlowProvider>
  );
}

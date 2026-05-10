import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { SchemaGraph, SchemaTable, SchemaColumn, SchemaRelation } from '../lib/schema-parsers/types';

export type { SchemaGraph, SchemaTable, SchemaColumn, SchemaRelation };

export interface NodePosition {
  x: number;
  y: number;
}

interface SchemaDiagramState {
  // Schema data
  tables: SchemaTable[];
  relations: SchemaRelation[];
  // Layout positions keyed by table id
  nodePositions: Record<string, NodePosition>;
  // Source tracking
  sourceFile: string | null;
  diagramId: string | null;
  diagramName: string;
  // UI state
  selectedIds: string[];
  isDirty: boolean;
  // Undo/redo
  past: Array<{ tables: SchemaTable[]; relations: SchemaRelation[]; nodePositions: Record<string, NodePosition> }>;
  future: Array<{ tables: SchemaTable[]; relations: SchemaRelation[]; nodePositions: Record<string, NodePosition> }>;

  // Actions
  loadGraph: (graph: SchemaGraph, sourceFile?: string | null) => void;
  reset: () => void;

  addTable: (table: SchemaTable) => void;
  updateTable: (id: string, patch: Partial<Omit<SchemaTable, 'id'>>) => void;
  removeTable: (id: string) => void;

  addColumn: (tableId: string, column: SchemaColumn) => void;
  updateColumn: (tableId: string, colName: string, patch: Partial<SchemaColumn>) => void;
  removeColumn: (tableId: string, colName: string) => void;

  addRelation: (relation: SchemaRelation) => void;
  removeRelation: (id: string) => void;

  setNodePosition: (tableId: string, pos: NodePosition) => void;
  setNodePositions: (positions: Record<string, NodePosition>) => void;

  setSelected: (ids: string[]) => void;
  setDiagramName: (name: string) => void;
  markDirty: (dirty: boolean) => void;

  undo: () => void;
  redo: () => void;
}

function snapshot(state: SchemaDiagramState) {
  return {
    tables: JSON.parse(JSON.stringify(state.tables)),
    relations: JSON.parse(JSON.stringify(state.relations)),
    nodePositions: JSON.parse(JSON.stringify(state.nodePositions)),
  };
}

export const useSchemaDiagramStore = create<SchemaDiagramState>()(
  immer((set) => ({
    tables: [],
    relations: [],
    nodePositions: {},
    sourceFile: null,
    diagramId: null,
    diagramName: 'New Schema Diagram',
    selectedIds: [],
    isDirty: false,
    past: [],
    future: [],

    loadGraph: (graph, sourceFile) =>
      set((state) => {
        state.past = [];
        state.future = [];
        state.tables = graph.tables;
        state.relations = graph.relations;
        state.nodePositions = {};
        state.sourceFile = sourceFile ?? null;
        state.isDirty = false;
        state.selectedIds = [];
      }),

    reset: () =>
      set((state) => {
        state.tables = [];
        state.relations = [];
        state.nodePositions = {};
        state.sourceFile = null;
        state.diagramId = null;
        state.isDirty = false;
        state.selectedIds = [];
        state.past = [];
        state.future = [];
      }),

    addTable: (table) =>
      set((state) => {
        state.past.push(snapshot(state));
        state.future = [];
        state.tables.push(table);
        state.isDirty = true;
      }),

    updateTable: (id, patch) =>
      set((state) => {
        state.past.push(snapshot(state));
        state.future = [];
        const t = state.tables.find((t) => t.id === id);
        if (t) Object.assign(t, patch);
        state.isDirty = true;
      }),

    removeTable: (id) =>
      set((state) => {
        state.past.push(snapshot(state));
        state.future = [];
        state.tables = state.tables.filter((t) => t.id !== id);
        state.relations = state.relations.filter((r) => r.fromTable !== id && r.toTable !== id);
        delete state.nodePositions[id];
        state.isDirty = true;
      }),

    addColumn: (tableId, column) =>
      set((state) => {
        state.past.push(snapshot(state));
        state.future = [];
        const t = state.tables.find((t) => t.id === tableId);
        if (t) t.columns.push(column);
        state.isDirty = true;
      }),

    updateColumn: (tableId, colName, patch) =>
      set((state) => {
        state.past.push(snapshot(state));
        state.future = [];
        const t = state.tables.find((t) => t.id === tableId);
        const c = t?.columns.find((c) => c.name === colName);
        if (c) Object.assign(c, patch);
        state.isDirty = true;
      }),

    removeColumn: (tableId, colName) =>
      set((state) => {
        state.past.push(snapshot(state));
        state.future = [];
        const t = state.tables.find((t) => t.id === tableId);
        if (t) t.columns = t.columns.filter((c) => c.name !== colName);
        state.isDirty = true;
      }),

    addRelation: (relation) =>
      set((state) => {
        state.past.push(snapshot(state));
        state.future = [];
        state.relations.push(relation);
        state.isDirty = true;
      }),

    removeRelation: (id) =>
      set((state) => {
        state.past.push(snapshot(state));
        state.future = [];
        state.relations = state.relations.filter((r) => r.id !== id);
        state.isDirty = true;
      }),

    setNodePosition: (tableId, pos) =>
      set((state) => {
        const prev = state.nodePositions[tableId];
        if (prev && prev.x === pos.x && prev.y === pos.y) return;
        state.nodePositions[tableId] = pos;
      }),

    setNodePositions: (positions) =>
      set((state) => {
        const prev = state.nodePositions;
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(positions);
        if (prevKeys.length === nextKeys.length) {
          let same = true;
          for (const key of nextKeys) {
            const a = prev[key];
            const b = positions[key];
            if (!a || a.x !== b.x || a.y !== b.y) {
              same = false;
              break;
            }
          }
          if (same) return;
        }
        state.nodePositions = positions;
      }),

    setSelected: (ids) =>
      set((state) => {
        if (
          state.selectedIds.length === ids.length
          && state.selectedIds.every((id, i) => id === ids[i])
        ) {
          return;
        }
        state.selectedIds = ids;
      }),

    setDiagramName: (name) =>
      set((state) => {
        state.diagramName = name;
        state.isDirty = true;
      }),

    markDirty: (dirty) =>
      set((state) => {
        state.isDirty = dirty;
      }),

    undo: () =>
      set((state) => {
        const prev = state.past.pop();
        if (!prev) return;
        state.future.push(snapshot(state));
        state.tables = prev.tables;
        state.relations = prev.relations;
        state.nodePositions = prev.nodePositions;
        state.isDirty = true;
      }),

    redo: () =>
      set((state) => {
        const next = state.future.pop();
        if (!next) return;
        state.past.push(snapshot(state));
        state.tables = next.tables;
        state.relations = next.relations;
        state.nodePositions = next.nodePositions;
        state.isDirty = true;
      }),
  })),
);

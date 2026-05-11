import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  DbConnection,
  DbTableInfo,
  QueryResult,
  ExecuteResult,
} from '../lib/db-engine';

export type DbViewerTab = 'schema' | 'data' | 'query' | 'diagram';

export interface EditingCell {
  rowIndex: number;
  column: string;
  value: unknown;
}

export interface PendingChange {
  rowIndex: number;
  column: string;
  oldValue: unknown;
  newValue: unknown;
}

interface DbViewerState {
  // Connection
  connection: DbConnection | null;
  isConnecting: boolean;
  connectionError: string | null;

  // Schema
  tables: string[];
  views: string[];
  selectedTable: string | null;
  tableInfo: DbTableInfo | null;

  // Data
  tableData: Array<Record<string, unknown>>;
  tableDataTotal: number;
  page: number;
  pageSize: number;

  // Pending changes (unsaved edits)
  pendingChanges: Map<string, PendingChange>;
  isSaving: boolean;

  // Query
  queryText: string;
  queryResult: QueryResult | null;
  queryExecuteResult: ExecuteResult | null;
  queryHistory: string[];

  // UI
  activeTab: DbViewerTab;
  isLoading: boolean;
  error: string | null;
  editingCell: EditingCell | null;

  // Actions
  setConnection: (conn: DbConnection | null) => void;
  setConnecting: (value: boolean) => void;
  setConnectionError: (error: string | null) => void;
  setTables: (tables: string[]) => void;
  setViews: (views: string[]) => void;
  selectTable: (table: string | null) => void;
  setTableInfo: (info: DbTableInfo | null) => void;
  setTableData: (data: Array<Record<string, unknown>>, total: number) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  stageCellChange: (rowIndex: number, column: string, oldValue: unknown, newValue: unknown) => void;
  clearPendingChanges: () => void;
  setIsSaving: (value: boolean) => void;
  setQueryText: (text: string) => void;
  setQueryResult: (result: QueryResult | null) => void;
  setQueryExecuteResult: (result: ExecuteResult | null) => void;
  addToQueryHistory: (query: string) => void;
  setActiveTab: (tab: DbViewerTab) => void;
  setLoading: (value: boolean) => void;
  setError: (error: string | null) => void;
  setEditingCell: (cell: EditingCell | null) => void;
  updateCellValue: (rowIndex: number, column: string, value: unknown) => void;
  reset: () => void;
}

const DEFAULT_PAGE_SIZE = 100;

const initialState = {
  connection: null,
  isConnecting: false,
  connectionError: null,
  tables: [],
  views: [],
  selectedTable: null,
  tableInfo: null,
  tableData: [],
  tableDataTotal: 0,
  page: 0,
  pageSize: DEFAULT_PAGE_SIZE,
  pendingChanges: new Map<string, PendingChange>(),
  isSaving: false,
  queryText: '',
  queryResult: null,
  queryExecuteResult: null,
  queryHistory: [],
  activeTab: 'data' as DbViewerTab,
  isLoading: false,
  error: null,
  editingCell: null,
};

export const useDbViewerStore = create<DbViewerState>()(
  immer((set) => ({
    ...initialState,

    setConnection: (conn) =>
      set((state) => {
        state.connection = conn;
      }),

    setConnecting: (value) =>
      set((state) => {
        state.isConnecting = value;
      }),

    setConnectionError: (error) =>
      set((state) => {
        state.connectionError = error;
      }),

    setTables: (tables) =>
      set((state) => {
        state.tables = tables;
      }),

    setViews: (views) =>
      set((state) => {
        state.views = views;
      }),

    selectTable: (table) =>
      set((state) => {
        state.selectedTable = table;
        state.page = 0;
        state.tableData = [];
        state.tableDataTotal = 0;
        state.tableInfo = null;
        state.queryResult = null;
        state.queryExecuteResult = null;
        state.editingCell = null;
        state.pendingChanges = new Map();
        // If user selects a table, switch to data tab
        if (table) {
          state.activeTab = 'data';
        }
      }),

    setTableInfo: (info) =>
      set((state) => {
        state.tableInfo = info;
      }),

    setTableData: (data, total) =>
      set((state) => {
        state.tableData = data;
        state.tableDataTotal = total;
      }),

    setPage: (page) =>
      set((state) => {
        state.page = page;
      }),

    setPageSize: (size) =>
      set((state) => {
        state.pageSize = size;
        state.page = 0;
      }),

    stageCellChange: (rowIndex, column, oldValue, newValue) =>
      set((state) => {
        const key = `${rowIndex}:${column}`;
        // If new value equals old value, remove pending change
        if (newValue === oldValue || (newValue === '' && (oldValue === null || oldValue === undefined))) {
          state.pendingChanges.delete(key);
        } else {
          state.pendingChanges.set(key, { rowIndex, column, oldValue, newValue });
        }
        // Apply optimistic update to tableData
        if (state.tableData[rowIndex]) {
          state.tableData[rowIndex][column] = newValue;
        }
      }),

    clearPendingChanges: () =>
      set((state) => {
        state.pendingChanges = new Map();
      }),

    setIsSaving: (value) =>
      set((state) => {
        state.isSaving = value;
      }),

    setQueryText: (text) =>
      set((state) => {
        state.queryText = text;
      }),

    setQueryResult: (result) =>
      set((state) => {
        state.queryResult = result;
        state.queryExecuteResult = null;
      }),

    setQueryExecuteResult: (result) =>
      set((state) => {
        state.queryExecuteResult = result;
        state.queryResult = null;
      }),

    addToQueryHistory: (query) =>
      set((state) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        // Remove duplicate if exists at top
        const idx = state.queryHistory.indexOf(trimmed);
        if (idx >= 0) {
          state.queryHistory.splice(idx, 1);
        }
        state.queryHistory.unshift(trimmed);
        // Keep last 50
        if (state.queryHistory.length > 50) {
          state.queryHistory.pop();
        }
      }),

    setActiveTab: (tab) =>
      set((state) => {
        state.activeTab = tab;
      }),

    setLoading: (value) =>
      set((state) => {
        state.isLoading = value;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),

    setEditingCell: (cell) =>
      set((state) => {
        state.editingCell = cell;
      }),

    updateCellValue: (rowIndex, column, value) =>
      set((state) => {
        if (state.tableData[rowIndex]) {
          state.tableData[rowIndex][column] = value;
        }
      }),

    reset: () => set(() => ({ ...initialState })),
  })),
);

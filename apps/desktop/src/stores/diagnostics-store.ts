import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import {
  diagnosticPathsEqual,
  type DiagnosticContract,
} from '../lib/diagnostics-types';

enableMapSet();

export interface FileDiagnostics {
  errors: number;
  warnings: number;
}

interface DiagnosticsState {
  diagnostics: Map<string, FileDiagnostics>;
  details: Map<string, DiagnosticContract[]>;
  openFiles: Map<string, true>;
  setDiagnostics: (path: string, counts: FileDiagnostics) => void;
  clearDiagnostics: (path: string) => void;
  setModelDiagnostics: (path: string, diagnostics: DiagnosticContract[]) => void;
  clearModelDiagnostics: (path: string) => void;
  clearAll: () => void;
}

function findPathKey<T>(map: Map<string, T>, path: string): string | undefined {
  for (const key of map.keys()) {
    if (diagnosticPathsEqual(key, path)) return key;
  }
  return undefined;
}

export const useDiagnosticsStore = create<DiagnosticsState>()(
  immer((set) => ({
    diagnostics: new Map(),
    details: new Map(),
    openFiles: new Map(),

    setDiagnostics: (path, counts) =>
      set((state) => {
        const key = findPathKey(state.diagnostics, path) ?? path;
        state.diagnostics.set(key, counts);
      }),

    clearDiagnostics: (path) =>
      set((state) => {
        const key =
          findPathKey(state.details, path) ??
          findPathKey(state.openFiles, path) ??
          findPathKey(state.diagnostics, path) ??
          path;
        state.diagnostics.delete(key);
        state.details.delete(key);
        state.openFiles.delete(key);
      }),

    setModelDiagnostics: (path, diagnostics) =>
      set((state) => {
        const key =
          findPathKey(state.details, path) ??
          findPathKey(state.openFiles, path) ??
          findPathKey(state.diagnostics, path) ??
          path;
        const counts = diagnostics.reduce<FileDiagnostics>(
          (result, diagnostic) => {
            if (diagnostic.severity === 'error') result.errors += 1;
            if (diagnostic.severity === 'warning') result.warnings += 1;
            return result;
          },
          { errors: 0, warnings: 0 },
        );
        state.openFiles.set(key, true);
        state.details.set(key, diagnostics);
        if (counts.errors === 0 && counts.warnings === 0) {
          state.diagnostics.delete(key);
        } else {
          state.diagnostics.set(key, counts);
        }
      }),

    clearModelDiagnostics: (path) =>
      set((state) => {
        const key =
          findPathKey(state.details, path) ??
          findPathKey(state.openFiles, path) ??
          findPathKey(state.diagnostics, path);
        if (!key) return;
        state.diagnostics.delete(key);
        state.details.delete(key);
        state.openFiles.delete(key);
      }),

    clearAll: () =>
      set((state) => {
        state.diagnostics.clear();
        state.details.clear();
        state.openFiles.clear();
      }),
  })),
);

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticContract } from './diagnostics-types';
import {
  getEditorDiagnostics,
  getOpenDiagnosticFiles,
  initDiagnosticsTracker,
  uriToPath,
} from './diagnostics-tracker';
import { useDiagnosticsStore } from '../stores/diagnostics-store';

type FakeModel = {
  uri: { toString: () => string };
};

type FakeMonaco = {
  editor: {
    setModelMarkers: (
      model: FakeModel,
      owner: string,
      markers: Array<Record<string, unknown>>,
    ) => void;
    getModelMarkers: (options: { resource: FakeModel['uri'] }) => Array<Record<string, unknown>>;
    getModels: () => FakeModel[];
    onWillDisposeModel: (listener: (model: FakeModel) => void) => { dispose: () => void };
  };
};

function createFakeMonaco(uri: string): {
  monaco: FakeMonaco;
  model: FakeModel;
  setMarkers: (owner: string, markers: Array<Record<string, unknown>>) => void;
  disposeModel: () => void;
} {
  const model: FakeModel = { uri: { toString: () => uri } };
  const owners = new Map<string, Array<Record<string, unknown>>>();
  let disposeListener: ((model: FakeModel) => void) | undefined;
  const setModelMarkers = vi.fn(
    (_model: FakeModel, owner: string, markers: Array<Record<string, unknown>>) => {
      owners.set(owner, markers);
    },
  );
  const monaco: FakeMonaco = {
    editor: {
      setModelMarkers,
      getModelMarkers: () => Array.from(owners.values()).flat(),
      getModels: () => [model],
      onWillDisposeModel: (listener) => {
        disposeListener = listener;
        return { dispose: () => undefined };
      },
    },
  };
  return {
    monaco,
    model,
    setMarkers: (owner, markers) => monaco.editor.setModelMarkers(model, owner, markers),
    disposeModel: () => disposeListener?.(model),
  };
}

function marker(
  severity: number,
  message: string,
  line: number,
  col: number,
  source: string,
): Record<string, unknown> {
  return {
    severity,
    message,
    startLineNumber: line,
    startColumn: col,
    endLineNumber: line,
    endColumn: col + 1,
    source,
  };
}

describe('diagnostics tracker', () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clearAll();
  });

  it('decodes Windows, POSIX and UNC file URIs', () => {
    expect(uriToPath('file:///C:/Workspace/folder%20with%20spaces/app.ts')).toBe(
      'C:\\Workspace\\folder with spaces\\app.ts',
    );
    expect(uriToPath('file:///home/user/project/app.ts')).toBe('/home/user/project/app.ts');
    expect(uriToPath('file://server/share/folder%20name/app.ts')).toBe(
      '\\\\server\\share\\folder name\\app.ts',
    );
  });

  it('initializes against existing models, aggregates owners and preserves model details', () => {
    const fake = createFakeMonaco('file:///C:/Workspace/folder%20with%20spaces/app.ts');
    fake.monaco.editor.setModelMarkers(
      fake.model,
      'lsp',
      [marker(8, 'Initial error', 2, 3, 'lsp')],
    );
    initDiagnosticsTracker(fake.monaco as unknown as typeof import('monaco-editor'));

    fake.setMarkers('typescript', [marker(4, 'Type warning', 5, 1, 'typescript')]);

    const file = 'C:\\Workspace\\folder with spaces\\app.ts';
    const details = useDiagnosticsStore.getState().details.get(file) as DiagnosticContract[];
    expect(details).toHaveLength(2);
    expect(getEditorDiagnostics(file).map((item) => item.message)).toEqual([
      'Initial error',
      'Type warning',
    ]);
    expect(useDiagnosticsStore.getState().diagnostics.get(file)).toEqual({ errors: 1, warnings: 1 });
    expect(getOpenDiagnosticFiles()).toEqual([file]);
  });

  it('removes only the replaced owner and clears open state on model disposal', () => {
    const fake = createFakeMonaco('file:///C:/Workspace/app.ts');
    initDiagnosticsTracker(fake.monaco as unknown as typeof import('monaco-editor'));
    fake.setMarkers('lsp', [marker(8, 'Error', 1, 1, 'lsp')]);
    fake.setMarkers('typescript', [marker(4, 'Warning', 2, 1, 'typescript')]);
    fake.setMarkers('lsp', []);

    expect(getEditorDiagnostics('c:/workspace/app.ts')).toHaveLength(1);
    expect(getEditorDiagnostics('c:/workspace/app.ts')[0].message).toBe('Warning');

    fake.disposeModel();
    expect(getEditorDiagnostics('C:/Workspace/app.ts')).toEqual([]);
    expect(getOpenDiagnosticFiles()).toEqual([]);
    expect(useDiagnosticsStore.getState().diagnostics.size).toBe(0);
  });
});

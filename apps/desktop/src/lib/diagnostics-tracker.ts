import {
  diagnosticPathsEqual,
  uriToDiagnosticPath,
  type DiagnosticContract,
  type DiagnosticSeverity,
} from './diagnostics-types';
import { useDiagnosticsStore } from '../stores/diagnostics-store';

const initializedMonacoInstances = new WeakSet<object>();

export function uriToPath(uri: string): string | null {
  return uriToDiagnosticPath(uri);
}

function markerSeverity(severity: number | undefined): DiagnosticSeverity {
  if (severity === 8) return 'error';
  if (severity === 4) return 'warning';
  if (severity === 2) return 'info';
  return 'hint';
}

function markerToDiagnostic(
  file: string,
  marker: import('monaco-editor').editor.IMarker,
): DiagnosticContract {
  const code =
    typeof marker.code === 'string' || typeof marker.code === 'number' ? marker.code : undefined;
  return {
    file,
    line: Math.max(1, marker.startLineNumber),
    col: Math.max(1, marker.startColumn),
    severity: markerSeverity(marker.severity),
    message: marker.message,
    source: marker.source ?? 'monaco',
    ...(code === undefined ? {} : { code }),
  };
}

function syncModel(
  monaco: typeof import('monaco-editor'),
  model: import('monaco-editor').editor.ITextModel,
): void {
  const file = uriToPath(model.uri.toString());
  if (!file) return;
  const markers = monaco.editor.getModelMarkers({ resource: model.uri });
  const diagnostics = markers.map((marker) => markerToDiagnostic(file, marker));
  useDiagnosticsStore.getState().setModelDiagnostics(file, diagnostics);
}

export function getEditorDiagnostics(file?: string): DiagnosticContract[] {
  const details = useDiagnosticsStore.getState().details;
  const diagnostics = Array.from(details.entries()).flatMap(([, items]) =>
    items
      .filter((item) => item.severity === 'error' || item.severity === 'warning')
      .filter((item) => !file || diagnosticPathsEqual(item.file, file))
      .map((item) => ({ ...item })),
  );
  if (!file) return diagnostics;
  return diagnostics.filter((item) => diagnosticPathsEqual(item.file, file));
}

export function getOpenDiagnosticFiles(): string[] {
  return Array.from(useDiagnosticsStore.getState().openFiles.keys());
}

export function initDiagnosticsTracker(monaco: typeof import('monaco-editor')): void {
  if (initializedMonacoInstances.has(monaco)) return;
  initializedMonacoInstances.add(monaco);

  const originalSetModelMarkers = monaco.editor.setModelMarkers;
  monaco.editor.setModelMarkers = function setModelMarkers(
    model: import('monaco-editor').editor.ITextModel,
    _owner: string,
    markers: import('monaco-editor').editor.IMarkerData[],
  ) {
    originalSetModelMarkers.call(monaco.editor, model, _owner, markers);
    syncModel(monaco, model);
  };

  monaco.editor.onWillDisposeModel((model) => {
    const file = uriToPath(model.uri.toString());
    if (file) useDiagnosticsStore.getState().clearModelDiagnostics(file);
  });

  for (const model of monaco.editor.getModels()) syncModel(monaco, model);
}

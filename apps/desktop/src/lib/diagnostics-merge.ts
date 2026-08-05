import {
  diagnosticPathKey,
  diagnosticPathsEqual,
  type DiagnosticContract,
} from './diagnostics-types';

const SEVERITY_ORDER: Record<DiagnosticContract['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

export function mergeDiagnostics(
  editorDiagnostics: DiagnosticContract[],
  compilerDiagnostics: DiagnosticContract[],
  openFiles: string[],
  requestedFile?: string,
): DiagnosticContract[] {
  const targetIsOpen =
    requestedFile !== undefined &&
    openFiles.some((openFile) => diagnosticPathsEqual(openFile, requestedFile));
  const openFileHasCurrentState = (file: string): boolean =>
    openFiles.some((openFile) => diagnosticPathsEqual(openFile, file));

  const editor = editorDiagnostics.filter(
    (diagnostic) => !requestedFile || diagnosticPathsEqual(diagnostic.file, requestedFile),
  );
  const compiler = compilerDiagnostics.filter((diagnostic) => {
    if (requestedFile && !diagnosticPathsEqual(diagnostic.file, requestedFile)) return false;
    if (openFileHasCurrentState(diagnostic.file)) return false;
    return !(requestedFile && targetIsOpen);
  });

  const merged = new Map<string, DiagnosticContract>();
  for (const diagnostic of [...editor, ...compiler]) {
    const key = [
      diagnosticPathKey(diagnostic.file),
      diagnostic.line,
      diagnostic.col,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.source,
    ].join('\u{1f}');
    if (!merged.has(key)) merged.set(key, diagnostic);
  }

  return Array.from(merged.values()).sort((left, right) =>
    diagnosticPathKey(left.file)
      .localeCompare(diagnosticPathKey(right.file))
      || left.line - right.line
      || left.col - right.col
      || SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.message.localeCompare(right.message)
      || left.source.localeCompare(right.source),
  );
}

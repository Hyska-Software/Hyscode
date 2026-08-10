import type * as monacoEditor from 'monaco-editor';

export function waitForInlineCompletionDelay(
  delayMs: number,
  token: monacoEditor.CancellationToken,
  signal: AbortSignal,
): Promise<boolean> {
  if (delayMs <= 0) return Promise.resolve(!token.isCancellationRequested && !signal.aborted);

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancellation: { dispose: () => void } | null = null;

    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      cancellation?.dispose();
      cancellation = null;
      signal.removeEventListener('abort', abortHandler);
      resolve(value);
    };

    const abortHandler = (): void => finish(false);
    cancellation = token.onCancellationRequested(() => finish(false));
    signal.addEventListener('abort', abortHandler, { once: true });
    timer = setTimeout(() => finish(true), delayMs);

    if (token.isCancellationRequested || signal.aborted) finish(false);
  });
}

export function isCurrentInlineCompletionSnapshot(
  editor: monacoEditor.editor.IStandaloneCodeEditor,
  model: monacoEditor.editor.ITextModel,
  versionId: number,
  lineNumber: number,
  column: number,
): boolean {
  if (editor.getModel() !== model || model.getVersionId() !== versionId) return false;
  const position = editor.getPosition();
  return position?.lineNumber === lineNumber && position.column === column;
}

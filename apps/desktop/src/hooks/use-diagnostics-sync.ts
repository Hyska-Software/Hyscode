import { useEffect } from 'react';
import { initDiagnosticsTracker } from '../lib/diagnostics-tracker';

export function useDiagnosticsSync(
  monacoRef: React.MutableRefObject<typeof import('monaco-editor') | null>,
  editorVersion: number,
) {
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    initDiagnosticsTracker(monaco);
  }, [monacoRef, editorVersion]);
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { App } from './app';
import './app.css';
// @ts-ignore xterm CSS has no type declarations
import '@xterm/xterm/css/xterm.css';
import 'katex/dist/katex.min.css';

enableMapSet();

// Configure Monaco web workers to use local bundled files (not CDN).
// Without this, production Tauri builds hang forever waiting for jsdelivr.
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// Use locally bundled monaco-editor instead of fetching from CDN.
loader.config({ monaco });

// Disable Monaco's built-in TS semantic validation — LSP provides real diagnostics.
// We keep syntax validation (parsing errors) but disable module/type checking.
// Cast to any because monaco.languages.typescript is marked deprecated in v0.55+ types
// but the runtime API still exists and works.
const tsLang = (monaco.languages as any).typescript;
if (tsLang) {
  tsLang.typescriptDefaults?.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSuggestionDiagnostics: true,
  });
  tsLang.javascriptDefaults?.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSuggestionDiagnostics: true,
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

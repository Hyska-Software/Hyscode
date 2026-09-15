type MonacoModule = typeof import('monaco-editor');
type MonacoReactModule = typeof import('@monaco-editor/react');
type WorkerConstructor = new () => Worker;

type LanguageServiceDefaults = {
  setDiagnosticsOptions: (options: {
    noSemanticValidation: boolean;
    noSuggestionDiagnostics: boolean;
  }) => void;
};

type TypeScriptLanguageServices = {
  typescriptDefaults?: LanguageServiceDefaults;
  javascriptDefaults?: LanguageServiceDefaults;
};

let monacoLoad: Promise<MonacoReactModule> | null = null;

function configureTypeScriptDiagnostics(monaco: MonacoModule): void {
  // The TypeScript language contribution is marked deprecated in Monaco's
  // public types, but its defaults API is still the supported runtime hook.
  const services = Reflect.get(monaco.languages, 'typescript') as
    | TypeScriptLanguageServices
    | undefined;
  if (!services) return;

  const diagnostics = {
    noSemanticValidation: true,
    noSuggestionDiagnostics: true,
  };
  services.typescriptDefaults?.setDiagnosticsOptions(diagnostics);
  services.javascriptDefaults?.setDiagnosticsOptions(diagnostics);
}

function configureMonacoEnvironment(
  editorWorker: WorkerConstructor,
  jsonWorker: WorkerConstructor,
  cssWorker: WorkerConstructor,
  htmlWorker: WorkerConstructor,
  tsWorker: WorkerConstructor,
): void {
  // Configure Monaco web workers to use local bundled files (not CDN).
  // Without this, production Tauri builds can hang waiting for jsdelivr.
  self.MonacoEnvironment = {
    getWorker(_: unknown, label: string): Worker {
      if (label === 'json') return new jsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };
}

/** Loads React Monaco integration and its local editor workers on demand. */
export function loadMonacoEditor(): Promise<MonacoReactModule> {
  if (!monacoLoad) {
    monacoLoad = Promise.all([
      import('@monaco-editor/react'),
      import('monaco-editor'),
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
      import('monaco-editor/esm/vs/language/json/json.worker?worker'),
      import('monaco-editor/esm/vs/language/css/css.worker?worker'),
      import('monaco-editor/esm/vs/language/html/html.worker?worker'),
      import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
    ])
      .then(
        ([
          reactModule,
          monacoModule,
          editorWorkerModule,
          jsonWorkerModule,
          cssWorkerModule,
          htmlWorkerModule,
          tsWorkerModule,
        ]) => {
          configureMonacoEnvironment(
            editorWorkerModule.default,
            jsonWorkerModule.default,
            cssWorkerModule.default,
            htmlWorkerModule.default,
            tsWorkerModule.default,
          );
          reactModule.loader.config({ monaco: monacoModule });
          configureTypeScriptDiagnostics(monacoModule);
          return reactModule;
        },
      )
      .catch((error: unknown) => {
        monacoLoad = null;
        throw error;
      });
  }

  return monacoLoad;
}

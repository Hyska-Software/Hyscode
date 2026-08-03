// ─── Language Registry ────────────────────────────────────────────────────────
// Registers all known languages in Monaco for universal syntax highlighting.
// Covers 40+ languages with proper extension mappings, bracket/comment configs,
// and Monarch tokenizers for languages Monaco doesn't support natively.

import { REACT_SNIPPETS } from './snippets/react-snippets';
import { SPECTRA_SNIPPETS } from './snippets/spectra-snippets';

type MonacoInstance = typeof import('monaco-editor');

// ── Extension → Language ID Mapping ──────────────────────────────────────────

const EXTENSION_MAP: Record<string, string> = {
  // TypeScript / JavaScript
  // Monaco's built-in tokenizer handles tsx/jsx under the base typescript/javascript IDs.
  // The LSP languageId must be typescriptreact/javascriptreact for the server to parse JSX.
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  cts: 'typescript',

  // Web
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  vue: 'html',
  svelte: 'html',

  // Data / Config
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  env: 'ini',
  properties: 'ini',
  cfg: 'ini',
  conf: 'ini',
  xml: 'xml',
  xsl: 'xml',
  xsd: 'xml',
  svg: 'xml',
  plist: 'xml',

  // Python
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  pyx: 'python',
  ipynb: 'json',

  // Rust
  rs: 'rust',

  // Go
  go: 'go',
  mod: 'go',
  sum: 'plaintext',

  // C / C++
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',

  // C#
  cs: 'csharp',
  csx: 'csharp',

  // Java
  java: 'java',

  // PHP
  php: 'php',
  phtml: 'php',

  // Ruby
  rb: 'ruby',
  erb: 'ruby',
  gemspec: 'ruby',
  rake: 'ruby',

  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  bat: 'bat',
  cmd: 'bat',

  // Kotlin
  kt: 'kotlin',
  kts: 'kotlin',

  // Swift
  swift: 'swift',

  // Dart
  dart: 'dart',

  // Lua
  lua: 'lua',

  // R
  r: 'r',
  R: 'r',
  rmd: 'markdown',

  // Perl
  pl: 'perl',
  pm: 'perl',

  // Scala
  scala: 'scala',
  sc: 'scala',

  // Haskell
  hs: 'haskell',
  lhs: 'haskell',

  // Elixir
  ex: 'elixir',
  exs: 'elixir',

  // Zig
  zig: 'zig',

  // Clojure
  clj: 'clojure',
  cljs: 'clojure',
  cljc: 'clojure',
  edn: 'clojure',

  // SQL
  sql: 'sql',
  mysql: 'sql',
  pgsql: 'sql',

  // GraphQL
  graphql: 'graphql',
  gql: 'graphql',

  // Markdown
  md: 'markdown',
  mdx: 'markdown',

  // Docker
  dockerfile: 'dockerfile',

  // Terraform
  tf: 'hcl',
  tfvars: 'hcl',

  // Protocol Buffers
  proto: 'protobuf',

  // Makefile
  mk: 'makefile',

  // Diff / Patch
  diff: 'diff',
  patch: 'diff',

  // Log files
  log: 'log',

  // Assembly
  asm: 'asm',
  s: 'asm',

  // Objective-C
  m: 'objective-c',
  mm: 'objective-c',

  // F#
  fs: 'fsharp',
  fsx: 'fsharp',
  fsi: 'fsharp',

  // OCaml
  ml: 'ocaml',
  mli: 'ocaml',

  // Nim
  nim: 'nim',

  // V
  v: 'v',

  // Wasm
  wat: 'wat',
  wast: 'wat',

  // SpectraLang
  spectra: 'spectra',
  spc: 'spectra',
};

// Filename-based detection (no extension or special filenames)
const FILENAME_MAP: Record<string, string> = {
  Dockerfile: 'dockerfile',
  'Dockerfile.dev': 'dockerfile',
  'Dockerfile.prod': 'dockerfile',
  Makefile: 'makefile',
  GNUmakefile: 'makefile',
  Rakefile: 'ruby',
  Gemfile: 'ruby',
  Vagrantfile: 'ruby',
  '.gitignore': 'ignore',
  '.gitattributes': 'ignore',
  '.dockerignore': 'ignore',
  '.eslintignore': 'ignore',
  '.prettierignore': 'ignore',
  '.npmignore': 'ignore',
  '.env': 'ini',
  '.env.local': 'ini',
  '.env.development': 'ini',
  '.env.production': 'ini',
  '.editorconfig': 'ini',
  'tsconfig.json': 'json',
  'package.json': 'json',
  '.eslintrc': 'json',
  '.prettierrc': 'json',
  '.babelrc': 'json',
  'Cargo.toml': 'toml',
  'go.mod': 'go',
  'go.sum': 'plaintext',
  'CMakeLists.txt': 'cmake',
  Justfile: 'makefile',
  Procfile: 'plaintext',
};

function getExtension(filePath: string): { filename: string; ext: string } {
  const segments = filePath.replace(/\\/g, '/').split('/');
  const filename = segments[segments.length - 1] ?? '';
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() ?? '' : '';
  return { filename, ext };
}

/**
 * Detect Monaco language ID from a file path (for syntax highlighting).
 * Returns 'plaintext' if no match found.
 */
export function detectLanguage(filePath: string): string {
  const { filename, ext } = getExtension(filePath);

  // Check filename first
  if (FILENAME_MAP[filename]) return FILENAME_MAP[filename];

  // Check extension
  if (ext && EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];

  return 'plaintext';
}

/**
 * Detect LSP language ID from a file path (for language servers).
 * Differs from detectLanguage for JSX/TSX files.
 */
export function detectLspLanguage(filePath: string): string {
  const { filename, ext } = getExtension(filePath);

  // Check filename first
  if (FILENAME_MAP[filename]) return FILENAME_MAP[filename];

  // JSX/TSX need distinct LSP language IDs
  if (ext === 'tsx') return 'typescriptreact';
  if (ext === 'jsx') return 'javascriptreact';

  if (ext && EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];

  return 'plaintext';
}

/**
 * Get all known language IDs (for probing/config).
 */
export function getAllLanguageIds(): string[] {
  return [...new Set(Object.values(EXTENSION_MAP))];
}

// ── Monaco Language Registration ─────────────────────────────────────────────

/**
 * Register all languages in Monaco that it doesn't natively support.
 * Monaco already supports: typescript, javascript, html, css, json, markdown,
 * python, cpp, csharp, java, go, ruby, php, sql, yaml, xml, shell, bat,
 * powershell, lua, r, perl, scala, swift, kotlin, dart, fsharp, objective-c,
 * less, scss, graphql, diff.
 *
 * We register additional languages with Monarch tokenizers.
 */
export function disableNativeTypeScriptValidation(monaco: MonacoInstance) {
  const tsLang = (monaco.languages as any).typescript;
  if (!tsLang) return;
  tsLang.typescriptDefaults?.setDiagnosticsOptions({
    ...tsLang.typescriptDefaults.getDiagnosticsOptions(),
    noSemanticValidation: true,
    noSuggestionDiagnostics: true,
  });
  tsLang.javascriptDefaults?.setDiagnosticsOptions({
    ...tsLang.javascriptDefaults.getDiagnosticsOptions(),
    noSemanticValidation: true,
    noSuggestionDiagnostics: true,
  });

  // Wipe any existing markers from the built-in TS worker so stale errors disappear immediately.
  for (const model of monaco.editor.getModels()) {
    const path = model.uri.path;
    if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(path)) {
      monaco.editor.setModelMarkers(model, 'typescript', []);
      monaco.editor.setModelMarkers(model, 'javascript', []);
    }
  }
}

export function enableNativeTypeScriptValidation(monaco: MonacoInstance) {
  const tsLang = (monaco.languages as any).typescript;
  if (!tsLang) return;
  tsLang.typescriptDefaults?.setDiagnosticsOptions({
    ...tsLang.typescriptDefaults.getDiagnosticsOptions(),
    noSemanticValidation: false,
    noSuggestionDiagnostics: false,
  });
  tsLang.javascriptDefaults?.setDiagnosticsOptions({
    ...tsLang.javascriptDefaults.getDiagnosticsOptions(),
    noSemanticValidation: false,
    noSuggestionDiagnostics: false,
  });
}

export function registerAllLanguages(monaco: MonacoInstance): void {
  // Register languages that Monaco doesn't have built-in
  registerToml(monaco);
  registerSpectra(monaco);
  registerDockerfile(monaco);
  registerHcl(monaco);
  registerProtobuf(monaco);
  registerElixir(monaco);
  registerHaskell(monaco);
  registerZig(monaco);
  registerNim(monaco);
  registerClojure(monaco);
  registerOcaml(monaco);
  registerMakefile(monaco);
  registerIgnore(monaco);
  registerIni(monaco);
  registerLog(monaco);
  registerAsm(monaco);
  registerCmake(monaco);
  registerWat(monaco);
  registerV(monaco);
  registerTypescriptReact(monaco);
  registerReactSnippets(monaco);
  registerSpectraSnippets(monaco);

  // Register language configurations for languages Monaco supports
  // but doesn't have comment/bracket configs for
  registerRustConfig(monaco);
  registerCConfig(monaco);
}

// ── Individual Language Registrations ────────────────────────────────────────

function registerSnippetProvider(
  monaco: MonacoInstance,
  languages: string[],
  snippets: Array<{ label: string; kind: number; detail: string; insertText: string }>,
) {
  for (const lang of languages) {
    monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems: () => ({
        suggestions: snippets.map((s) => ({
          label: s.label,
          kind: s.kind,
          detail: s.detail,
          insertText: s.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: undefined as unknown as import('monaco-editor').IRange,
        })),
      }),
    });
  }
}

function registerReactSnippets(monaco: MonacoInstance) {
  const languages = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];
  registerSnippetProvider(monaco, languages, REACT_SNIPPETS);
}

function registerSpectraSnippets(monaco: MonacoInstance) {
  registerSnippetProvider(monaco, ['spectra'], SPECTRA_SNIPPETS);
}

function registerTypescriptReact(monaco: MonacoInstance) {
  // Configure Monaco's TypeScript language service to understand JSX/TSX syntax.
  // Both .ts/.tsx use 'typescript' and .js/.jsx use 'javascript' as language IDs
  // so that Monaco's built-in Monarch tokenizer provides full syntax highlighting.
  // Cast to any because monaco.languages.typescript is marked deprecated in v0.55+ types
  // but the runtime API still exists and works.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tsLang = (monaco.languages as any).typescript;
  if (!tsLang) return;

  const {
    typescriptDefaults,
    javascriptDefaults,
    JsxEmit,
    ScriptTarget,
    ModuleResolutionKind,
    ModuleKind,
  } = tsLang;

  const sharedOptions = {
    jsx: JsxEmit?.ReactJSX ?? 4,
    jsxFactory: 'React.createElement',
    jsxFragmentFactory: 'React.Fragment',
    target: ScriptTarget?.ESNext ?? 99,
    module: ModuleKind?.ESNext ?? 99,
    moduleResolution: ModuleResolutionKind?.NodeJs ?? 2,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    allowJs: true,
    noEmit: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    isolatedModules: true,
    strict: true,
    lib: ['esnext', 'dom', 'dom.iterable'],
  };

  if (typescriptDefaults) {
    typescriptDefaults.setCompilerOptions({
      ...typescriptDefaults.getCompilerOptions(),
      ...sharedOptions,
    });
  }

  if (javascriptDefaults) {
    javascriptDefaults.setCompilerOptions({
      ...javascriptDefaults.getCompilerOptions(),
      ...sharedOptions,
    });
  }
}

function registerToml(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'toml',
    extensions: ['.toml'],
    aliases: ['TOML'],
    mimetypes: ['text/x-toml'],
  });

  monaco.languages.setMonarchTokensProvider('toml', {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\[\[[\w.-]+\]\]/, 'type.identifier'],
        [/\[[\w.-]+\]/, 'type'],
        [/[a-zA-Z_][\w.-]*(?=\s*=)/, 'variable'],
        [/=/, 'operator'],
        [/"""[\s\S]*?"""/, 'string'],
        [/'''[\s\S]*?'''/, 'string'],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/\b(true|false)\b/, 'keyword'],
        [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/, 'number'],
        [/-?\d+\.\d+([eE][+-]?\d+)?/, 'number.float'],
        [/-?0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/-?0[oO][0-7_]+/, 'number.octal'],
        [/-?0[bB][01_]+/, 'number.binary'],
        [/-?\d[\d_]*/, 'number'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('toml', {
    comments: { lineComment: '#' },
    brackets: [['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
    ],
  });
}

function registerSpectra(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'spectra',
    extensions: ['.spectra', '.spc'],
    aliases: ['Spectra', 'SpectraLang'],
    mimetypes: ['text/x-spectra'],
  });

  monaco.languages.setMonarchTokensProvider('spectra', {
    tokenizer: {
      root: [
        // Comments
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@blockComment'],

        // Strings & character literals (f-strings must win over plain strings)
        [/f"/, 'string.interpolated', '@interpolatedString'],
        [/"/, 'string', '@string'],
        [/'(\\.|[^\\'])'/, 'string.quoted.single.char'],

        // Numbers (decimal / hex / binary)
        [/\b(0[xX][0-9a-fA-F_]+|0[bB][01_]+|[0-9](?:[0-9_]*[0-9])?(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?)\b/, 'number'],

        // Declarations: fn / struct·enum·trait·module / impl (name follows the keyword)
        [/\b(fn)\s+([A-Za-z_][A-Za-z0-9_]*)/, ['keyword.declaration.function', 'entity.name.function']],
        [/\b(struct|enum|trait|module)\s+([A-Za-z_][A-Za-z0-9_]*)/, ['keyword.declaration.type', 'entity.name.type']],
        [/\b(impl)\s+([A-Za-z_][A-Za-z0-9_:<>]*)/, ['keyword.declaration.impl', 'entity.name.type']],

        // std.api namespace — the whole dotted path (std.api.http.Request) is a
        // single token so names are never split across two colors.
        [/\b(?:std\.api|spectra\.api|spectra\.std\.api)(?:\.[A-Za-z_][A-Za-z0-9_]*)*/, 'support.namespace.std-api'],
        [/\b(?:get|post|put|patch|delete|options|route_add|route_match|match_param|match_query)\b/, 'support.function.std-api.routing'],
        [/\b(?:text|json|bytes|status|with_header|into_response|register_sync|register_async|dispatch_sync|dispatch_async)\b/, 'support.function.std-api.handler'],
        [/\b(?:policy|permissive|allow_origin|allow_method|allow_header|expose_header|allow_credentials|max_age|middleware|is_preflight|preflight|apply|allowed_origin)\b/, 'support.function.std-api.cors'],
        [/\b(?:chain|chain_new|chain_len|register_sync_short_circuit|register_async_short_circuit|use_sync|use_async|execute_sync|execute_async|last_trace|trace_len|trace_event|trace_short_circuited)\b/, 'support.function.std-api.middleware'],

        // Keywords
        [/\b(if|elif|elseif|else|unless|match|switch|case|cond|while|do|for|foreach|in|of|repeat|until|loop|return|break|continue|yield|goto|let|await)\b/, 'keyword.control'],
        [/\b(module|import|export|fn|async|struct|enum|impl|class|trait)\b/, 'keyword.declaration'],
        [/\b(pub|mut|internal|Self|self)\b/, 'storage.modifier'],
        [/\b(true|false)\b/, 'constant.language'],
        [/\b(type|const|static|as|dyn)\b/, 'keyword'],

        // Types: primitives first, then capitalized names (incl. generics like Foo<Bar, Baz>)
        [/\b(int|float|double|bool|string|char|void|unit|Task|Stream)\b/, 'support.type.primitive'],
        [/[A-Z][A-Za-z0-9_]*(?:<[A-Za-z0-9_,: <>]+>)?/, 'entity.name.type'],

        // Operators (multi-char before single-char so `=>`, `..`, `::` win)
        [/(\.\.=|\.\.|=>|==|!=|<=|>=|&&|\|\||::|->|\+=|-=|\*=|\/=|%=|\+|-|\*|\/|%|<|>|=|\?|!|&)/, 'operator'],
        [/\./, 'operator'],

        // Brackets & delimiters
        [/[{}()\[\]]/, '@brackets'],
        [/[;,]/, 'delimiter'],

        // Fallback — any other identifier is a plain variable (single color)
        [/[a-zA-Z_][a-zA-Z0-9_]*/, 'variable'],
      ],
      blockComment: [
        [/\*\//, 'comment', '@pop'],
        [/[^*/]+/, 'comment'],
        [/./, 'comment'],
      ],
      string: [
        [/[^"\\]+/, 'string'],
        [/\\./, 'constant.character.escape'],
        [/"/, 'string', '@pop'],
      ],
      interpolatedString: [
        [/[^"\\{]+/, 'string.interpolated'],
        [/\\./, 'constant.character.escape'],
        [/\{/, 'meta.interpolation', '@interpolation'],
        [/"/, 'string.interpolated', '@pop'],
      ],
      interpolation: [
        [/[^}"\\]+/, 'meta.interpolation'],
        [/\\./, 'constant.character.escape'],
        // Bail out of the interpolation state on an unterminated brace so the
        // rest of the file never leaks into the interpolation color.
        [/"/, 'string.interpolated', '@pop'],
        [/\}/, 'meta.interpolation', '@pop'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('spectra', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}', notIn: ['string', 'comment'] },
      { open: '[', close: ']', notIn: ['string', 'comment'] },
      { open: '(', close: ')', notIn: ['string', 'comment'] },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
      { open: '`', close: '`', notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '`', close: '`' },
    ],
    wordPattern: /(-?\d*\.?\d+([eE][\-+]?\d+)?[fFdD]?|\b(0[xX][0-9a-fA-F]+|\d+)[uUlL]*\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/,
    indentationRules: {
      increaseIndentPattern: /^.*(\{[^"']*|\([^)"']*)$/,
      decreaseIndentPattern: /^\s*[\}\)].*$/,
    },
  });
}

function registerDockerfile(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'dockerfile',
    filenames: ['Dockerfile', 'Dockerfile.*', 'Containerfile'],
    aliases: ['Dockerfile', 'Docker'],
    mimetypes: ['text/x-dockerfile'],
  });

  monaco.languages.setMonarchTokensProvider('dockerfile', {
    keywords: [
      'FROM', 'RUN', 'CMD', 'LABEL', 'MAINTAINER', 'EXPOSE', 'ENV', 'ADD',
      'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD',
      'STOPSIGNAL', 'HEALTHCHECK', 'SHELL',
    ],
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\b(FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/i, 'keyword'],
        [/\b(AS)\b/i, 'keyword.control'],
        [/\$\{[^}]+\}/, 'variable'],
        [/\$[a-zA-Z_]\w*/, 'variable'],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/\d+/, 'number'],
        [/--[\w-]+=?/, 'attribute.name'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('dockerfile', {
    comments: { lineComment: '#' },
    brackets: [['[', ']'], ['{', '}'], ['(', ')']],
    autoClosingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '(', close: ')' },
    ],
  });
}

function registerHcl(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'hcl',
    extensions: ['.tf', '.tfvars', '.hcl'],
    aliases: ['HCL', 'Terraform'],
    mimetypes: ['text/x-hcl'],
  });

  monaco.languages.setMonarchTokensProvider('hcl', {
    keywords: ['resource', 'data', 'variable', 'output', 'locals', 'module', 'terraform', 'provider', 'provisioner', 'lifecycle', 'dynamic', 'for_each', 'count', 'depends_on'],
    typeKeywords: ['string', 'number', 'bool', 'list', 'map', 'set', 'object', 'tuple', 'any'],
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/\b(resource|data|variable|output|locals|module|terraform|provider|provisioner|lifecycle|dynamic|for_each|count|depends_on)\b/, 'keyword'],
        [/\b(string|number|bool|list|map|set|object|tuple|any)\b/, 'type'],
        [/\b(true|false|null)\b/, 'keyword'],
        [/\b(if|else|endif|for|in|endfor)\b/, 'keyword.control'],
        [/"[^"]*"/, 'string'],
        [/\$\{[^}]+\}/, 'variable'],
        [/[a-zA-Z_][\w]*(?=\s*=)/, 'variable'],
        [/[a-zA-Z_][\w]*(?=\s*\{)/, 'type.identifier'],
        [/-?\d+\.?\d*/, 'number'],
      ],
      comment: [
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('hcl', {
    comments: { lineComment: '#', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });
}

function registerProtobuf(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'protobuf',
    extensions: ['.proto'],
    aliases: ['Protocol Buffers', 'Protobuf'],
    mimetypes: ['text/x-protobuf'],
  });

  monaco.languages.setMonarchTokensProvider('protobuf', {
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/\b(syntax|import|package|option|message|enum|service|rpc|returns|oneof|map|repeated|optional|required|reserved|extensions|extend|group)\b/, 'keyword'],
        [/\b(double|float|int32|int64|uint32|uint64|sint32|sint64|fixed32|fixed64|sfixed32|sfixed64|bool|string|bytes)\b/, 'type'],
        [/\b(true|false)\b/, 'keyword'],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/\d+/, 'number'],
        [/[A-Z]\w*/, 'type.identifier'],
      ],
      comment: [
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('protobuf', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });
}

function registerElixir(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'elixir',
    extensions: ['.ex', '.exs'],
    aliases: ['Elixir'],
    mimetypes: ['text/x-elixir'],
  });

  monaco.languages.setMonarchTokensProvider('elixir', {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\b(def|defp|defmodule|defmacro|defmacrop|defstruct|defprotocol|defimpl|defdelegate|defguard|defexception|defoverridable)\b/, 'keyword'],
        [/\b(do|end|fn|case|cond|if|else|unless|when|with|for|receive|after|try|catch|rescue|raise|throw|import|require|use|alias|quote|unquote|in|and|or|not|true|false|nil)\b/, 'keyword.control'],
        [/@\w+/, 'attribute.name'],
        [/:[\w!?]+/, 'type.identifier'],
        [/\b[A-Z]\w*/, 'type'],
        [/"""[\s\S]*?"""/, 'string'],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, 'string'],
        [/'[^'\\]*(?:\\.[^'\\]*)*'/, 'string'],
        [/~[a-zA-Z]"[^"]*"/, 'string'],
        [/~[a-zA-Z]\/[^/]*\//, 'regexp'],
        [/-?\d+\.?\d*/, 'number'],
        [/\|>|->|<-|=>|\\\\|\+\+|--|<>|~~~/, 'operator'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('elixir', {
    comments: { lineComment: '#' },
    brackets: [['do', 'end'], ['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
}

function registerHaskell(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'haskell',
    extensions: ['.hs', '.lhs'],
    aliases: ['Haskell'],
    mimetypes: ['text/x-haskell'],
  });

  monaco.languages.setMonarchTokensProvider('haskell', {
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/\{-/, 'comment', '@comment'],
        [/\b(module|where|import|qualified|as|hiding|data|type|newtype|class|instance|deriving|do|let|in|if|then|else|case|of|where|infixl|infixr|infix|foreign)\b/, 'keyword'],
        [/\b(True|False|Nothing|Just|Left|Right|IO|Maybe|Either)\b/, 'type.identifier'],
        [/\b[A-Z]\w*/, 'type'],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, 'string'],
        [/'(?:[^'\\]|\\.)'/, 'string'],
        [/\d+\.?\d*([eE][+-]?\d+)?/, 'number'],
        [/=>|->|<-|::|\\|\.\./, 'operator'],
      ],
      comment: [
        [/-\}/, 'comment', '@pop'],
        [/\{-/, 'comment', '@push'],
        [/./, 'comment'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('haskell', {
    comments: { lineComment: '--', blockComment: ['{-', '-}'] },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
}

function registerZig(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'zig',
    extensions: ['.zig'],
    aliases: ['Zig'],
    mimetypes: ['text/x-zig'],
  });

  monaco.languages.setMonarchTokensProvider('zig', {
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\b(const|var|fn|pub|extern|export|inline|comptime|test|try|catch|return|if|else|while|for|switch|break|continue|unreachable|defer|errdefer|orelse|and|or|struct|enum|union|error|packed|opaque|threadlocal|volatile|allowzero|noalias|usingnamespace|asm|nosuspend|async|await|suspend|resume)\b/, 'keyword'],
        [/\b(void|bool|noreturn|type|anyerror|anyframe|anytype|anyopaque|undefined|null|true|false)\b/, 'keyword'],
        [/\b(u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f16|f32|f64|f80|f128|c_short|c_ushort|c_int|c_uint|c_long|c_ulong|c_longlong|c_ulonglong|c_longdouble|c_void)\b/, 'type'],
        [/@\w+/, 'attribute.name'],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, 'string'],
        [/'[^'\\]*'/, 'string'],
        [/\\\\."/, 'string'],
        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/0[oO][0-7_]+/, 'number.octal'],
        [/0[bB][01_]+/, 'number.binary'],
        [/\d[\d_]*\.?[\d_]*([eE][+-]?\d+)?/, 'number'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('zig', {
    comments: { lineComment: '//' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });
}

function registerNim(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'nim',
    extensions: ['.nim', '.nims', '.nimble'],
    aliases: ['Nim'],
    mimetypes: ['text/x-nim'],
  });

  monaco.languages.setMonarchTokensProvider('nim', {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\b(proc|func|method|template|macro|iterator|converter|type|var|let|const|import|include|from|export|when|if|elif|else|case|of|while|for|in|do|block|try|except|finally|raise|return|yield|discard|break|continue|object|tuple|enum|concept|distinct|ref|ptr|addr|cast|nil|true|false|and|or|not|xor|shl|shr|div|mod|is|isnot|as)\b/, 'keyword'],
        [/\b[A-Z]\w*/, 'type'],
        [/"""[\s\S]*?"""/, 'string'],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/\d[\d_]*\.?[\d_]*/, 'number'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('nim', {
    comments: { lineComment: '#' },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
    ],
  });
}

function registerClojure(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'clojure',
    extensions: ['.clj', '.cljs', '.cljc', '.edn'],
    aliases: ['Clojure'],
    mimetypes: ['text/x-clojure'],
  });

  monaco.languages.setMonarchTokensProvider('clojure', {
    tokenizer: {
      root: [
        [/;.*$/, 'comment'],
        [/\b(def|defn|defn-|defmacro|defmethod|defmulti|defprotocol|defrecord|defstruct|deftype|fn|let|loop|recur|do|if|if-not|when|when-not|when-let|cond|condp|case|try|catch|finally|throw|monitor-enter|monitor-exit|new|quote|var|set!|import|require|use|ns|in-ns|refer)\b/, 'keyword'],
        [/\b(nil|true|false)\b/, 'keyword'],
        [/:[a-zA-Z][\w?!*-]*/, 'type.identifier'],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, 'string'],
        [/#"[^"]*"/, 'regexp'],
        [/-?\d+\.?\d*([eE][+-]?\d+)?/, 'number'],
        [/-?\d+\/\d+/, 'number'],
        [/[a-zA-Z][\w?!*-]*\/[a-zA-Z][\w?!*-]*/, 'variable'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('clojure', {
    comments: { lineComment: ';' },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
    ],
  });
}

function registerOcaml(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'ocaml',
    extensions: ['.ml', '.mli'],
    aliases: ['OCaml'],
    mimetypes: ['text/x-ocaml'],
  });

  monaco.languages.setMonarchTokensProvider('ocaml', {
    tokenizer: {
      root: [
        [/\(\*/, 'comment', '@comment'],
        [/\b(let|in|and|rec|val|fun|function|match|with|type|module|sig|struct|end|open|include|if|then|else|for|do|done|while|to|downto|begin|end|try|raise|exception|external|mutable|assert|lazy)\b/, 'keyword'],
        [/\b(int|float|char|string|bool|unit|list|array|option|ref)\b/, 'type'],
        [/\b(true|false)\b/, 'keyword'],
        [/\b[A-Z]\w*/, 'type.identifier'],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, 'string'],
        [/'(?:[^'\\]|\\.)'/, 'string'],
        [/\d+\.?\d*([eE][+-]?\d+)?/, 'number'],
        [/->|<-|::|;;|;;|\|>/, 'operator'],
      ],
      comment: [
        [/\*\)/, 'comment', '@pop'],
        [/\(\*/, 'comment', '@push'],
        [/./, 'comment'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('ocaml', {
    comments: { blockComment: ['(*', '*)'] },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
    ],
  });
}

function registerMakefile(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'makefile',
    filenames: ['Makefile', 'GNUmakefile', 'Justfile'],
    extensions: ['.mk'],
    aliases: ['Makefile', 'Make'],
    mimetypes: ['text/x-makefile'],
  });

  monaco.languages.setMonarchTokensProvider('makefile', {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/^\S+\s*[:+?]?=/, 'variable'],
        [/^\S+\s*:(?!=)/, 'type'],
        [/\$\([^)]+\)/, 'variable'],
        [/\$\{[^}]+\}/, 'variable'],
        [/\$[@<^?*%]/, 'variable'],
        [/\b(ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|include|override|export|unexport|vpath|\.PHONY|\.DEFAULT|\.PRECIOUS|\.INTERMEDIATE|\.SECONDARY|\.SUFFIXES|\.DELETE_ON_ERROR)\b/, 'keyword'],
        [/\t.*$/, 'string'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('makefile', {
    comments: { lineComment: '#' },
    brackets: [['(', ')'], ['{', '}']],
  });
}

function registerIgnore(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'ignore',
    filenames: ['.gitignore', '.dockerignore', '.eslintignore', '.prettierignore', '.npmignore'],
    aliases: ['Ignore File'],
  });

  monaco.languages.setMonarchTokensProvider('ignore', {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/!.*$/, 'keyword'],
        [/\*\*/, 'regexp'],
        [/\*/, 'regexp'],
        [/\?/, 'regexp'],
        [/\//, 'delimiter'],
        [/[^\s#!*?/]+/, 'string'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('ignore', {
    comments: { lineComment: '#' },
  });
}

function registerIni(monaco: MonacoInstance) {
  const existing = monaco.languages.getLanguages().find((l: { id: string }) => l.id === 'ini');
  if (existing) return;

  monaco.languages.register({
    id: 'ini',
    extensions: ['.ini', '.env', '.properties', '.cfg', '.conf', '.editorconfig'],
    aliases: ['INI', 'Properties', 'Env'],
    mimetypes: ['text/x-ini'],
  });

  monaco.languages.setMonarchTokensProvider('ini', {
    tokenizer: {
      root: [
        [/[#;].*$/, 'comment'],
        [/\[[^\]]+\]/, 'type'],
        [/^[\w.-]+(?=\s*=)/, 'variable'],
        [/=/, 'operator'],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/\$\{[^}]+\}/, 'variable'],
        [/\b\d+\b/, 'number'],
        [/\b(true|false|yes|no|on|off)\b/i, 'keyword'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('ini', {
    comments: { lineComment: '#' },
    brackets: [['[', ']']],
    autoClosingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '[', close: ']' },
    ],
  });
}

function registerLog(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'log',
    extensions: ['.log'],
    aliases: ['Log File'],
  });

  monaco.languages.setMonarchTokensProvider('log', {
    tokenizer: {
      root: [
        [/\b(ERROR|FATAL|CRITICAL|FAIL)\b/i, 'invalid'],
        [/\b(WARN|WARNING)\b/i, 'keyword'],
        [/\b(INFO|NOTICE)\b/i, 'type'],
        [/\b(DEBUG|TRACE|VERBOSE)\b/i, 'comment'],
        [/\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}[\d.]*[Z]?/, 'number'],
        [/\d{2}:\d{2}:\d{2}[\d.]*/, 'number'],
        [/"[^"]*"/, 'string'],
        [/\[[\w.:-]+\]/, 'attribute.name'],
        [/https?:\/\/\S+/, 'string'],
        [/\b\d+\b/, 'number'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);
}

function registerAsm(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'asm',
    extensions: ['.asm', '.s', '.S'],
    aliases: ['Assembly', 'ASM'],
    mimetypes: ['text/x-asm'],
  });

  monaco.languages.setMonarchTokensProvider('asm', {
    tokenizer: {
      root: [
        [/[;#].*$/, 'comment'],
        [/\/\/.*$/, 'comment'],
        [/\.\w+/, 'keyword'],
        [/\b(mov|add|sub|mul|div|push|pop|call|ret|jmp|je|jne|jg|jl|jge|jle|cmp|test|and|or|xor|not|shl|shr|lea|nop|int|syscall|inc|dec)\b/i, 'keyword'],
        [/\b(rax|rbx|rcx|rdx|rsi|rdi|rsp|rbp|r8|r9|r10|r11|r12|r13|r14|r15|eax|ebx|ecx|edx|esi|edi|esp|ebp|ax|bx|cx|dx|al|bl|cl|dl|ah|bh|ch|dh|xmm\d+|ymm\d+)\b/i, 'type'],
        [/\b[a-zA-Z_]\w*:/, 'type.identifier'],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/0[xX][0-9a-fA-F]+/, 'number.hex'],
        [/0[bB][01]+/, 'number.binary'],
        [/-?\d+/, 'number'],
        [/%\w+/, 'variable'],
        [/\$\d+/, 'number'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('asm', {
    comments: { lineComment: ';' },
    brackets: [['(', ')'], ['[', ']']],
  });
}

function registerCmake(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'cmake',
    filenames: ['CMakeLists.txt'],
    extensions: ['.cmake'],
    aliases: ['CMake'],
    mimetypes: ['text/x-cmake'],
  });

  monaco.languages.setMonarchTokensProvider('cmake', {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\b(if|elseif|else|endif|foreach|endforeach|while|endwhile|function|endfunction|macro|endmacro|return|break|continue)\b/i, 'keyword.control'],
        [/\b(project|cmake_minimum_required|add_executable|add_library|target_link_libraries|target_include_directories|set|list|message|find_package|include|install|option|add_subdirectory|configure_file|add_definitions|add_dependencies|add_custom_command|add_custom_target|execute_process|file|string|math|get_filename_component|get_target_property|set_target_properties|cmake_policy)\b/i, 'keyword'],
        [/\$\{[^}]+\}/, 'variable'],
        [/\$ENV\{[^}]+\}/, 'variable'],
        [/"[^"]*"/, 'string'],
        [/\d+/, 'number'],
        [/\b(TRUE|FALSE|ON|OFF|YES|NO)\b/i, 'keyword'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('cmake', {
    comments: { lineComment: '#' },
    brackets: [['(', ')']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });
}

function registerWat(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'wat',
    extensions: ['.wat', '.wast'],
    aliases: ['WebAssembly Text', 'WAT'],
    mimetypes: ['text/x-wat'],
  });

  monaco.languages.setMonarchTokensProvider('wat', {
    tokenizer: {
      root: [
        [/;;.*$/, 'comment'],
        [/\(;/, 'comment', '@comment'],
        [/\b(module|func|param|result|local|global|memory|table|elem|data|start|import|export|type|mut|offset|block|loop|if|then|else|end|br|br_if|br_table|return|call|call_indirect|drop|select|unreachable|nop)\b/, 'keyword'],
        [/\b(i32|i64|f32|f64|v128|funcref|externref)\b/, 'type'],
        [/\$[\w!#$%&'*+\-./:<=>?@\\^_`|~]+/, 'variable'],
        [/"[^"]*"/, 'string'],
        [/-?0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/-?\d[\d_]*\.?[\d_]*([eE][+-]?\d+)?/, 'number'],
        [/\b(i32|i64|f32|f64)\.[a-z_]+/, 'function'],
      ],
      comment: [
        [/;\)/, 'comment', '@pop'],
        [/./, 'comment'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('wat', {
    comments: { lineComment: ';;', blockComment: ['(;', ';)'] },
    brackets: [['(', ')']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });
}

function registerV(monaco: MonacoInstance) {
  monaco.languages.register({
    id: 'v',
    extensions: ['.v', '.vv'],
    aliases: ['V', 'Vlang'],
    mimetypes: ['text/x-v'],
  });

  monaco.languages.setMonarchTokensProvider('v', {
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/\b(fn|pub|mut|const|struct|enum|union|interface|type|import|module|return|if|else|for|in|match|or|go|spawn|defer|assert|unsafe|asm|shared|lock|rlock|select|as|is|none|true|false|it|dump)\b/, 'keyword'],
        [/\b(bool|string|i8|i16|int|i64|i128|u8|u16|u32|u64|u128|f32|f64|rune|byte|byteptr|voidptr|charptr)\b/, 'type'],
        [/\b[A-Z]\w*/, 'type.identifier'],
        [/'[^'\\]*(?:\\.[^'\\]*)*'/, 'string'],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, 'string'],
        [/`[^`]*`/, 'string'],
        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/0[bB][01_]+/, 'number.binary'],
        [/0[oO][0-7_]+/, 'number.octal'],
        [/\d[\d_]*\.?[\d_]*([eE][+-]?\d+)?/, 'number'],
        [/@\[[\w.]+\]/, 'attribute.name'],
        [/\$\{[^}]+\}/, 'variable'],
      ],
      comment: [
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],
    },
  } as import('monaco-editor').languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('v', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
}

function registerRustConfig(monaco: MonacoInstance) {
  // Rust is built-in to Monaco but ensure language config is set
  try {
    monaco.languages.setLanguageConfiguration('rust', {
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '<', close: '>' },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '<', close: '>' },
      ],
    });
  } catch {
    // Already configured
  }
}

function registerCConfig(monaco: MonacoInstance) {
  // C is built-in but ensure bracket/comment config
  try {
    monaco.languages.setLanguageConfiguration('c', {
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });
  } catch {
    // Already configured
  }
}

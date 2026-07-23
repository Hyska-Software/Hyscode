// ─── Built-in Language Server Configurations ─────────────────────────────────
// Defines the top 10 language servers shipped with HysCode.
// Each config specifies the binary command, args, supported languages,
// root detection patterns, and install instructions.

import type { LspContribution } from '@hyscode/extension-api';

export interface BuiltinServerConfig extends LspContribution {
  /** Human-friendly name shown in UI */
  displayName: string;
  /** Short description */
  description: string;
  /** How to install the server */
  installInstructions: Record<string, string>;
  /** Whether the server is enabled by default when found */
  enabledByDefault: boolean;
  /** npm package to install globally (if applicable) */
  npmPackage?: string;
  /** pip/pipx package to install (if applicable) */
  pipPackage?: string;
  /** Cargo crate to install (if applicable) */
  cargoCrate?: string;
}

export const BUILTIN_SERVERS: BuiltinServerConfig[] = [
  // ── 1. TypeScript / JavaScript ──────────────────────────────────────────
  {
    id: 'builtin-typescript',
    displayName: 'TypeScript Language Server',
    description: 'IntelliSense for TypeScript, JavaScript, JSX and TSX',
    languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    command: 'typescript-language-server',
    args: ['--stdio'],
    rootPatterns: ['tsconfig.json', 'jsconfig.json', 'package.json', 'app.json', 'react-native.config.js'],
    initializationOptions: {
      preferences: {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
      },
    },
    enabledByDefault: true,
    npmPackage: 'typescript-language-server',
    installInstructions: {
      npm: 'npm install -g typescript-language-server typescript',
      pnpm: 'pnpm add -g typescript-language-server typescript',
      yarn: 'yarn global add typescript-language-server typescript',
    },
  },

  // ── 2. Python ───────────────────────────────────────────────────────────
  {
    id: 'builtin-python',
    displayName: 'Pyright',
    description: 'Static type checker and language server for Python',
    languageIds: ['python'],
    command: 'pyright-langserver',
    args: ['--stdio'],
    rootPatterns: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', '.python-version'],
    initializationOptions: {},
    enabledByDefault: true,
    npmPackage: 'pyright',
    pipPackage: 'pyright',
    installInstructions: {
      npm: 'npm install -g pyright',
      pip: 'pip install pyright',
      pipx: 'pipx install pyright',
    },
  },

  // ── 3. Rust ─────────────────────────────────────────────────────────────
  {
    id: 'builtin-rust',
    displayName: 'rust-analyzer',
    description: 'Rust language support with smart completions and diagnostics',
    languageIds: ['rust'],
    command: 'rust-analyzer',
    args: [],
    rootPatterns: ['Cargo.toml'],
    initializationOptions: {
      checkOnSave: { command: 'clippy' },
    },
    enabledByDefault: true,
    installInstructions: {
      rustup: 'rustup component add rust-analyzer',
      manual: 'Download from https://github.com/rust-lang/rust-analyzer/releases',
    },
  },

  // ── 4. Go ───────────────────────────────────────────────────────────────
  {
    id: 'builtin-go',
    displayName: 'gopls',
    description: 'Official Go language server',
    languageIds: ['go'],
    command: 'gopls',
    args: ['serve'],
    rootPatterns: ['go.mod', 'go.sum'],
    initializationOptions: {},
    enabledByDefault: true,
    installInstructions: {
      go: 'go install golang.org/x/tools/gopls@latest',
    },
  },

  // ── 5. C / C++ ─────────────────────────────────────────────────────────
  {
    id: 'builtin-clangd',
    displayName: 'clangd',
    description: 'C/C++ language server from the LLVM project',
    languageIds: ['c', 'cpp'],
    command: 'clangd',
    args: ['--background-index', '--clang-tidy'],
    rootPatterns: ['compile_commands.json', 'CMakeLists.txt', '.clangd', 'Makefile'],
    initializationOptions: {},
    enabledByDefault: true,
    installInstructions: {
      apt: 'sudo apt install clangd',
      brew: 'brew install llvm',
      winget: 'winget install LLVM.LLVM',
      manual: 'Download from https://clangd.llvm.org/installation',
    },
  },

  // ── 6. Java ─────────────────────────────────────────────────────────────
  {
    id: 'builtin-java',
    displayName: 'Eclipse JDT Language Server',
    description: 'Java language support via Eclipse JDT.LS',
    languageIds: ['java'],
    command: 'jdtls',
    args: [],
    rootPatterns: ['pom.xml', 'build.gradle', 'build.gradle.kts', '.project', 'settings.gradle'],
    initializationOptions: {},
    enabledByDefault: true,
    installInstructions: {
      brew: 'brew install jdtls',
      manual: 'Download from https://download.eclipse.org/jdtls/snapshots/',
      sdkman: 'sdk install jdtls',
    },
  },

  // ── 7. C# ──────────────────────────────────────────────────────────────
  {
    id: 'builtin-csharp',
    displayName: 'C# Language Server',
    description: 'C# language support via csharp-ls',
    languageIds: ['csharp'],
    command: 'csharp-ls',
    args: [],
    rootPatterns: ['*.csproj', '*.sln', 'global.json'],
    initializationOptions: {},
    enabledByDefault: true,
    installInstructions: {
      dotnet: 'dotnet tool install --global csharp-ls',
    },
  },

  // ── 8. PHP ─────────────────────────────────────────────────────────────
  {
    id: 'builtin-php',
    displayName: 'Intelephense',
    description: 'High-performance PHP language server',
    languageIds: ['php'],
    command: 'intelephense',
    args: ['--stdio'],
    rootPatterns: ['composer.json', 'index.php', '.php-version'],
    initializationOptions: {},
    enabledByDefault: true,
    npmPackage: 'intelephense',
    installInstructions: {
      npm: 'npm install -g intelephense',
      pnpm: 'pnpm add -g intelephense',
    },
  },

  // ── 9. Ruby ────────────────────────────────────────────────────────────
  {
    id: 'builtin-ruby',
    displayName: 'Ruby LSP',
    description: 'Ruby language server by Shopify',
    languageIds: ['ruby'],
    command: 'ruby-lsp',
    args: [],
    rootPatterns: ['Gemfile', '.ruby-version', '*.gemspec'],
    initializationOptions: {},
    enabledByDefault: true,
    installInstructions: {
      gem: 'gem install ruby-lsp',
    },
  },

  // ── 10. Dart ───────────────────────────────────────────────────────────
  {
    id: 'builtin-dart',
    displayName: 'Dart Language Server',
    description: 'Dart language support with Flutter analysis',
    languageIds: ['dart'],
    command: 'dart',
    args: ['language-server', '--protocol=lsp'],
    rootPatterns: ['pubspec.yaml', 'analysis_options.yaml'],
    initializationOptions: {
      closingLabels: true,
      outline: true,
      flutterOutline: true,
    },
    enabledByDefault: true,
    installInstructions: {
      flutter: 'Install Flutter SDK: https://docs.flutter.dev/get-started/install',
      dart: 'Install Dart SDK: https://dart.dev/get-dart',
      brew: 'brew install dart',
      choco: 'choco install dart-sdk',
    },
  },

  // ── 11. HTML / CSS / JSON ──────────────────────────────────────────────
  {
    id: 'builtin-html',
    displayName: 'HTML Language Server',
    description: 'HTML language features',
    languageIds: ['html'],
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    rootPatterns: ['*.html', 'index.html'],
    initializationOptions: {},
    enabledByDefault: true,
    npmPackage: 'vscode-langservers-extracted',
    installInstructions: {
      npm: 'npm install -g vscode-langservers-extracted',
      pnpm: 'pnpm add -g vscode-langservers-extracted',
    },
  },
  {
    id: 'builtin-css',
    displayName: 'CSS Language Server',
    description: 'CSS, SCSS, and LESS language features',
    languageIds: ['css', 'scss', 'less'],
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    rootPatterns: [],
    initializationOptions: {},
    enabledByDefault: true,
    npmPackage: 'vscode-langservers-extracted',
    installInstructions: {
      npm: 'npm install -g vscode-langservers-extracted',
      pnpm: 'pnpm add -g vscode-langservers-extracted',
    },
  },
  {
    id: 'builtin-json',
    displayName: 'JSON Language Server',
    description: 'JSON language features with schema validation',
    languageIds: ['json'],
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    rootPatterns: [],
    initializationOptions: {
      provideFormatter: true,
    },
    enabledByDefault: true,
    npmPackage: 'vscode-langservers-extracted',
    installInstructions: {
      npm: 'npm install -g vscode-langservers-extracted',
      pnpm: 'pnpm add -g vscode-langservers-extracted',
    },
  },
];

/**
 * Get the builtin server config for a given language ID.
 * Returns undefined if no built-in server is configured for that language.
 */
export function getBuiltinServerForLanguage(languageId: string): BuiltinServerConfig | undefined {
  return BUILTIN_SERVERS.find((s) => s.languageIds.includes(languageId));
}

/**
 * Get all unique server commands that need to be probed.
 */
export function getUniqueServerCommands(): string[] {
  return [...new Set(BUILTIN_SERVERS.map((s) => s.command))];
}

/**
 * Get a builtin server config by its ID.
 */
export function getBuiltinServerById(id: string): BuiltinServerConfig | undefined {
  return BUILTIN_SERVERS.find((s) => s.id === id);
}

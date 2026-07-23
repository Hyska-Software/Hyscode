// Code Runner Extension — main.js
// Execute code and projects directly from the IDE with terminal integration

// ── Language → Command Mappings ──────────────────────────────────────────────
const DEFAULT_EXECUTORS = {
  // Scripting languages
  javascript:     { cmd: 'node',              args: '"$file"' },
  typescript:     { cmd: 'npx ts-node',       args: '"$file"' },
  python:         { cmd: 'python',            args: '"$file"' },
  ruby:           { cmd: 'ruby',              args: '"$file"' },
  perl:           { cmd: 'perl',              args: '"$file"' },
  php:            { cmd: 'php',               args: '"$file"' },
  lua:            { cmd: 'lua',               args: '"$file"' },
  r:              { cmd: 'Rscript',           args: '"$file"' },

  // Shell
  shellscript:    { cmd: 'bash',              args: '"$file"' },
  powershell:     { cmd: 'pwsh',              args: '-File "$file"' },
  bat:            { cmd: 'cmd /c',            args: '"$file"' },

  // Compiled languages
  c:              { cmd: 'gcc',               args: '"$file" -o "$fileNoExt" && "$fileNoExt"' },
  cpp:            { cmd: 'g++',               args: '"$file" -o "$fileNoExt" && "$fileNoExt"' },
  csharp:         { cmd: 'dotnet-script',     args: '"$file"',    alt: 'dotnet run' },
  java:           { cmd: 'java',              args: '"$file"' },
  kotlin:         { cmd: 'kotlinc',           args: '"$file" -include-runtime -d "$fileNoExt.jar" && java -jar "$fileNoExt.jar"' },
  go:             { cmd: 'go run',            args: '"$file"' },
  rust:           { cmd: 'rustc',             args: '"$file" -o "$fileNoExt" && "$fileNoExt"' },
  swift:          { cmd: 'swift',             args: '"$file"' },
  dart:           { cmd: 'dart run',          args: '"$file"' },
  zig:            { cmd: 'zig run',           args: '"$file"' },

  // JVM
  scala:          { cmd: 'scala',             args: '"$file"' },
  groovy:         { cmd: 'groovy',            args: '"$file"' },
  clojure:        { cmd: 'clojure',           args: '"$file"' },

  // Functional
  haskell:        { cmd: 'runhaskell',        args: '"$file"' },
  elixir:         { cmd: 'elixir',            args: '"$file"' },
  erlang:         { cmd: 'escript',           args: '"$file"' },
  ocaml:          { cmd: 'ocaml',             args: '"$file"' },
  fsharp:         { cmd: 'dotnet fsi',        args: '"$file"' },

  // Data / Config
  sql:            { cmd: 'sqlite3',           args: '< "$file"' },
  markdown:       { cmd: 'cat',               args: '"$file"' },

  // React / Web (use appropriate runner)
  javascriptreact:  { cmd: 'node',            args: '"$file"' },
  typescriptreact:  { cmd: 'npx ts-node',     args: '"$file"' },
};

// ── Project detection → run commands ─────────────────────────────────────────
const PROJECT_RUNNERS = [
  { file: 'package.json',       cmd: 'npm start',                label: 'Node.js / npm' },
  { file: 'Cargo.toml',         cmd: 'cargo run',                label: 'Rust / Cargo' },
  { file: 'go.mod',             cmd: 'go run .',                 label: 'Go' },
  { file: 'pom.xml',            cmd: 'mvn spring-boot:run',      label: 'Maven / Spring' },
  { file: 'build.gradle',       cmd: 'gradle run',               label: 'Gradle' },
  { file: 'build.gradle.kts',   cmd: 'gradle run',               label: 'Gradle (Kotlin DSL)' },
  { file: 'Makefile',           cmd: 'make run',                 label: 'Makefile' },
  { file: 'CMakeLists.txt',     cmd: 'cmake --build build && ./build/main', label: 'CMake' },
  { file: 'pubspec.yaml',       cmd: 'flutter run',              label: 'Flutter' },
  { file: 'mix.exs',            cmd: 'mix run',                  label: 'Elixir / Mix' },
  { file: 'Gemfile',            cmd: 'bundle exec ruby main.rb', label: 'Ruby / Bundler' },
  { file: 'requirements.txt',   cmd: 'python main.py',           label: 'Python' },
  { file: 'pyproject.toml',     cmd: 'python -m',                label: 'Python (pyproject)' },
  { file: 'Dockerfile',         cmd: 'docker build -t app . && docker run app', label: 'Docker' },
  { file: 'docker-compose.yml', cmd: 'docker compose up',        label: 'Docker Compose' },
  { file: '*.csproj',           cmd: 'dotnet run',               label: '.NET' },
  { file: '*.sln',              cmd: 'dotnet run',               label: '.NET Solution' },
  { file: 'deno.json',          cmd: 'deno run main.ts',         label: 'Deno' },
  { file: 'bun.lockb',          cmd: 'bun run start',            label: 'Bun' },
];

// ── Variable resolver ────────────────────────────────────────────────────────
function resolveVariables(template, filePath) {
  if (!filePath) return template;

  const parts = filePath.replace(/\\/g, '/');
  const fileName = parts.split('/').pop() || '';
  const fileNoExt = fileName.replace(/\.[^.]+$/, '');
  const dir = parts.substring(0, parts.lastIndexOf('/')) || '.';
  const ext = fileName.includes('.') ? fileName.split('.').pop() : '';

  return template
    .replace(/\$file/g, filePath)
    .replace(/\$fileNoExt/g, `${dir}/${fileNoExt}`)
    .replace(/\$fileName/g, fileName)
    .replace(/\$fileNameNoExt/g, fileNoExt)
    .replace(/\$dir/g, dir)
    .replace(/\$ext/g, ext);
}

export function activate(context) {
  console.log('[code-runner] Extension activated');

  const api = context._api || globalThis.hyscode;
  if (!api) {
    console.warn('[code-runner] HysCode API not available');
    return;
  }

  if (!api.commands) return;

  let isRunning = false;

  // ── Helper: send command to terminal ────────────────────────────────────────
  async function runInTerminal(cmd) {
    if (api.terminal && api.terminal.sendToActive) {
      isRunning = true;
      await api.terminal.sendToActive(cmd);
    }
  }

  // ── Helper: get executor for language ───────────────────────────────────────
  function getExecutor(langId) {
    // Check user-defined custom executors first
    const customMap = api.configuration?.get?.('codeRunner.executorMap') || {};
    if (customMap[langId]) {
      return { cmd: customMap[langId], args: '"$file"' };
    }
    return DEFAULT_EXECUTORS[langId] || null;
  }

  // ── Helper: build run command ───────────────────────────────────────────────
  function buildRunCommand(langId, filePath) {
    const executor = getExecutor(langId);
    if (!executor) return null;

    const cmdTemplate = `${executor.cmd} ${executor.args}`;
    return resolveVariables(cmdTemplate, filePath);
  }

  // ── Run Code (current file) ─────────────────────────────────────────────────
  api.commands.register('codeRunner.run', async () => {
    const filePath = api.editor?.getActiveFilePath?.();
    const langId = api.editor?.getLanguageId?.() ||
                   guessLanguageFromPath(filePath);

    if (!filePath) {
      api.window?.showWarningMessage?.('No active file to run');
      return;
    }

    // Save file before running
    const saveFirst = api.configuration?.get?.('codeRunner.saveFileBeforeRun');
    if (saveFirst !== false && api.editor?.save) {
      await api.editor.save();
    }

    const cmd = buildRunCommand(langId, filePath);
    if (!cmd) {
      api.window?.showWarningMessage?.(
        `No executor configured for language: ${langId}. Use "Run Custom Command" instead.`
      );
      return;
    }

    const showTime = api.configuration?.get?.('codeRunner.showExecutionTime');
    const clearPrev = api.configuration?.get?.('codeRunner.clearPreviousOutput');

    if (clearPrev !== false && api.terminal?.clear) {
      await api.terminal.clear();
    }

    console.log(`[code-runner] Running: ${cmd}`);

    if (showTime !== false) {
      // Wrap in time measurement
      const isWindows = typeof navigator !== 'undefined'
        ? navigator.platform?.includes('Win')
        : true;

      if (isWindows) {
        await runInTerminal(`$sw = [System.Diagnostics.Stopwatch]::StartNew(); ${cmd}; $sw.Stop(); Write-Host "\\n[Code Runner] Execution time: $($sw.Elapsed.TotalSeconds.ToString('F3'))s"`);
      } else {
        await runInTerminal(`time ( ${cmd} )`);
      }
    } else {
      await runInTerminal(cmd);
    }
  });

  // ── Run Selection ───────────────────────────────────────────────────────────
  api.commands.register('codeRunner.runSelection', async () => {
    const selection = api.editor?.getSelection?.();
    if (!selection || !selection.text) {
      api.window?.showWarningMessage?.('No text selected');
      return;
    }

    const langId = api.editor?.getLanguageId?.() || 'javascript';
    const text = selection.text.trim();

    // For interpreted languages, pipe selection to interpreter
    const interpreters = {
      javascript: 'node -e',
      typescript: 'npx ts-node -e',
      python: 'python -c',
      ruby: 'ruby -e',
      php: 'php -r',
      perl: 'perl -e',
      lua: 'lua -e',
      powershell: 'pwsh -Command',
      shellscript: 'bash -c',
    };

    const interpreter = interpreters[langId];
    if (interpreter) {
      // Escape the code for shell
      const escaped = text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      await runInTerminal(`${interpreter} "${escaped}"`);
    } else {
      api.window?.showWarningMessage?.(
        `Run Selection is not supported for ${langId}. Try running the full file instead.`
      );
    }
  });

  // ── Run Project ─────────────────────────────────────────────────────────────
  api.commands.register('codeRunner.runProject', async () => {
    // Check for custom project runner first
    const customRunner = api.configuration?.get?.('codeRunner.defaultProjectRunner');
    if (customRunner) {
      await runInTerminal(customRunner);
      return;
    }

    // Auto-detect project type
    const detectedRunners = [];

    if (api.workspace && api.workspace.fileExists) {
      for (const runner of PROJECT_RUNNERS) {
        // Simple wildcard check
        if (runner.file.includes('*')) {
          // Skip glob patterns for now, would need workspace listing
          continue;
        }
        const exists = await api.workspace.fileExists(runner.file);
        if (exists) {
          detectedRunners.push(runner);
        }
      }
    }

    if (detectedRunners.length === 0) {
      // Fallback: ask user
      const cmd = await api.window?.showInputBox?.({
        prompt: 'No project file detected. Enter command to run:',
        placeHolder: 'npm start',
      });
      if (cmd) {
        await runInTerminal(cmd);
      }
      return;
    }

    if (detectedRunners.length === 1) {
      await runInTerminal(detectedRunners[0].cmd);
      return;
    }

    // Multiple project types detected — let user choose
    const choice = await api.window?.showQuickPick?.(
      detectedRunners.map(r => ({
        label: r.label,
        value: r.cmd,
        description: r.cmd,
      })),
      { placeHolder: 'Multiple project types detected. Choose runner:' }
    );

    if (choice) {
      await runInTerminal(choice.value);
    }
  });

  // ── Stop Running ────────────────────────────────────────────────────────────
  api.commands.register('codeRunner.stop', async () => {
    if (api.terminal && api.terminal.sendToActive) {
      // Send Ctrl+C to stop the running process
      await api.terminal.sendToActive('\x03');
      isRunning = false;
      console.log('[code-runner] Process stopped');
    }
  });

  // ── Run in Dedicated Terminal ───────────────────────────────────────────────
  api.commands.register('codeRunner.runInDedicatedTerminal', async () => {
    const filePath = api.editor?.getActiveFilePath?.();
    const langId = api.editor?.getLanguageId?.() ||
                   guessLanguageFromPath(filePath);

    if (!filePath) {
      api.window?.showWarningMessage?.('No active file to run');
      return;
    }

    const cmd = buildRunCommand(langId, filePath);
    if (!cmd) {
      api.window?.showWarningMessage?.(`No executor for: ${langId}`);
      return;
    }

    // Create a new terminal for this execution
    if (api.terminal && api.terminal.create) {
      const term = await api.terminal.create({ name: `Run: ${filePath.split(/[/\\]/).pop()}` });
      if (term && term.sendText) {
        await term.sendText(cmd);
      }
    } else {
      // Fallback to active terminal
      await runInTerminal(cmd);
    }
  });

  // ── Run Custom Command ──────────────────────────────────────────────────────
  api.commands.register('codeRunner.runCustomCommand', async () => {
    const cmd = await api.window?.showInputBox?.({
      prompt: 'Enter command to execute',
      placeHolder: 'npm test',
    });
    if (cmd) {
      await runInTerminal(cmd);
    }
  });

  // ── Clear Output ────────────────────────────────────────────────────────────
  api.commands.register('codeRunner.clearOutput', async () => {
    if (api.terminal && api.terminal.clear) {
      await api.terminal.clear();
    }
  });

  registerSettingsTab(api);
  console.log('[code-runner] Commands registered');
}

// ── Helper: guess language from file extension ──────────────────────────────
function guessLanguageFromPath(filePath) {
  if (!filePath) return null;
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', mts: 'typescript',
    jsx: 'javascriptreact', tsx: 'typescriptreact',
    py: 'python', pyw: 'python',
    rb: 'ruby',
    php: 'php',
    pl: 'perl', pm: 'perl',
    lua: 'lua',
    r: 'r', R: 'r',
    sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
    ps1: 'powershell', psm1: 'powershell',
    bat: 'bat', cmd: 'bat',
    c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    cs: 'csharp',
    java: 'java',
    kt: 'kotlin', kts: 'kotlin',
    go: 'go',
    rs: 'rust',
    swift: 'swift',
    dart: 'dart',
    zig: 'zig',
    scala: 'scala',
    groovy: 'groovy',
    clj: 'clojure',
    hs: 'haskell',
    ex: 'elixir', exs: 'elixir',
    erl: 'erlang',
    ml: 'ocaml',
    fs: 'fsharp', fsx: 'fsharp',
    sql: 'sql',
    md: 'markdown',
  };
  return map[ext] || null;
}

// ── Settings tab ─────────────────────────────────────────────────────────────

function registerSettingsTab(api) {
  if (!api.settings?.updateTabContent) return;
  api.settings.updateTabContent('code-runner.settings', {
    sections: [
      {
        title: 'Execution',
        items: [
          { type: 'toggle', key: 'runInTerminal', label: 'Run in Integrated Terminal', description: 'Execute code inside the integrated terminal', defaultValue: true },
          { type: 'toggle', key: 'saveFileBeforeRun', label: 'Save Before Run', description: 'Auto-save the file before execution', defaultValue: true },
          { type: 'toggle', key: 'clearPreviousOutput', label: 'Clear Previous Output', description: 'Clear the previous output before each run', defaultValue: true },
          { type: 'toggle', key: 'showExecutionTime', label: 'Show Execution Time', description: 'Show elapsed time after a run finishes', defaultValue: true },
        ],
      },
      {
        title: 'Customization',
        items: [
          { type: 'text', key: 'cwd', label: 'Working Directory', description: 'Custom CWD (empty = file\'s directory)', placeholder: '/path/to/dir', defaultValue: '' },
          { type: 'text', key: 'defaultProjectRunner', label: 'Default Project Runner', description: 'Custom command for Run Project', placeholder: 'npm start', defaultValue: '' },
        ],
      },
    ],
  });
}

export function deactivate() {
  console.log('[code-runner] Extension deactivated');
}

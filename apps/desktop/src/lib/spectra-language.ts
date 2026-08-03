// ─── Native SpectraLang Support ──────────────────────────────────────────────
// Replaces the `spectra-support` extension. Provides the SpectraLang toolchain
// commands (run / check / compile / lint / format / new project), quick-pick
// actions, keybindings and std.api snippet insertion — all registered in the
// core command/keybinding stores so no extension install is required.
//
// Toolchain: `spectralang` CLI (run/check/compile/lint/fmt/new) + `spectra-lsp`
// (IntelliSense, registered natively in packages/lsp-client).

import { invoke } from '@tauri-apps/api/core';
import * as monaco from 'monaco-editor';
import { useCommandStore } from '@/stores/command-store';
import { useKeybindingStore } from '@/stores/keybinding-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStore } from '@/stores/editor-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useLayoutStore } from '@/stores/layout-store';
import { useProjectStore } from '@/stores/project-store';
import { useExtensionUiStore } from '@/stores/extension-ui-store';
import type { Tab } from '@/stores/editor-store';

// ── Toolchain helpers ────────────────────────────────────────────────────────

function getCliPath(): string {
  return useSettingsStore.getState().spectraCliPath || 'spectralang';
}

function activeFileTab(): Tab | undefined {
  const { tabs, activeTabId } = useEditorStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab || tab.type !== 'file' || !tab.filePath || tab.filePath.startsWith('untitled:')) {
    return undefined;
  }
  return tab;
}

function activeFile(): string {
  return activeFileTab()?.filePath ?? '';
}

function activeFileDir(): string {
  const file = activeFile();
  if (!file) return '';
  const index = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return index > 0 ? file.substring(0, index) : '';
}

function notify(type: 'info' | 'warning' | 'error', message: string): void {
  useExtensionUiStore.getState().showNotification(type, message, 'Spectra');
}

interface CliResult {
  stdout: string;
  exitCode: number;
  error?: string;
}

async function runCli(cli: string, args: string[], cwd?: string): Promise<CliResult> {
  try {
    const stdout = await invoke<string>('shell_exec', { program: cli, args, cwd: cwd ?? null });
    return { stdout: String(stdout ?? ''), exitCode: 0 };
  } catch (err) {
    const message = String(err);
    const match = message.match(/exit[^:]*:\s*(\d+)/i);
    return { stdout: '', exitCode: match ? Number(match[1]) : 1, error: message };
  }
}

function quoteArg(arg: string): string {
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}

function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /win/i.test(navigator.platform);
}

/**
 * Runs a command in the visible integrated terminal (spawning a PTY if needed).
 * Mirrors the extension-host `terminal.sendToActive` implementation.
 */
async function runInTerminal(cli: string, args: string[]): Promise<void> {
  const termStore = useTerminalStore.getState();
  const rootPath = useProjectStore.getState().rootPath;

  let session =
    termStore.sessions.find(
      (s) => s.id === termStore.activeSessionId && !s.isDead && s.ptyId,
    ) ??
    termStore.sessions.find((s) => !s.isAgentSession && !s.isDead && s.ptyId);

  let ptyId = session?.ptyId ?? null;
  let isNewPty = false;

  if (!ptyId) {
    const sessionId = termStore.createSession('Spectra', false, rootPath ?? undefined);
    ptyId = await invoke<string>('pty_spawn', { shell: null, cwd: rootPath ?? null, env: null });
    termStore.setPtyId(sessionId, ptyId);
    isNewPty = true;
  }

  useLayoutStore.getState().setTerminalVisible(true);

  if (isNewPty) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  }

  const callPrefix = isWindows() ? '& ' : '';
  const command = `${callPrefix}${quoteArg(cli)} ${args.map(quoteArg).join(' ')}`;
  await invoke('pty_write', { ptyId, data: command + '\r' });
}

// ── Editor insertion (API actions) ───────────────────────────────────────────

function getActiveCodeEditor(): monaco.editor.ICodeEditor | undefined {
  const editors = monaco.editor.getEditors?.() ?? [];
  const focused = editors.find((e) => e.hasTextFocus());
  if (focused) return focused;

  const file = activeFile();
  if (file) {
    const normalized = file.replace(/\\/g, '/').replace(/^\//, '');
    const match = editors.find((e) => {
      const model = e.getModel();
      return model ? model.uri.path.replace(/^\//, '') === normalized : false;
    });
    if (match) return match;
  }

  return editors[0];
}

async function insertLines(lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  const editor = getActiveCodeEditor();
  if (!editor) {
    notify('warning', 'Abra um arquivo Spectra para inserir o trecho.');
    return;
  }

  const snippet = lines.join('\n');
  try {
    const model = editor.getModel();
    const before = model?.getValue();
    editor.trigger('spectra', 'editor.action.insertSnippet', { snippet });

    // insertSnippet reports success via the model changing — fall back to a
    // plain-text insertion when the action did not apply (e.g. no selection).
    if (model && before !== undefined && model.getValue() === before) {
      const selection = editor.getSelection();
      if (selection) {
        editor.executeEdits('spectra', [{ range: selection, text: snippet, forceMoveMarkers: true }]);
      }
    }
    editor.focus();
  } catch (err) {
    notify('error', `Falha ao inserir: ${String(err)}`);
  }
}

// ── Command handlers ─────────────────────────────────────────────────────────

async function cmdRun(): Promise<void> {
  const file = activeFile();
  if (!file) {
    notify('warning', 'Abra um arquivo .spectra para executar.');
    return;
  }
  try {
    await runInTerminal(getCliPath(), ['run', file]);
  } catch (err) {
    notify('error', `Falha ao executar: ${String(err)}`);
  }
}

async function cmdCheck(): Promise<void> {
  const file = activeFile();
  if (!file) {
    notify('warning', 'Abra um arquivo .spectra para checar.');
    return;
  }
  const result = await runCli(getCliPath(), ['check', file], activeFileDir());
  if (result.error) {
    notify('error', `spectra check: ${result.error}`);
  } else if (result.exitCode === 0) {
    notify('info', 'Check concluído sem erros.');
  } else {
    notify('error', `spectra check encontrou erros (código ${result.exitCode}).`);
  }
}

async function cmdCompile(): Promise<void> {
  const file = activeFile();
  if (!file) {
    notify('warning', 'Abra um arquivo .spectra para compilar.');
    return;
  }
  const result = await runCli(getCliPath(), ['compile', file], activeFileDir());
  if (result.error) {
    notify('error', `spectra compile: ${result.error}`);
  } else if (result.exitCode === 0) {
    notify('info', 'Compilado com sucesso.');
  } else {
    notify('error', `spectra compile falhou (código ${result.exitCode}).`);
  }
}

async function cmdLint(): Promise<void> {
  const cwd = activeFileDir() || '.';
  const result = await runCli(getCliPath(), ['lint', cwd], cwd);
  if (result.error) {
    notify('error', `spectra lint: ${result.error}`);
  } else if (result.exitCode === 0) {
    notify('info', 'Lint concluído sem problemas.');
  } else {
    notify('error', `spectra lint encontrou problemas (código ${result.exitCode}).`);
  }
}

async function cmdFormat(): Promise<void> {
  const file = activeFile();
  if (!file) {
    notify('warning', 'Abra um arquivo .spectra para formatar.');
    return;
  }
  try {
    const result = await runCli(getCliPath(), ['fmt', file], activeFileDir());
    if (result.exitCode === 0) {
      notify('info', 'Arquivo formatado.');
    } else {
      notify('error', `spectra fmt falhou (código ${result.exitCode}).`);
    }
  } catch (err) {
    notify('error', `Falha ao formatar: ${String(err)}`);
  }
}

async function cmdNewProject(): Promise<void> {
  const name = await useExtensionUiStore.getState().showInputBox({
    title: 'Novo Projeto Spectra',
    prompt: 'Nome do projeto',
    placeholder: 'meu-projeto',
    value: '',
  });
  if (!name) return;
  const cleanName = name.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanName)) {
    notify('error', 'Use apenas letras, números, hífens e underscores.');
    return;
  }

  const cwd = activeFileDir() || '.';
  const result = await runCli(getCliPath(), ['new', cleanName], cwd);
  if (result.error) {
    notify('error', `spectra new: ${result.error}`);
  } else if (result.exitCode === 0) {
    notify('info', `Projeto '${cleanName}' criado em ${cwd}.`);
  } else {
    notify('error', `Falha ao criar projeto (código ${result.exitCode}).`);
  }
}

async function cmdCompilerActions(): Promise<void> {
  const execute = (id: string) => useCommandStore.getState().executeCommand(id);
  const items = [
    { label: 'Run current file', description: 'spectra run', value: 'spectra.run' },
    { label: 'Check current file', description: 'spectra check', value: 'spectra.check' },
    { label: 'Compile current file', description: 'spectra compile', value: 'spectra.compile' },
    { label: 'Lint workspace', description: 'spectra lint', value: 'spectra.lint' },
    { label: 'Format current file', description: 'spectra fmt', value: 'spectra.format' },
    { label: 'New Project', description: 'spectra new', value: 'spectra.newProject' },
    { label: 'API Actions...', description: 'spectra.api', value: 'spectra.apiActions' },
  ];
  const selected = await useExtensionUiStore.getState().showQuickPick(items, {
    title: 'Spectra: Compiler Actions',
    placeholder: 'Escolha uma ação',
  });
  if (selected?.value) await execute(selected.value);
}

async function cmdApiActions(): Promise<void> {
  const items = [
    {
      label: 'Insert sync handler',
      description: 'std.api.handler',
      value: 'sync-handler',
    },
    {
      label: 'Insert async handler',
      description: 'async fn handler',
      value: 'async-handler',
    },
    {
      label: 'Insert REST router',
      description: 'std.api.routing',
      value: 'router',
    },
    {
      label: 'Insert CORS policy',
      description: 'std.api.cors',
      value: 'cors',
    },
    {
      label: 'Insert middleware chain',
      description: 'std.api.middleware',
      value: 'middleware',
    },
  ];

  const selected = await useExtensionUiStore.getState().showQuickPick(items, {
    title: 'Spectra: API Actions',
    placeholder: 'Escolha uma ação suportada pela superfície atual',
  });

  switch (selected?.value) {
    case 'sync-handler':
      await insertLines([
        'pub fn ${1:handle}(request: std.api.http.Request) -> std.api.http.Response {',
        '    return std.api.handler.json("${2:{}}");',
        '}',
      ]);
      break;
    case 'async-handler':
      await insertLines([
        'pub async fn ${1:handle}(request: std.api.http.Request) -> std.api.http.Response {',
        '    return std.api.handler.json("${2:{}}");',
        '}',
      ]);
      break;
    case 'router':
      await insertLines([
        'let ${1:router} = std.api.routing.router();',
        'let ${2:route} = std.api.routing.get(${1:router}, "${3:/health}");',
        '${0}',
      ]);
      break;
    case 'cors':
      await insertLines([
        'let ${1:policy} = std.api.cors.permissive();',
        'let ${2:cors} = std.api.cors.middleware(${1:policy});',
        '${0}',
      ]);
      break;
    case 'middleware':
      await insertLines([
        'let ${1:chain} = std.api.middleware.chain();',
        'let ${2:next} = std.api.middleware.use_sync(${1:chain}, ${3:middleware});',
        'let ${4:response} = std.api.middleware.execute_sync(${2:next}, ${5:request}, ${6:response});',
        '${0}',
      ]);
      break;
    default:
      break;
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Registers the native SpectraLang commands and keybindings.
 * Returns a dispose function (safe for React effect cleanup).
 */
export function registerSpectraSupport(): () => void {
  const cmdStore = useCommandStore.getState();
  const kbStore = useKeybindingStore.getState();
  const disposers: Array<() => void> = [];

  const register = (id: string, title: string, handler: () => void | Promise<void>, key?: string) => {
    disposers.push(cmdStore.registerCommand(id, handler, { title, category: 'Spectra' }));
    if (key) {
      disposers.push(kbStore.register({ command: id, key }));
    }
  };

  register('spectra.run', 'Run', cmdRun, 'ctrl+f5');
  register('spectra.check', 'Check (type-check)', cmdCheck, 'ctrl+shift+h');
  register('spectra.compile', 'Compile', cmdCompile);
  register('spectra.lint', 'Lint Workspace', cmdLint);
  register('spectra.format', 'Format File', cmdFormat);
  register('spectra.newProject', 'New Project', cmdNewProject);
  register('spectra.compilerActions', 'Compiler Actions...', cmdCompilerActions);
  register('spectra.apiActions', 'API Actions...', cmdApiActions);

  return () => {
    for (const dispose of disposers) dispose();
  };
}

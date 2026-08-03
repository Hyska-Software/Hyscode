/**
 * spectra-support — Extensão SpectraLang para HysCode
 * Language Server: spectra-lsp (https://github.com/Estevaobonatto/SpectraLang)
 * CLI: spectralang (compile, check, run, lint, fmt, new)
 * Suporte: diagnósticos, hover, completion, go-to-definition, formatação (via LSP)
 */

'use strict';

/** @type {any} */
let api = null;

/** @type {Array<{ dispose(): void } | (() => void)>} */
let disposables = [];

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────────

async function getCliPath() {
  return (await api.settings?.get?.('cliPath')) || 'spectralang';
}

function isWindows() {
  return typeof navigator !== 'undefined' && /win/i.test(navigator.platform);
}

function quoteArg(arg) {
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}

/**
 * Executa o CLI no terminal visível (para run).
 * @param {string} cli
 * @param {string[]} args
 */
function runInTerminal(cli, args) {
  const callPrefix = isWindows() ? '& ' : '';
  const command = `${callPrefix}${quoteArg(cli)} ${args.map(quoteArg).join(' ')}`;
  return api.terminal.sendToActive(command);
}

/**
 * Executa o CLI em background e retorna a saída.
 * @param {string} cli
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {Promise<{ stdout: string, exitCode: number }>}
 */
async function runCli(cli, args, cwd) {
  try {
    const stdout = await api.process.exec(cli, args, cwd);
    return { stdout: String(stdout ?? ''), exitCode: 0 };
  } catch (err) {
    const message = String(err);
    const match = message.match(/exit[^:]*:\s*(\d+)/i);
    return { stdout: '', exitCode: match ? Number(match[1]) : 1, error: message };
  }
}

/**
 * Diretório do arquivo ativo (ou '' se indisponível).
 */
async function activeFileDir() {
  const file = await api.editor?.getCurrentFile?.();
  if (!file) return '';
  const index = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return index > 0 ? file.substring(0, index) : '';
}

/**
 * Caminho do arquivo .spectra ativo (ou '' se nenhum).
 */
async function activeFile() {
  return (await api.editor?.getCurrentFile?.()) || '';
}

/**
 * Registra um comando e adiciona à lista de disposables.
 * @param {string} id
 * @param {() => void | Promise<void>} handler
 */
function register(id, handler) {
  const d = api.commands.register(id, handler);
  disposables.push(d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Activate
// ─────────────────────────────────────────────────────────────────────────────

export async function activate(context) {
  api = context._api || globalThis.hyscode;
  if (!api) return;

  // ── Build & Run ───────────────────────────────────────────────────────────

  register('spectra.run', async () => {
    const file = await activeFile();
    if (!file) {
      api.notifications.showWarning('Abra um arquivo .spectra para executar.');
      return;
    }
    const cli = await getCliPath();
    try {
      await runInTerminal(cli, ['run', file]);
    } catch (err) {
      api.notifications.showError(`Falha ao executar: ${err}`);
    }
  });

  register('spectra.check', async () => {
    const file = await activeFile();
    if (!file) {
      api.notifications.showWarning('Abra um arquivo .spectra para checar.');
      return;
    }
    const cli = await getCliPath();
    const cwd = await activeFileDir();
    api.notifications.showProgress('Spectra: check', async (reporter) => {
      reporter.report({ message: 'Verificando tipos...' });
      const result = await runCli(cli, ['check', file], cwd);
      if (result.error) {
        api.notifications.showError(`spectra check: ${result.error}`);
      } else if (result.exitCode === 0) {
        api.notifications.showInfo('Check concluído sem erros.');
      } else {
        api.notifications.showError(`spectra check encontrou erros (código ${result.exitCode}).`);
      }
    });
  });

  register('spectra.compile', async () => {
    const file = await activeFile();
    if (!file) {
      api.notifications.showWarning('Abra um arquivo .spectra para compilar.');
      return;
    }
    const cli = await getCliPath();
    const cwd = await activeFileDir();
    api.notifications.showProgress('Spectra: compile', async (reporter) => {
      reporter.report({ message: 'Compilando...' });
      const result = await runCli(cli, ['compile', file], cwd);
      if (result.error) {
        api.notifications.showError(`spectra compile: ${result.error}`);
      } else if (result.exitCode === 0) {
        api.notifications.showInfo('Compilado com sucesso.');
      } else {
        api.notifications.showError(`spectra compile falhou (código ${result.exitCode}).`);
      }
    });
  });

  register('spectra.lint', async () => {
    const cwd = (await activeFileDir()) || '.';
    const cli = await getCliPath();
    api.notifications.showProgress('Spectra: lint', async (reporter) => {
      reporter.report({ message: 'Executando lint...' });
      const result = await runCli(cli, ['lint', cwd], cwd);
      if (result.error) {
        api.notifications.showError(`spectra lint: ${result.error}`);
      } else if (result.exitCode === 0) {
        api.notifications.showInfo('Lint concluído sem problemas.');
      } else {
        api.notifications.showError(`spectra lint encontrou problemas (código ${result.exitCode}).`);
      }
    });
  });

  register('spectra.format', async () => {
    const file = await activeFile();
    if (!file) {
      api.notifications.showWarning('Abra um arquivo .spectra para formatar.');
      return;
    }
    const cli = await getCliPath();
    try {
      const result = await runCli(cli, ['fmt', file]);
      if (result.exitCode === 0) {
        api.notifications.showInfo('Arquivo formatado.');
      } else {
        api.notifications.showError(`spectra fmt falhou (código ${result.exitCode}).`);
      }
    } catch (err) {
      api.notifications.showError(`Falha ao formatar: ${err}`);
    }
  });

  // ── Scaffolding ───────────────────────────────────────────────────────────

  register('spectra.newProject', async () => {
    const name = await api.window.showInputBox({
      title: 'Novo Projeto Spectra',
      prompt: 'Nome do projeto',
      placeHolder: 'meu-projeto',
      value: '',
    });
    if (!name) return;
    const cleanName = name.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanName)) {
      api.notifications.showError('Use apenas letras, números, hífens e underscores.');
      return;
    }

    const cwd = (await activeFileDir()) || '.';
    api.notifications.showProgress('Spectra: new project', async (reporter) => {
      reporter.report({ message: `Criando '${cleanName}'...` });
      const result = await runCli(await getCliPath(), ['new', cleanName], cwd);
      if (result.error) {
        api.notifications.showError(`spectra new: ${result.error}`);
      } else if (result.exitCode === 0) {
        api.notifications.showInfo(`Projeto '${cleanName}' criado em ${cwd}.`);
      } else {
        api.notifications.showError(`Falha ao criar projeto (código ${result.exitCode}).`);
      }
    });
  });

  // ── Compiler actions ──────────────────────────────────────────────────────

  register('spectra.compilerActions', async () => {
    const items = [
      { label: 'Run current file', description: 'spectra run', action: () => api.commands.executeCommand('spectra.run') },
      { label: 'Check current file', description: 'spectra check', action: () => api.commands.executeCommand('spectra.check') },
      { label: 'Compile current file', description: 'spectra compile', action: () => api.commands.executeCommand('spectra.compile') },
      { label: 'Lint workspace', description: 'spectra lint', action: () => api.commands.executeCommand('spectra.lint') },
      { label: 'Format current file', description: 'spectra fmt', action: () => api.commands.executeCommand('spectra.format') },
      { label: 'New Project', description: 'spectra new', action: () => api.commands.executeCommand('spectra.newProject') },
      { label: 'API Actions...', description: 'spectra.api', action: () => api.commands.executeCommand('spectra.apiActions') },
    ];

    const selected = await api.window.showQuickPick(items, {
      title: 'Spectra: Compiler Actions',
      placeHolder: 'Escolha uma ação',
    });
    if (selected) await selected.action();
  });

  // ── API actions ───────────────────────────────────────────────────────────

  register('spectra.apiActions', async () => {
    const items = [
      { label: 'Insert sync handler', description: 'std.api.handler', body: () => insertLines([
        'pub fn ${1:handle}(request: std.api.http.Request) -> std.api.http.Response {',
        '    return std.api.handler.json("${2:{}}");',
        '}',
      ]) },
      { label: 'Insert async handler', description: 'async fn handler', body: () => insertLines([
        'pub async fn ${1:handle}(request: std.api.http.Request) -> std.api.http.Response {',
        '    return std.api.handler.json("${2:{}}");',
        '}',
      ]) },
      { label: 'Insert REST router', description: 'std.api.routing', body: () => insertLines([
        'let ${1:router} = std.api.routing.router();',
        'let ${2:route} = std.api.routing.get(${1:router}, "${3:/health}");',
        '${0}',
      ]) },
      { label: 'Insert CORS policy', description: 'std.api.cors', body: () => insertLines([
        'let ${1:policy} = std.api.cors.permissive();',
        'let ${2:cors} = std.api.cors.middleware(${1:policy});',
        '${0}',
      ]) },
      { label: 'Insert middleware chain', description: 'std.api.middleware', body: () => insertLines([
        'let ${1:chain} = std.api.middleware.chain();',
        'let ${2:next} = std.api.middleware.use_sync(${1:chain}, ${3:middleware});',
        'let ${4:response} = std.api.middleware.execute_sync(${2:next}, ${5:request}, ${6:response});',
        '${0}',
      ]) },
    ];

    const selected = await api.window.showQuickPick(items, {
      title: 'Spectra: API Actions',
      placeHolder: 'Escolha uma ação suportada pela superfície atual',
    });
    if (selected) await selected.body();
  });

  // ── Settings tab ──────────────────────────────────────────────────────────

  if (api.settings?.updateTabContent) {
    api.settings.updateTabContent('spectra-support.settings', {
      sections: [
        {
          title: 'Toolchain',
          items: [
            { type: 'text', key: 'cliPath', label: 'spectralang Path', description: 'Caminho para o binário spectralang (vazio = PATH)', placeholder: 'spectralang', defaultValue: 'spectralang' },
            { type: 'toggle', key: 'lintOnSave', label: 'Lint on Save', description: 'Incluir avisos de lint ao salvar (via LSP)', defaultValue: true },
            { type: 'toggle', key: 'formatOnSave', label: 'Format on Save', description: 'Formatar arquivos Spectra ao salvar (via LSP)', defaultValue: false },
          ],
        },
      ],
    });
  }

  console.log('SpectraLang support ativada!');
}

// ─────────────────────────────────────────────────────────────────────────────
// Deactivate
// ─────────────────────────────────────────────────────────────────────────────

export function deactivate() {
  disposables.forEach((d) => {
    if (typeof d === 'function') d();
    else if (d && typeof d.dispose === 'function') d.dispose();
  });
  disposables = [];
  api = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de edição
// ─────────────────────────────────────────────────────────────────────────────

async function insertLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return;
  const text = lines.join('\n');
  try {
    await api.editor.insertText(text);
  } catch (err) {
    api.notifications.showError(`Falha ao inserir: ${err}`);
  }
}

// git-pulse — main.js
// Git Supercharger for HysCode: blame, file history, diff, branch info

'use strict';

/** @type {import('../../packages/extension-api/src').HyscodeAPI | null} */
let h = null;

let blameEnabled = true;
let currentBlameData = null;
let fileHistory = [];
let workingTreeStatus = [];
let searchQuery = '';

// ── Color scheme for diff indicators ─────────────────────────────────────────
const DIFF_COLORS = {
  added:    '#4ade80',
  modified: '#facc15',
  deleted:  '#f87171',
  untracked:'#94a3b8',
  renamed:  '#a78bfa',
};

const STATUS_LABELS = {
  added:    'A',
  modified: 'M',
  deleted:  'D',
  untracked:'?',
  renamed:  'R',
};

// ── Activate ──────────────────────────────────────────────────────────────────

export async function activate(context, api) {
  h = api || context._api || globalThis.hyscode;
  if (!h) { console.warn('[git-pulse] HysCode API unavailable'); return; }

  console.log('[git-pulse] activated');

  blameEnabled = (await h.settings.get('gitPulse.blameEnabled', true)) ?? true;

  // ── Register commands ─────────────────────────────────────────────────────

  h.commands.register('gitPulse.refresh', async () => {
    h.notifications.showInfo('Git Pulse: atualizando...');
    await refreshAll();
    h.notifications.showInfo('Git Pulse: atualizado.');
  });

  h.commands.register('gitPulse.toggleBlame', async () => {
    blameEnabled = !blameEnabled;
    await h.settings.set('gitPulse.blameEnabled', blameEnabled);
    h.notifications.showInfo(`Git Pulse: blame ${blameEnabled ? 'ativado' : 'desativado'}`);
    await refreshPanel();
  });

  h.commands.register('gitPulse.showHistory', async () => {
    const filePath = h.editor.activeFilePath;
    if (!filePath) {
      h.window.showWarningMessage('Nenhum arquivo ativo para mostrar histórico.');
      return;
    }
    await loadFileHistory(filePath);
    h.views.revealView('gitPulse.panel');
  });

  h.commands.register('gitPulse.showDiff', async () => {
    const diff = await h.git.diff();
    if (!diff || diff.trim() === '') {
      h.window.showInformationMessage('Git Pulse: nenhuma alteração pendente.');
      return;
    }
    const tmpPath = (h.workspace.rootPath || '.') + '/.git-pulse-diff.diff';
    await h.workspace.writeFile(tmpPath, diff);
    await h.editor.openFile(tmpPath);
  });

  h.commands.register('gitPulse.copySha', async () => {
    if (!currentBlameData || currentBlameData.length === 0) {
      h.window.showWarningMessage('Git Pulse: sem dados de blame para copiar SHA.');
      return;
    }
    const entry = currentBlameData[0];
    if (entry?.sha) {
      try {
        await navigator.clipboard.writeText(entry.sha);
        h.notifications.showInfo(`SHA copiado: ${entry.sha.substring(0, 8)}`);
      } catch {
        h.window.showInformationMessage(`SHA: ${entry.sha}`);
      }
    }
  });

  h.commands.register('gitPulse.showBranchInfo', async () => {
    const branch = await h.git.currentBranch();
    const status = await h.git.status();
    const modified = status.filter(f => f.status === 'modified').length;
    const added    = status.filter(f => f.status === 'added').length;
    const deleted  = status.filter(f => f.status === 'deleted').length;

    const parts = [`Branch: ${branch || 'desconhecido'}`];
    if (modified) parts.push(`${modified} modificado(s)`);
    if (added)    parts.push(`${added} adicionado(s)`);
    if (deleted)  parts.push(`${deleted} removido(s)`);

    h.window.showInformationMessage(parts.join('  ·  '));
  });

  h.commands.register('gitPulse.openCommit', async () => {
    if (fileHistory.length === 0) {
      h.window.showWarningMessage('Git Pulse: carregue o histórico primeiro (Ctrl+Alt+H).');
      return;
    }
    const items = fileHistory.slice(0, 20).map(c => ({
      label: c.sha ? c.sha.substring(0, 8) : '?',
      description: c.message || '',
      detail: `${c.author || ''}  ${formatDate(c.date)}`,
    }));

    const choice = await h.window.showQuickPick(items, {
      placeholder: 'Selecionar commit para inspecionar',
    });
    if (choice) {
      h.notifications.showInfo(`Commit selecionado: ${choice.label} — ${choice.description}`);
    }
  });

  h.commands.register('gitPulse.showStatus', async () => {
    await loadStatus();
    h.views.revealView('gitPulse.panel');
  });

  // ── Views: search listener ────────────────────────────────────────────────

  h.views.onDidChangeSearch('gitPulse.panel', (query) => {
    searchQuery = query.toLowerCase();
    refreshPanel();
  });

  h.views.onDidChangeVisibility('gitPulse.panel', (visible) => {
    if (visible) refreshAll();
  });

  // ── Settings tab ──────────────────────────────────────────────────────────

  h.settings.onTabVisible('git-pulse.settings', () => registerSettingsTab());
  registerSettingsTab();

  // ── Initial load ──────────────────────────────────────────────────────────

  await refreshAll();

  console.log('[git-pulse] commands registered');
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function refreshAll() {
  await loadStatus();
  const filePath = h?.editor?.activeFilePath;
  if (filePath) await loadFileHistory(filePath);
}

async function loadStatus() {
  workingTreeStatus = await h.git.status();
  await refreshPanel();
}

async function loadFileHistory(filePath) {
  // Parse git log from workspace using Tauri fs integration
  // Currently git.status() and diff() are stubs — populate with real data when available
  fileHistory = buildDemoHistory(filePath);
  await refreshPanel();
}

function buildDemoHistory(filePath) {
  // Placeholder history — replaced by real git log when git API is fully implemented
  const fileName = filePath ? filePath.split(/[/\\]/).pop() : 'file';
  return [
    { sha: 'a1b2c3d4e5f6', author: 'Dev', date: new Date(Date.now() - 3600_000), message: `Update ${fileName}` },
    { sha: 'f6e5d4c3b2a1', author: 'Dev', date: new Date(Date.now() - 86400_000), message: `Add ${fileName}` },
  ];
}

// ── View rendering ────────────────────────────────────────────────────────────

async function refreshPanel() {
  if (!h?.views) return;

  const branch   = await h.git.currentBranch();
  const filePath = h.editor.activeFilePath;
  const fileName = filePath ? filePath.split(/[/\\]/).pop() : null;

  // Filter by search
  const filteredStatus = workingTreeStatus.filter(f =>
    !searchQuery || f.path.toLowerCase().includes(searchQuery)
  );
  const filteredHistory = fileHistory.filter(c =>
    !searchQuery ||
    (c.message && c.message.toLowerCase().includes(searchQuery)) ||
    (c.author && c.author.toLowerCase().includes(searchQuery))
  );

  // Badge = number of changed files
  h.views.setViewBadge('gitPulse.panel', workingTreeStatus.length > 0
    ? { count: workingTreeStatus.length, tooltip: `${workingTreeStatus.length} arquivo(s) alterado(s)` }
    : null
  );

  // ── Build status section items ──────────────────────────────────────────

  const statusItems = filteredStatus.map(f => ({
    id: `status-${f.path}`,
    label: f.path.split(/[/\\]/).pop() || f.path,
    description: f.path,
    icon: '$(file)',
    iconColor: DIFF_COLORS[f.status] || '#94a3b8',
    badge: STATUS_LABELS[f.status] || '?',
    badgeColor: DIFF_COLORS[f.status] || '#94a3b8',
    tooltip: `${f.status}: ${f.path}`,
    command: 'gitPulse.showDiff',
    contextMenu: [
      { id: 'open', label: 'Abrir arquivo', icon: '$(file)', command: 'gitPulse.showStatus', commandArgs: [f.path] },
    ],
  }));

  // ── Build history section items ─────────────────────────────────────────

  const historyItems = filteredHistory.map((c, i) => ({
    id: `commit-${i}`,
    label: c.sha ? c.sha.substring(0, 8) : '?',
    description: c.message || '',
    icon: '$(git-commit)',
    tooltip: `${c.author}  ${formatDate(c.date)}\n${c.message}`,
    command: 'gitPulse.openCommit',
    decorations: { italic: false },
  }));

  // ── Sections view ───────────────────────────────────────────────────────

  const sections = [];

  // Branch info as stats
  sections.push({
    id: 'branch',
    title: 'Branch',
    type: 'stats',
    stats: [
      { label: 'Branch', value: branch || '—',                       icon: '$(git-branch)', color: '#a78bfa' },
      { label: 'Alterações', value: workingTreeStatus.length,          icon: '$(diff)',       color: '#facc15' },
      { label: 'Blame',   value: blameEnabled ? 'Ativo' : 'Inativo',  icon: '$(eye)',        color: blameEnabled ? '#4ade80' : '#94a3b8' },
    ],
  });

  // Actions
  sections.push({
    id: 'actions',
    title: 'Ações',
    type: 'actions',
    actions: [
      { id: 'refresh',  label: 'Refresh',       icon: '$(refresh)',    command: 'gitPulse.refresh' },
      { id: 'blame',    label: 'Toggle Blame',   icon: '$(eye)',        command: 'gitPulse.toggleBlame' },
      { id: 'diff',     label: 'Ver Diff',       icon: '$(diff)',       command: 'gitPulse.showDiff' },
      { id: 'history',  label: 'Histórico',      icon: '$(history)',    command: 'gitPulse.showHistory' },
    ],
  });

  // Working tree
  sections.push({
    id: 'changes',
    title: `Alterações (${filteredStatus.length})`,
    type: 'list',
    collapsible: true,
    collapsed: filteredStatus.length === 0,
    items: statusItems.length > 0 ? statusItems : [{
      id: 'no-changes',
      label: 'Árvore de trabalho limpa',
      icon: '$(check)',
      iconColor: '#4ade80',
      decorations: { italic: true, faded: true },
    }],
  });

  // File history
  if (fileName) {
    sections.push({
      id: 'history',
      title: `Histórico: ${fileName}`,
      type: 'list',
      collapsible: true,
      collapsed: false,
      items: historyItems.length > 0 ? historyItems : [{
        id: 'no-history',
        label: 'Nenhum commit encontrado',
        decorations: { italic: true, faded: true },
      }],
    });
  }

  h.views.updateView('gitPulse.panel', {
    type: 'sections',
    searchable: true,
    searchPlaceholder: 'Filtrar arquivos e commits...',
    toolbar: [
      { id: 'refresh', label: 'Refresh', icon: '$(refresh)', tooltip: 'Atualizar', command: 'gitPulse.refresh' },
      { id: 'diff',    label: 'Diff',    icon: '$(diff)',     tooltip: 'Mostrar diff', command: 'gitPulse.showDiff' },
    ],
    sections,
    footer: { text: branch ? `⎇ ${branch}` : 'git-pulse', command: 'gitPulse.showBranchInfo' },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const diff = Date.now() - d.getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'agora';
  if (mins < 60)  return `${mins}m atrás`;
  if (hours < 24) return `${hours}h atrás`;
  if (days < 30)  return `${days}d atrás`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function registerSettingsTab() {
  h.settings.updateTabContent('git-pulse.settings', {
    sections: [
      {
        id: 'blame',
        title: 'Blame Inline',
        items: [
          { id: 'blameEnabled',       type: 'toggle', settingKey: 'gitPulse.blameEnabled',       label: 'Ativar Blame', description: 'Mostrar anotações de blame no editor', default: true },
          { id: 'blameFormat',        type: 'text',   settingKey: 'gitPulse.blameFormat',         label: 'Formato do Blame', description: 'Variáveis: {author}, {date}, {sha}, {message}', default: '{author}, {date} · {message}' },
          { id: 'dateFormat',         type: 'select', settingKey: 'gitPulse.dateFormat',          label: 'Formato de Data', default: 'relative', options: [{ value: 'relative', label: 'Relativo (3 dias atrás)' }, { value: 'absolute', label: 'Absoluto (dd/mm/yyyy)' }] },
          { id: 'maxHistory',         type: 'number', settingKey: 'gitPulse.maxHistoryItems',     label: 'Máx. itens de histórico', default: 50, min: 10, max: 500 },
        ],
      },
      {
        id: 'display',
        title: 'Exibição',
        items: [
          { id: 'showStatusBar',      type: 'toggle', settingKey: 'gitPulse.showStatusInStatusBar', label: 'Branch na Status Bar', description: 'Mostrar branch atual na barra de status', default: true },
          { id: 'showDiffDecoration', type: 'toggle', settingKey: 'gitPulse.showDiffDecorations',   label: 'Indicadores de Diff', description: 'Indicadores de diff na gutter do editor', default: true },
        ],
      },
      {
        id: 'actions',
        title: 'Ações',
        items: [
          { id: 'refreshBtn', type: 'button', label: 'Atualizar agora', buttonLabel: 'Refresh', command: 'gitPulse.refresh' },
        ],
      },
    ],
  });
}

// ── Deactivate ────────────────────────────────────────────────────────────────

export function deactivate() {
  console.log('[git-pulse] deactivated');
  fileHistory = [];
  workingTreeStatus = [];
  currentBlameData = null;
}

// error-beam — main.js
// Inline diagnostic display: shows errors and warnings next to offending lines

'use strict';

/** @type {import('../../packages/extension-api/src').HyscodeAPI | null} */
let h = null;

let enabled = true;
let diagnostics = [];  // { uri, message, severity, range, source, code }
let currentIndex = -1;
let searchQuery = '';

// ── Severity meta ─────────────────────────────────────────────────────────────
const SEVERITY_META = {
  error:   { icon: '$(error)',   color: '#f87171', label: 'Erro',  order: 0 },
  warning: { icon: '$(warning)', color: '#fb923c', label: 'Aviso', order: 1 },
  info:    { icon: '$(info)',    color: '#60a5fa', label: 'Info',  order: 2 },
  hint:    { icon: '$(lightbulb)', color: '#94a3b8', label: 'Dica', order: 3 },
};

// ── Activate ──────────────────────────────────────────────────────────────────

export async function activate(context, api) {
  h = api || context._api || globalThis.hyscode;
  if (!h) { console.warn('[error-beam] HysCode API unavailable'); return; }

  console.log('[error-beam] activated');

  enabled = (await h.settings.get('errorBeam.enabled', true)) ?? true;

  // ── Register commands ─────────────────────────────────────────────────────

  h.commands.register('errorBeam.toggle', async () => {
    enabled = !enabled;
    await h.settings.set('errorBeam.enabled', enabled);
    h.notifications.showInfo(`Error Beam: ${enabled ? 'ativado' : 'desativado'}`);
    await renderPanel();
  });

  h.commands.register('errorBeam.nextError', async () => {
    const errors = filteredItems();
    if (errors.length === 0) {
      h.window.showInformationMessage('Error Beam: nenhum erro/aviso encontrado.');
      return;
    }
    currentIndex = (currentIndex + 1) % errors.length;
    const item = errors[currentIndex];
    await navigateTo(item);
  });

  h.commands.register('errorBeam.prevError', async () => {
    const errors = filteredItems();
    if (errors.length === 0) {
      h.window.showInformationMessage('Error Beam: nenhum erro/aviso encontrado.');
      return;
    }
    currentIndex = (currentIndex - 1 + errors.length) % errors.length;
    const item = errors[currentIndex];
    await navigateTo(item);
  });

  h.commands.register('errorBeam.showPanel', () => {
    h.views.revealView('errorBeam.panel');
  });

  h.commands.register('errorBeam.clearAll', async () => {
    diagnostics = [];
    currentIndex = -1;
    await renderPanel();
    h.notifications.showInfo('Error Beam: diagnósticos limpos.');
  });

  h.commands.register('errorBeam.copyMessage', async () => {
    const errors = filteredItems();
    if (errors.length === 0) {
      h.window.showWarningMessage('Error Beam: nenhum diagnóstico para copiar.');
      return;
    }
    const item = errors[Math.max(0, currentIndex)];
    const text = `[${item.severity?.toUpperCase()}] ${item.message} (${item.uri}:${item.range?.startLine ?? 0})`;
    try {
      await navigator.clipboard.writeText(text);
      h.notifications.showInfo('Mensagem de erro copiada.');
    } catch {
      h.window.showInformationMessage(text);
    }
  });

  h.commands.register('errorBeam.refresh', async () => {
    await scanDiagnostics();
    h.notifications.showInfo(`Error Beam: ${diagnostics.length} diagnóstico(s) encontrado(s).`);
  });

  // ── Internal command to navigate from panel click ─────────────────────────

  h.commands.register('errorBeam.goToItem', async (uri, line) => {
    if (uri) {
      await h.editor.openFile(String(uri));
    }
  });

  // ── Views ─────────────────────────────────────────────────────────────────

  h.views.onDidChangeSearch('errorBeam.panel', (query) => {
    searchQuery = query.toLowerCase();
    renderPanel();
  });

  h.views.onDidChangeVisibility('errorBeam.panel', (visible) => {
    if (visible) scanDiagnostics();
  });

  // ── Settings tab ──────────────────────────────────────────────────────────

  h.settings.onTabVisible('error-beam.settings', () => registerSettingsTab());
  registerSettingsTab();

  // ── Initial scan ──────────────────────────────────────────────────────────

  await scanDiagnostics();

  console.log('[error-beam] commands registered');
}

// ── Diagnostics scan ─────────────────────────────────────────────────────────
// When the language diagnostics API is fully implemented this method will use
// real linter output. Currently renders the welcome state for the panel.

async function scanDiagnostics() {
  // Placeholder: diagnostics are set via api.languages.setLanguageDiagnostics()
  // Extensions like linters call setLanguageDiagnostics and Error Beam picks them up.
  // For now we keep the array stable and just re-render.
  await renderPanel();
}

/** Add or replace diagnostics for a given file URI (called by language servers). */
function setDiagnostics(uri, items) {
  diagnostics = [
    ...diagnostics.filter(d => d.uri !== uri),
    ...items.map(d => ({ ...d, uri })),
  ];
  renderPanel();
}

// ── Panel rendering ───────────────────────────────────────────────────────────

async function renderPanel() {
  if (!h?.views) return;

  const showErrors   = (await h.settings.get('errorBeam.showErrors',   true)) ?? true;
  const showWarnings = (await h.settings.get('errorBeam.showWarnings', true)) ?? true;
  const showInfos    = (await h.settings.get('errorBeam.showInfos',    false)) ?? false;

  const all = filteredItems({ showErrors, showWarnings, showInfos });

  // Group by file
  const byFile = new Map();
  for (const d of all) {
    const key = d.uri || 'unknown';
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(d);
  }

  const errorCount   = all.filter(d => d.severity === 'error').length;
  const warningCount = all.filter(d => d.severity === 'warning').length;

  // Badge
  h.views.setViewBadge('errorBeam.panel', (errorCount + warningCount) > 0
    ? { count: errorCount + warningCount, tooltip: `${errorCount} erro(s), ${warningCount} aviso(s)` }
    : null
  );

  if (!enabled) {
    h.views.updateView('errorBeam.panel', {
      type: 'welcome',
      welcome: {
        icon: '$(eye-closed)',
        title: 'Error Beam desativado',
        description: 'Ative para ver diagnósticos inline.',
        actions: [
          { id: 'enable', label: 'Ativar', icon: '$(eye)', command: 'errorBeam.toggle' },
        ],
      },
    });
    return;
  }

  if (diagnostics.length === 0) {
    h.views.updateView('errorBeam.panel', {
      type: 'welcome',
      welcome: {
        icon: '$(check)',
        title: 'Sem problemas',
        description: 'Nenhum erro ou aviso encontrado no workspace.',
        actions: [
          { id: 'refresh', label: 'Verificar novamente', icon: '$(refresh)', command: 'errorBeam.refresh' },
        ],
      },
    });
    return;
  }

  // Build sections — one per file
  const sections = [];

  // Summary stats
  sections.push({
    id: 'summary',
    title: 'Resumo',
    type: 'stats',
    stats: [
      { label: 'Erros',   value: errorCount,                  icon: '$(error)',   color: '#f87171', command: 'errorBeam.nextError' },
      { label: 'Avisos',  value: warningCount,                icon: '$(warning)', color: '#fb923c' },
      { label: 'Arquivos', value: byFile.size,                 icon: '$(file)',    color: '#60a5fa' },
      { label: 'Status',  value: enabled ? 'Ativo' : 'Off',   icon: '$(eye)',     color: enabled ? '#4ade80' : '#94a3b8' },
    ],
  });

  // Actions
  sections.push({
    id: 'actions',
    title: 'Ações',
    type: 'actions',
    actions: [
      { id: 'next',    label: 'Próximo',   icon: '$(arrow-down)',  command: 'errorBeam.nextError' },
      { id: 'prev',    label: 'Anterior',  icon: '$(arrow-up)',    command: 'errorBeam.prevError' },
      { id: 'refresh', label: 'Refresh',   icon: '$(refresh)',     command: 'errorBeam.refresh' },
      { id: 'clear',   label: 'Limpar',    icon: '$(trash)',       command: 'errorBeam.clearAll' },
    ],
  });

  // Per-file sections
  for (const [uri, items] of byFile) {
    const fileName = uri.split(/[/\\]/).pop() || uri;
    const fileErrors = items.filter(d => d.severity === 'error').length;

    sections.push({
      id: `file-${uri}`,
      title: fileName,
      badge: String(items.length),
      badgeColor: fileErrors > 0 ? '#f87171' : '#fb923c',
      type: 'list',
      collapsible: true,
      collapsed: false,
      items: items
        .sort((a, b) => (a.range?.startLine ?? 0) - (b.range?.startLine ?? 0))
        .map((d, i) => {
          const meta = SEVERITY_META[d.severity] || SEVERITY_META.hint;
          const line = d.range?.startLine != null ? d.range.startLine + 1 : '?';
          return {
            id: `diag-${uri}-${i}`,
            label: `${d.message || '(sem mensagem)'}`,
            description: `linha ${line}${d.source ? ` · ${d.source}` : ''}`,
            icon: meta.icon,
            iconColor: meta.color,
            tooltip: `[${meta.label}] ${d.message}\n${uri}:${line}`,
            command: 'errorBeam.goToItem',
            commandArgs: [uri, d.range?.startLine ?? 0],
            contextMenu: [
              { id: 'copy', label: 'Copiar mensagem', icon: '$(copy)', command: 'errorBeam.copyMessage' },
            ],
          };
        }),
    });
  }

  h.views.updateView('errorBeam.panel', {
    type: 'sections',
    searchable: true,
    searchPlaceholder: 'Filtrar erros e avisos...',
    toolbar: [
      { id: 'toggle',  label: 'Toggle',  icon: '$(eye)',     tooltip: 'Toggle Error Beam', command: 'errorBeam.toggle' },
      { id: 'refresh', label: 'Refresh', icon: '$(refresh)', tooltip: 'Refresh',           command: 'errorBeam.refresh' },
    ],
    sections,
    footer: { text: `${errorCount} erro(s) · ${warningCount} aviso(s)`, command: 'errorBeam.nextError' },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function filteredItems({ showErrors = true, showWarnings = true, showInfos = false } = {}) {
  return diagnostics.filter(d => {
    if (d.severity === 'error'   && !showErrors)   return false;
    if (d.severity === 'warning' && !showWarnings) return false;
    if ((d.severity === 'info' || d.severity === 'hint') && !showInfos) return false;
    if (searchQuery) {
      const haystack = `${d.message || ''} ${d.uri || ''} ${d.source || ''}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  });
}

async function navigateTo(item) {
  if (item?.uri) await h.editor.openFile(item.uri);
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function registerSettingsTab() {
  h.settings.updateTabContent('error-beam.settings', {
    sections: [
      {
        id: 'general',
        title: 'Geral',
        items: [
          { id: 'enabled',      type: 'toggle', settingKey: 'errorBeam.enabled',      label: 'Ativar Error Beam',    default: true },
          { id: 'showErrors',   type: 'toggle', settingKey: 'errorBeam.showErrors',   label: 'Mostrar Erros',        default: true },
          { id: 'showWarnings', type: 'toggle', settingKey: 'errorBeam.showWarnings', label: 'Mostrar Avisos',       default: true },
          { id: 'showInfos',    type: 'toggle', settingKey: 'errorBeam.showInfos',    label: 'Mostrar Informações',  default: false },
        ],
      },
      {
        id: 'appearance',
        title: 'Aparência',
        items: [
          { id: 'errorColor',   type: 'color',  settingKey: 'errorBeam.errorColor',   label: 'Cor de Erro',       default: '#f87171' },
          { id: 'warningColor', type: 'color',  settingKey: 'errorBeam.warningColor', label: 'Cor de Aviso',      default: '#fb923c' },
          { id: 'infoColor',    type: 'color',  settingKey: 'errorBeam.infoColor',    label: 'Cor de Informação', default: '#60a5fa' },
          { id: 'fontStyle',    type: 'select', settingKey: 'errorBeam.fontStyle',    label: 'Estilo da Fonte', default: 'italic',
            options: [{ value: 'italic', label: 'Itálico' }, { value: 'normal', label: 'Normal' }] },
          { id: 'template',     type: 'text',   settingKey: 'errorBeam.messageTemplate', label: 'Template',
            description: 'Variáveis: {message} {source} {code} {severity}', default: '  ⚑ {message} [{source}]' },
        ],
      },
      {
        id: 'actions',
        title: 'Ações',
        items: [
          { id: 'refreshBtn', type: 'button', label: 'Verificar diagnósticos', buttonLabel: 'Refresh', command: 'errorBeam.refresh' },
          { id: 'clearBtn',   type: 'button', label: 'Limpar todos',           buttonLabel: 'Limpar',  command: 'errorBeam.clearAll', variant: 'danger' },
        ],
      },
    ],
  });
}

// ── Deactivate ────────────────────────────────────────────────────────────────

export function deactivate() {
  console.log('[error-beam] deactivated');
  diagnostics = [];
}

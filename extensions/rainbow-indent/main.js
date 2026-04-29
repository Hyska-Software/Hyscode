// rainbow-indent — main.js
// Colorize indentation levels with alternating colors for better readability

'use strict';

/** @type {import('../../packages/extension-api/src').HyscodeAPI | null} */
let h = null;

let enabled = true;
let activeDecorations = null;
let currentScheme = 'default';

// ── Color schemes ─────────────────────────────────────────────────────────────
const COLOR_SCHEMES = {
  default: [
    'rgba(255,213,0,0.18)',
    'rgba(218,112,214,0.18)',
    'rgba(23,159,255,0.18)',
    'rgba(255,107,107,0.18)',
    'rgba(152,195,121,0.18)',
    'rgba(198,120,221,0.18)',
  ],
  pastel: [
    'rgba(249,200,132,0.22)',
    'rgba(232,160,208,0.22)',
    'rgba(160,196,255,0.22)',
    'rgba(255,179,179,0.22)',
    'rgba(181,234,215,0.22)',
    'rgba(212,176,232,0.22)',
  ],
  neon: [
    'rgba(255,230,0,0.25)',
    'rgba(255,0,255,0.18)',
    'rgba(0,191,255,0.20)',
    'rgba(255,0,64,0.18)',
    'rgba(0,255,128,0.18)',
    'rgba(191,0,255,0.18)',
  ],
  dark: [
    'rgba(80,80,0,0.35)',
    'rgba(80,0,80,0.35)',
    'rgba(0,40,80,0.35)',
    'rgba(80,20,20,0.35)',
    'rgba(20,60,20,0.35)',
    'rgba(40,0,80,0.35)',
  ],
};

// ── Activate ──────────────────────────────────────────────────────────────────

export async function activate(context, api) {
  h = api || context._api || globalThis.hyscode;
  if (!h) { console.warn('[rainbow-indent] HysCode API unavailable'); return; }

  console.log('[rainbow-indent] activated');

  enabled       = (await h.settings.get('rainbowIndent.enabled',     true))      ?? true;
  currentScheme = (await h.settings.get('rainbowIndent.colorScheme', 'default')) ?? 'default';

  // ── Commands ──────────────────────────────────────────────────────────────

  h.commands.register('rainbowIndent.toggle', async () => {
    enabled = !enabled;
    await h.settings.set('rainbowIndent.enabled', enabled);
    h.notifications.showInfo(`Rainbow Indent: ${enabled ? 'ativado' : 'desativado'}`);
    if (!enabled && activeDecorations) {
      activeDecorations.dispose();
      activeDecorations = null;
    } else if (enabled) {
      await applyDecorations();
    }
  });

  h.commands.register('rainbowIndent.cycleScheme', async () => {
    const schemes = Object.keys(COLOR_SCHEMES);
    const idx = schemes.indexOf(currentScheme);
    currentScheme = schemes[(idx + 1) % schemes.length];
    await h.settings.set('rainbowIndent.colorScheme', currentScheme);
    h.notifications.showInfo(`Rainbow Indent: esquema → ${currentScheme}`);
    await applyDecorations();
  });

  h.commands.register('rainbowIndent.showStats', async () => {
    const filePath = h.editor.activeFilePath;
    if (!filePath) {
      h.window.showWarningMessage('Rainbow Indent: nenhum arquivo ativo.');
      return;
    }

    let source;
    try {
      source = await h.workspace.readFile(filePath);
    } catch {
      h.window.showErrorMessage('Rainbow Indent: erro ao ler arquivo.');
      return;
    }

    const stats = analyzeIndentation(source);
    const msg = [
      `Linhas: ${stats.totalLines}`,
      `Máx. nível: ${stats.maxLevel}`,
      `Indentação: ${stats.usesTabs ? 'tabs' : `espaços (${stats.spaceSize})`}`,
      stats.hasMixed ? '⚠ Mistura tabs/espaços' : '✓ Consistente',
    ].join('  ·  ');

    h.window.showInformationMessage(`Rainbow Indent — ${msg}`);
  });

  h.commands.register('rainbowIndent.fixIndentation', async () => {
    const filePath = h.editor.activeFilePath;
    if (!filePath) {
      h.window.showWarningMessage('Rainbow Indent: nenhum arquivo ativo.');
      return;
    }

    if (isIgnoredLanguage(filePath)) {
      h.window.showWarningMessage('Rainbow Indent: linguagem ignorada para esta operação.');
      return;
    }

    let source;
    try {
      source = await h.workspace.readFile(filePath);
    } catch {
      h.window.showErrorMessage('Rainbow Indent: erro ao ler arquivo.');
      return;
    }

    const tabSize = 2;
    const fixed = convertTabsToSpaces(source, tabSize);

    if (fixed === source) {
      h.window.showInformationMessage('Rainbow Indent: indentação já consistente.');
      return;
    }

    try {
      await h.workspace.writeFile(filePath, fixed);
      h.notifications.showInfo('Rainbow Indent: indentação corrigida.');
      await applyDecorations();
    } catch (err) {
      h.window.showErrorMessage(`Rainbow Indent: erro ao salvar — ${err.message}`);
    }
  });

  // ── File open listener: apply on file open ────────────────────────────────

  h.workspace.onDidOpenFile(async (filePath) => {
    if (!enabled) return;
    if (isIgnoredLanguage(filePath)) return;
    await applyDecorationsForFile(filePath);
  });

  // ── Settings tab ──────────────────────────────────────────────────────────

  h.settings.onTabVisible('rainbow-indent.settings', () => registerSettingsTab());
  registerSettingsTab();

  // ── Initial decoration ────────────────────────────────────────────────────

  if (enabled) await applyDecorations();

  console.log('[rainbow-indent] commands registered');
}

// ── Indentation analysis ──────────────────────────────────────────────────────

function analyzeIndentation(source) {
  const lines = source.split('\n');
  let maxLevel = 0;
  let tabCount = 0;
  let spaceCount = 0;
  let spaceSizes = {};
  let mixed = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^(\t+| +)/);
    if (!match) continue;

    const indent = match[1];
    if (indent.includes('\t') && indent.includes(' ')) {
      mixed++;
    } else if (indent.includes('\t')) {
      tabCount++;
      const level = indent.length;
      if (level > maxLevel) maxLevel = level;
    } else {
      spaceCount++;
      const size = indent.length;
      spaceSizes[size] = (spaceSizes[size] || 0) + 1;
    }
  }

  // Most common space size
  const spaceSize = Object.entries(spaceSizes)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 2;

  return {
    totalLines: lines.length,
    maxLevel,
    usesTabs: tabCount > spaceCount,
    spaceSize: Number(spaceSize),
    hasMixed: mixed > 0,
  };
}

/**
 * Build decoration array for indentation levels.
 * Each "block" of indentation at a given level gets a background color.
 */
function buildIndentDecorations(source, colors, errorColor, tabSize = 2) {
  const decorations = [];
  const lines = source.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (!line.trim()) continue; // Skip blank lines

    // Detect indent type and depth
    const spacesMatch = line.match(/^( +)/);
    const tabsMatch   = line.match(/^(\t+)/);

    const hasMixed = line.match(/^ *\t/) || line.match(/^\t* /);

    if (spacesMatch) {
      const spaces = spacesMatch[1].length;
      const level  = Math.floor(spaces / tabSize);

      for (let l = 0; l < level; l++) {
        const colStart = l * tabSize;
        const colEnd   = colStart + tabSize;
        const color    = hasMixed ? errorColor : colors[l % colors.length];
        decorations.push({
          range: {
            startLine: lineIdx, startColumn: colStart,
            endLine: lineIdx,   endColumn: colEnd,
          },
          options: {
            className: `rainbow-indent-l${l}`,
            hoverMessage: `Nível ${l + 1}`,
            isWholeLine: false,
          },
        });
      }
    } else if (tabsMatch) {
      const tabs = tabsMatch[1].length;
      for (let l = 0; l < tabs; l++) {
        decorations.push({
          range: {
            startLine: lineIdx, startColumn: l,
            endLine: lineIdx,   endColumn: l + 1,
          },
          options: {
            className: `rainbow-indent-l${l}`,
            hoverMessage: `Nível ${l + 1}`,
          },
        });
      }
    }
  }

  return decorations;
}

// ── Apply decorations ─────────────────────────────────────────────────────────

async function applyDecorations() {
  const filePath = h?.editor?.activeFilePath;
  if (filePath) await applyDecorationsForFile(filePath);
}

async function applyDecorationsForFile(filePath) {
  if (!enabled || !h) return;
  if (isIgnoredLanguage(filePath)) return;

  let source;
  try {
    source = await h.workspace.readFile(filePath);
  } catch {
    return;
  }

  const userColors = (await h.settings.get('rainbowIndent.colors', null));
  const colors = userColors || COLOR_SCHEMES[currentScheme] || COLOR_SCHEMES.default;
  const errorColor = (await h.settings.get('rainbowIndent.errorColor', 'rgba(255,0,0,0.3)')) ?? 'rgba(255,0,0,0.3)';
  const highlightErrors = (await h.settings.get('rainbowIndent.highlightErrors', true)) ?? true;

  const decorations = buildIndentDecorations(source, colors, highlightErrors ? errorColor : null);

  if (activeDecorations) {
    activeDecorations.dispose();
    activeDecorations = null;
  }

  // api.editor.addDecorations — will paint once decoration support is implemented
  activeDecorations = h.editor.addDecorations(filePath, decorations);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function convertTabsToSpaces(source, tabSize = 2) {
  const spaces = ' '.repeat(tabSize);
  return source.split('\n').map(line => {
    let i = 0;
    let result = '';
    while (i < line.length && line[i] === '\t') { result += spaces; i++; }
    result += line.slice(i);
    return result;
  }).join('\n');
}

async function isIgnoredLanguage(filePath) {
  if (!filePath) return true;
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap = { md: 'markdown', txt: 'plaintext', text: 'plaintext' };
  const lang = langMap[ext] || ext;
  const ignored = (await h.settings.get('rainbowIndent.ignoredLanguages', ['plaintext', 'markdown'])) ?? ['plaintext', 'markdown'];
  return ignored.includes(lang);
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function registerSettingsTab() {
  h.settings.updateTabContent('rainbow-indent.settings', {
    sections: [
      {
        id: 'general',
        title: 'Geral',
        items: [
          { id: 'enabled',          type: 'toggle', settingKey: 'rainbowIndent.enabled',          label: 'Ativar Rainbow Indent',        default: true },
          { id: 'highlightErrors',  type: 'toggle', settingKey: 'rainbowIndent.highlightErrors',  label: 'Destacar indentação incorreta', default: true },
        ],
      },
      {
        id: 'colors',
        title: 'Cores',
        items: [
          { id: 'scheme',     type: 'select', settingKey: 'rainbowIndent.colorScheme', label: 'Esquema', default: 'default',
            options: [
              { value: 'default', label: 'Padrão'       },
              { value: 'pastel',  label: 'Pastel'        },
              { value: 'neon',    label: 'Neon'          },
              { value: 'dark',    label: 'Escuro'        },
            ],
          },
          { id: 'errorColor', type: 'color',  settingKey: 'rainbowIndent.errorColor', label: 'Cor de erro', default: 'rgba(255,0,0,0.3)' },
        ],
      },
      {
        id: 'actions',
        title: 'Ações',
        items: [
          { id: 'cycleBtn', type: 'button', label: 'Ciclar esquema',      buttonLabel: 'Ciclar',  command: 'rainbowIndent.cycleScheme' },
          { id: 'statsBtn', type: 'button', label: 'Estatísticas',        buttonLabel: 'Stats',   command: 'rainbowIndent.showStats' },
          { id: 'fixBtn',   type: 'button', label: 'Corrigir indentação', buttonLabel: 'Fix',     command: 'rainbowIndent.fixIndentation' },
        ],
      },
    ],
  });
}

// ── Deactivate ────────────────────────────────────────────────────────────────

export function deactivate() {
  console.log('[rainbow-indent] deactivated');
  if (activeDecorations) {
    activeDecorations.dispose();
    activeDecorations = null;
  }
}

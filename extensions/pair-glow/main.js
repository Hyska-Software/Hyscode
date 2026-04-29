// pair-glow — main.js
// Colorize matching bracket pairs by nesting level

'use strict';

/** @type {import('../../packages/extension-api/src').HyscodeAPI | null} */
let h = null;

let enabled = true;
let activeDecorations = null;
let currentScheme = 'default';

// ── Color schemes ─────────────────────────────────────────────────────────────
const COLOR_SCHEMES = {
  default:    ['#ffd700', '#da70d6', '#179fff', '#ff6b6b', '#98c379', '#c678dd'],
  pastel:     ['#f9c784', '#e8a0d0', '#a0c4ff', '#ffb3b3', '#b5ead7', '#d4b0e8'],
  neon:       ['#ffe600', '#ff00ff', '#00bfff', '#ff0040', '#00ff80', '#bf00ff'],
  monochrome: ['#ffffff', '#cccccc', '#999999', '#777777', '#555555', '#333333'],
};

// ── Bracket pair definitions ───────────────────────────────────────────────────
const BRACKET_PAIRS = [
  { open: '(', close: ')' },
  { open: '[', close: ']' },
  { open: '{', close: '}' },
];

// ── Activate ──────────────────────────────────────────────────────────────────

export async function activate(context, api) {
  h = api || context._api || globalThis.hyscode;
  if (!h) { console.warn('[pair-glow] HysCode API unavailable'); return; }

  console.log('[pair-glow] activated');

  enabled       = (await h.settings.get('pairGlow.enabled',     true))      ?? true;
  currentScheme = (await h.settings.get('pairGlow.colorScheme', 'default')) ?? 'default';

  // ── Commands ──────────────────────────────────────────────────────────────

  h.commands.register('pairGlow.toggle', async () => {
    enabled = !enabled;
    await h.settings.set('pairGlow.enabled', enabled);
    h.notifications.showInfo(`Pair Glow: ${enabled ? 'ativado' : 'desativado'}`);
    if (!enabled && activeDecorations) {
      activeDecorations.dispose();
      activeDecorations = null;
    } else if (enabled) {
      await applyDecorations();
    }
  });

  h.commands.register('pairGlow.toggleGuides', async () => {
    const current = (await h.settings.get('pairGlow.showGuides', true)) ?? true;
    await h.settings.set('pairGlow.showGuides', !current);
    h.notifications.showInfo(`Pair Glow: guias de indentação ${!current ? 'ativadas' : 'desativadas'}`);
    await applyDecorations();
  });

  h.commands.register('pairGlow.cycleColors', async () => {
    const schemes = Object.keys(COLOR_SCHEMES);
    const idx = schemes.indexOf(currentScheme);
    currentScheme = schemes[(idx + 1) % schemes.length];
    await h.settings.set('pairGlow.colorScheme', currentScheme);
    h.notifications.showInfo(`Pair Glow: esquema de cores → ${currentScheme}`);
    await applyDecorations();
  });

  h.commands.register('pairGlow.resetColors', async () => {
    currentScheme = 'default';
    await h.settings.set('pairGlow.colorScheme', 'default');
    await h.settings.set('pairGlow.colors', COLOR_SCHEMES.default);
    h.notifications.showInfo('Pair Glow: cores redefinidas para o padrão.');
    await applyDecorations();
  });

  h.commands.register('pairGlow.goToMatch', async () => {
    // Navigate to matching bracket via editor — currently uses a fallback message
    // as the editor cursor API is not yet exposed
    h.window.showInformationMessage('Pair Glow: navegue até o par com Ctrl+Shift+\\');
  });

  // ── Settings tab ──────────────────────────────────────────────────────────

  h.settings.onTabVisible('pair-glow.settings', () => registerSettingsTab());
  registerSettingsTab();

  // ── Initial decoration pass ───────────────────────────────────────────────

  if (enabled) await applyDecorations();

  console.log('[pair-glow] commands registered');
}

// ── Core: analyze brackets in source text ────────────────────────────────────

/**
 * Returns an array of EditorDecoration objects for all bracket pairs found in
 * the given source text, colored by nesting level.
 */
function buildBracketDecorations(source, colors) {
  const decorations = [];
  const stack = [];

  const lines = source.split('\n');
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let stringChar = '';

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    inLineComment = false;

    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      const next = line[col + 1];

      // Block comment tracking
      if (!inString && !inLineComment && ch === '/' && next === '*') { inBlockComment = true; col++; continue; }
      if (inBlockComment && ch === '*' && next === '/') { inBlockComment = false; col++; continue; }
      if (inBlockComment) continue;

      // Line comment tracking
      if (!inString && ch === '/' && next === '/') { inLineComment = true; break; }
      if (inLineComment) continue;

      // String tracking (simple: ignores template literals nesting)
      if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
        inString = true;
        stringChar = ch;
        continue;
      }
      if (inString && ch === stringChar && line[col - 1] !== '\\') {
        inString = false;
        continue;
      }
      if (inString) continue;

      // Bracket matching
      const openPair = BRACKET_PAIRS.find(p => p.open === ch);
      const closePair = BRACKET_PAIRS.find(p => p.close === ch);

      if (openPair) {
        const level = stack.length % colors.length;
        const color = colors[level];
        stack.push({ open: ch, close: openPair.close, lineIdx, col, level, color });
        decorations.push({
          range: { startLine: lineIdx, startColumn: col, endLine: lineIdx, endColumn: col + 1 },
          options: { inlineClassName: `pair-glow-l${level}`, hoverMessage: `Nível ${level + 1} — ${color}` },
        });
      } else if (closePair) {
        // Pop matching open
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].close === ch) {
            const entry = stack.splice(s, 1)[0];
            decorations.push({
              range: { startLine: lineIdx, startColumn: col, endLine: lineIdx, endColumn: col + 1 },
              options: { inlineClassName: `pair-glow-l${entry.level}`, hoverMessage: `Nível ${entry.level + 1} — ${entry.color}` },
            });
            break;
          }
        }
      }
    }
  }

  return decorations;
}

// ── Apply decorations to active file ─────────────────────────────────────────

async function applyDecorations() {
  if (!enabled || !h) return;

  const filePath = h.editor.activeFilePath;
  if (!filePath) return;

  let source;
  try {
    source = await h.workspace.readFile(filePath);
  } catch {
    return; // File not readable
  }

  const userColors = (await h.settings.get('pairGlow.colors', null));
  const colors = userColors || COLOR_SCHEMES[currentScheme] || COLOR_SCHEMES.default;

  const decorations = buildBracketDecorations(source, colors);

  if (activeDecorations) {
    activeDecorations.dispose();
    activeDecorations = null;
  }

  // api.editor.addDecorations — fully functional when editor decoration support lands
  activeDecorations = h.editor.addDecorations(filePath, decorations);
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function registerSettingsTab() {
  h.settings.updateTabContent('pair-glow.settings', {
    sections: [
      {
        id: 'general',
        title: 'Geral',
        items: [
          { id: 'enabled',     type: 'toggle', settingKey: 'pairGlow.enabled',          label: 'Ativar Pair Glow',         default: true },
          { id: 'showGuides',  type: 'toggle', settingKey: 'pairGlow.showGuides',        label: 'Guias de Indentação',      default: true },
          { id: 'activeScope', type: 'toggle', settingKey: 'pairGlow.highlightActiveScope', label: 'Destacar escopo ativo', default: true },
        ],
      },
      {
        id: 'colors',
        title: 'Cores',
        items: [
          { id: 'scheme', type: 'select', settingKey: 'pairGlow.colorScheme', label: 'Esquema de Cores', default: 'default',
            options: [
              { value: 'default',    label: 'Padrão'       },
              { value: 'pastel',     label: 'Pastel'       },
              { value: 'neon',       label: 'Neon'         },
              { value: 'monochrome', label: 'Monocromático' },
            ],
          },
        ],
      },
      {
        id: 'actions',
        title: 'Ações',
        items: [
          { id: 'cycle',   type: 'button', label: 'Ciclar esquema', buttonLabel: 'Ciclar cores',    command: 'pairGlow.cycleColors' },
          { id: 'reset',   type: 'button', label: 'Redefinir',      buttonLabel: 'Redefinir cores', command: 'pairGlow.resetColors', variant: 'danger' },
          { id: 'toggle',  type: 'button', label: 'Toggle',         buttonLabel: 'Toggle Pair Glow', command: 'pairGlow.toggle' },
        ],
      },
    ],
  });
}

// ── Deactivate ────────────────────────────────────────────────────────────────

export function deactivate() {
  console.log('[pair-glow] deactivated');
  if (activeDecorations) {
    activeDecorations.dispose();
    activeDecorations = null;
  }
}

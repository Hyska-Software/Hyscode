// tag-sync — main.js
// Auto-sync HTML/JSX opening and closing tag names when one is renamed

'use strict';

/** @type {import('../../packages/extension-api/src').HyscodeAPI | null} */
let h = null;

let enabled = true;
let lastSyncResult = null;

// ── Void HTML elements (no closing tag) ──────────────────────────────────────
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ── Supported languages ───────────────────────────────────────────────────────
const DEFAULT_LANGUAGES = ['html', 'xml', 'jsx', 'tsx', 'vue', 'svelte', 'php', 'erb', 'handlebars'];

// ── Activate ──────────────────────────────────────────────────────────────────

export async function activate(context, api) {
  h = api || context._api || globalThis.hyscode;
  if (!h) { console.warn('[tag-sync] HysCode API unavailable'); return; }

  console.log('[tag-sync] activated');

  enabled = (await h.settings.get('tagSync.enabled', true)) ?? true;

  // ── Commands ──────────────────────────────────────────────────────────────

  h.commands.register('tagSync.toggle', async () => {
    enabled = !enabled;
    await h.settings.set('tagSync.enabled', enabled);
    h.notifications.showInfo(`Tag Sync: ${enabled ? 'ativado' : 'desativado'}`);
  });

  h.commands.register('tagSync.syncNow', async () => {
    const filePath = h.editor.activeFilePath;
    if (!filePath) {
      h.window.showWarningMessage('Tag Sync: nenhum arquivo ativo.');
      return;
    }

    if (!(await isSupportedFile(filePath))) {
      h.window.showWarningMessage(`Tag Sync: linguagem não suportada para "${filePath.split(/[/\\]/).pop()}".`);
      return;
    }

    const result = await syncTagsInFile(filePath);
    if (result.fixed > 0) {
      h.notifications.showInfo(`Tag Sync: ${result.fixed} par(es) de tags sincronizado(s).`);
    } else if (result.errors > 0) {
      h.window.showWarningMessage(`Tag Sync: ${result.errors} tag(s) desbalanceada(s) encontrada(s).`);
    } else {
      h.window.showInformationMessage('Tag Sync: nenhuma tag desbalanceada encontrada.');
    }
  });

  h.commands.register('tagSync.showStatus', async () => {
    const filePath = h.editor.activeFilePath;
    if (!filePath) {
      h.window.showWarningMessage('Tag Sync: nenhum arquivo ativo.');
      return;
    }
    const supported = await isSupportedFile(filePath);
    const fileName  = filePath.split(/[/\\]/).pop();
    h.window.showInformationMessage(
      `Tag Sync: ${enabled ? 'ativo' : 'inativo'} — "${fileName}" ${supported ? 'suportado ✓' : 'não suportado'}`
    );
  });

  // ── File save listener: auto-sync on save ─────────────────────────────────

  h.workspace.onDidSaveFile(async (filePath) => {
    if (!enabled) return;
    const syncOnType = (await h.settings.get('tagSync.syncOnType', true)) ?? true;
    if (!syncOnType) return; // syncOnType=false means sync only on save
    if (!(await isSupportedFile(filePath))) return;
    await syncTagsInFile(filePath);
  });

  // ── Settings tab ──────────────────────────────────────────────────────────

  h.settings.onTabVisible('tag-sync.settings', () => registerSettingsTab());
  registerSettingsTab();

  console.log('[tag-sync] commands registered');
}

// ── Tag sync logic ────────────────────────────────────────────────────────────

/**
 * Reads the file, finds mismatched open/close tag pairs and corrects them.
 * Returns { fixed: number, errors: number }.
 *
 * Strategy: find all <tag> ... </differentTag> patterns where the tag names
 * differ only due to a rename of one side, then sync the close to match open.
 * For safety, only syncs when the tag names are "similar" (share a common prefix).
 */
async function syncTagsInFile(filePath) {
  let source;
  try {
    source = await h.workspace.readFile(filePath);
  } catch (err) {
    console.warn('[tag-sync] Could not read file:', err);
    return { fixed: 0, errors: 0 };
  }

  const excludeVoid = (await h.settings.get('tagSync.excludeVoidElements', true)) ?? true;
  const { result, fixed, errors } = fixMismatchedTags(source, { excludeVoid });

  if (fixed > 0) {
    try {
      await h.workspace.writeFile(filePath, result);
    } catch (err) {
      console.warn('[tag-sync] Could not write file:', err);
      return { fixed: 0, errors: 0 };
    }
  }

  lastSyncResult = { filePath, fixed, errors, timestamp: new Date() };
  return { fixed, errors };
}

/**
 * Core tag-sync algorithm.
 * Finds opening tags and their matching closing tags using a stack.
 * When a mismatch is detected (e.g., <div> ... </span>), corrects the close tag.
 */
function fixMismatchedTags(source, { excludeVoid = true } = {}) {
  // Regex to match HTML-like tags
  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9.-]*)(\s[^>]*)?(\/?)>/g;

  let match;
  const stack = [];  // { tagName, startIdx, endIdx }
  const replacements = [];  // { from: string, to: string, idx: number }
  let fixed = 0;
  let errors = 0;

  while ((match = TAG_RE.exec(source)) !== null) {
    const [fullMatch, slash, tagName, attrs = '', selfClose] = match;
    const lowerName = tagName.toLowerCase();
    const isSelfClose = selfClose === '/' || (excludeVoid && VOID_ELEMENTS.has(lowerName));
    const isClose = slash === '/';

    if (isSelfClose || (!isClose && VOID_ELEMENTS.has(lowerName) && excludeVoid)) {
      continue; // Skip self-closing and void elements
    }

    if (!isClose) {
      // Opening tag — push to stack
      stack.push({ tagName, idx: match.index, len: fullMatch.length });
    } else {
      // Closing tag — match against top of stack
      if (stack.length === 0) {
        errors++;
        continue;
      }
      const top = stack[stack.length - 1];
      if (top.tagName !== tagName) {
        // Check if it's a rename case (names are "related")
        if (isLikelySameTag(top.tagName, tagName)) {
          // Fix: sync close tag to match open tag
          replacements.push({
            idx: match.index,
            oldStr: fullMatch,
            newStr: `</${top.tagName}>`,
          });
          fixed++;
        } else {
          errors++;
          continue; // Different semantic tag — don't auto-fix
        }
      }
      stack.pop();
    }
  }

  // Apply replacements in reverse order to preserve indices
  let result = source;
  for (const rep of replacements.sort((a, b) => b.idx - a.idx)) {
    result = result.substring(0, rep.idx) + rep.newStr + result.substring(rep.idx + rep.oldStr.length);
  }

  return { result, fixed, errors };
}

/**
 * Heuristic: two tag names are "likely the same" if one is a prefix/suffix of
 * the other, or they differ only in the last few characters (as happens when
 * a dev is mid-rename). Prevents fixing semantically different mismatches.
 */
function isLikelySameTag(name1, name2) {
  if (name1 === name2) return true;
  const a = name1.toLowerCase();
  const b = name2.toLowerCase();
  // One starts with the other (partial rename)
  if (a.startsWith(b) || b.startsWith(a)) return true;
  // Levenshtein distance ≤ 3 (minor rename)
  return levenshtein(a, b) <= 3;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

async function isSupportedFile(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langs = (await h.settings.get('tagSync.languages', DEFAULT_LANGUAGES)) ?? DEFAULT_LANGUAGES;
  const EXT_MAP = {
    html: 'html', htm: 'html', xml: 'xml', xhtml: 'html',
    jsx: 'jsx', tsx: 'tsx', vue: 'vue', svelte: 'svelte',
    php: 'php', erb: 'erb', hbs: 'handlebars',
  };
  const lang = EXT_MAP[ext];
  return lang ? langs.includes(lang) : false;
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function registerSettingsTab() {
  h.settings.updateTabContent('tag-sync.settings', {
    sections: [
      {
        id: 'general',
        title: 'Geral',
        items: [
          { id: 'enabled',      type: 'toggle', settingKey: 'tagSync.enabled',             label: 'Ativar Tag Sync',               default: true },
          { id: 'syncOnType',   type: 'toggle', settingKey: 'tagSync.syncOnType',           label: 'Sincronizar ao Digitar/Salvar', default: true },
          { id: 'excludeVoid',  type: 'toggle', settingKey: 'tagSync.excludeVoidElements',  label: 'Ignorar Elementos Void HTML',  default: true },
        ],
      },
      {
        id: 'actions',
        title: 'Ações',
        items: [
          { id: 'toggleBtn', type: 'button', label: 'Toggle Tag Sync', buttonLabel: 'Toggle',    command: 'tagSync.toggle' },
          { id: 'syncBtn',   type: 'button', label: 'Sincronizar agora', buttonLabel: 'Sync Now', command: 'tagSync.syncNow' },
        ],
      },
    ],
  });
}

// ── Deactivate ────────────────────────────────────────────────────────────────

export function deactivate() {
  console.log('[tag-sync] deactivated');
  lastSyncResult = null;
}

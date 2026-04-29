/**
 * todo-tree — Extensão Todo Tree para HysCode
 * Escaneia workspace buscando TODO/FIXME/BUG/HACK e exibe em árvore navegável
 */

'use strict';

/** @type {import('../extension-api/src').HyscodeAPI | null} */
let api = null;

/** @type {Array<() => void>} */
let disposables = [];

/** @type {Array<TodoItem>} */
let allResults = [];

/** @type {number} */
let currentIndex = -1;

/** @type {string|null} */
let activeFilter = null;

/** @type {boolean} */
let highlightsEnabled = true;

/** @type {string} */
let searchQuery = '';

/** Settings cache — populated async on activate so getSetting() stays sync */
let settingsCache = {};

/**
 * @typedef {{ tag: string, text: string, file: string, line: number, col: number }} TodoItem
 */

// ── Tag colours ──────────────────────────────────────────────────────────────

const TAG_COLORS = {
  TODO:       '#3b82f6',
  FIXME:      '#f59e0b',
  BUG:        '#ef4444',
  HACK:       '#a855f7',
  XXX:        '#ec4899',
  NOTE:       '#22c55e',
  WARN:       '#f97316',
  PERF:       '#06b6d4',
  REVIEW:     '#84cc16',
  DEPRECATED: '#94a3b8',
  OPTIMIZE:   '#14b8a6',
  CHANGED:    '#f472b6',
  IDEA:       '#fbbf24',
  QUESTION:   '#60a5fa',
  SAFETY:     '#fb7185',
};

const TAG_ICONS = {
  TODO:       '$(check)',
  FIXME:      '$(warning)',
  BUG:        '$(bug)',
  HACK:       '$(lightbulb)',
  XXX:        '$(warning)',
  NOTE:       '$(bookmark)',
  WARN:       '$(warning)',
  PERF:       '$(lightbulb)',
  REVIEW:     '$(eye)',
  DEPRECATED: '$(trash)',
  OPTIMIZE:   '$(zap)',
  CHANGED:    '$(edit)',
  IDEA:       '$(lightbulb)',
  QUESTION:   '$(question)',
  SAFETY:     '$(shield)',
};

function register(id, handler) {
  const d = api.commands.register(id, handler);
  disposables.push(d);
}

// ── Settings cache ────────────────────────────────────────────────────────────

async function loadSettings() {
  const keys = [
    'todoTree.tags', 'todoTree.scanMode', 'todoTree.includeGlobs',
    'todoTree.excludeGlobs', 'todoTree.highlightEnabled', 'todoTree.groupBy',
    'todoTree.sortOrder', 'todoTree.statusBar', 'todoTree.maxResults',
  ];
  for (const key of keys) {
    try {
      const val = await api.settings.get(key);
      if (val !== undefined && val !== null) settingsCache[key] = val;
    } catch { /* ignore */ }
  }
}

function getSetting(key, defaultValue) {
  const v = settingsCache[key];
  return (v !== undefined && v !== null) ? v : defaultValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// Activate
// ─────────────────────────────────────────────────────────────────────────────

export async function activate(context, _api) {
  console.log('[TodoTree] activate() called');
  api = _api || context._api || globalThis.hyscode;
  console.log('[TodoTree] api=', !!api);

  // Load settings async first so getSetting() works correctly
  await loadSettings();

  highlightsEnabled = getSetting('todoTree.highlightEnabled', true);

  // ── Refresh / scan ────────────────────────────────────────────────────────

  register('todoTree.refresh', async () => {
    showScanningView();
    try {
      allResults = await scanWorkspace();
      currentIndex = -1;
      updateStatusBar();
      renderView();
      api.notifications.showInfo(`Found ${allResults.length} TODO items`);
    } catch (e) {
      console.error('[TodoTree] scan error:', e);
    }
  });

  // ── Add tag ───────────────────────────────────────────────────────────────

  register('todoTree.addTag', async () => {
    const tag = await api.window.showInputBox({
      prompt: 'Nome da nova tag (ex: REVIEW, DEPRECATED)',
      placeholder: 'REVIEW',
    });
    if (!tag) return;

    const tags = getSetting('todoTree.tags', defaultTags());
    const upper = tag.toUpperCase();
    if (!tags.includes(upper)) {
      tags.push(upper);
      settingsCache['todoTree.tags'] = tags;
      try { await api.settings.set?.('todoTree.tags', tags); } catch { /* noop */ }
      api.notifications.showInfo(`Tag "${upper}" adicionada`);
    }
  });

  // ── Remove tag ────────────────────────────────────────────────────────────

  register('todoTree.removeTag', async () => {
    const tags = getSetting('todoTree.tags', defaultTags());
    const choice = await api.window.showQuickPick(
      tags.map(t => ({ label: t })),
      { placeholder: 'Selecionar tag para remover' },
    );
    if (!choice) return;

    const updated = tags.filter(t => t !== choice.label);
    settingsCache['todoTree.tags'] = updated;
    try { await api.settings.set?.('todoTree.tags', updated); } catch { /* noop */ }
    api.notifications.showInfo(`Tag "${choice.label}" removida`);
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  register('todoTree.goToNext', () => {
    const items = filteredResults();
    if (items.length === 0) {
      api.notifications.showWarning('Nenhum TODO encontrado. Execute Refresh primeiro.');
      return;
    }
    currentIndex = (currentIndex + 1) % items.length;
    goToItem(items[currentIndex]);
  });

  register('todoTree.goToPrevious', () => {
    const items = filteredResults();
    if (items.length === 0) {
      api.notifications.showWarning('Nenhum TODO encontrado. Execute Refresh primeiro.');
      return;
    }
    currentIndex = (currentIndex - 1 + items.length) % items.length;
    goToItem(items[currentIndex]);
  });

  // ── Navigate to specific item ─────────────────────────────────────────────

  register('todoTree.goToItem', (file, line) => {
    if (!file) return;
    api.editor?.openFile?.(file);
    if (line) api.editor?.goToLine?.(line);
  });

  // ── Export ────────────────────────────────────────────────────────────────

  register('todoTree.exportTree', async () => {
    if (allResults.length === 0) {
      api.notifications.showWarning('Nenhum TODO encontrado. Execute Refresh primeiro.');
      return;
    }

    const groupBy = getSetting('todoTree.groupBy', 'tag');
    const md = exportAsMarkdown(allResults, groupBy);
    const filename = 'TODO_REPORT.md';

    await api.workspace.writeFile(filename, md);
    await api.editor?.openFile?.(filename);
    api.notifications.showInfo(`Relatório exportado: ${filename}`);
  });

  // ── Scope ─────────────────────────────────────────────────────────────────

  register('todoTree.switchScope', async () => {
    const choice = await api.window.showQuickPick([
      { label: 'Workspace',    description: 'workspace' },
      { label: 'Open Files',   description: 'openFiles' },
      { label: 'Current File', description: 'currentFile' },
    ], { placeholder: 'Escopo de varredura' });
    if (!choice) return;

    settingsCache['todoTree.scanMode'] = choice.description;
    try { await api.settings.set?.('todoTree.scanMode', choice.description); } catch { /* noop */ }
    api.notifications.showInfo(`Escopo: ${choice.label}`);
  });

  // ── Filters ───────────────────────────────────────────────────────────────

  register('todoTree.filterByTag', async () => {
    const tags = getSetting('todoTree.tags', defaultTags());
    const choice = await api.window.showQuickPick(
      [{ label: 'All' }, ...tags.map(t => ({ label: t }))],
      { placeholder: 'Filtrar por tag' },
    );
    if (!choice) return;

    activeFilter = choice.label === 'All' ? null : choice.label;
    renderView();
    api.notifications.showInfo(activeFilter ? `Filtro: ${activeFilter}` : 'Filtro removido');
  });

  register('todoTree.clearFilter', () => {
    activeFilter = null;
    renderView();
    api.notifications.showInfo('Filtro limpo');
  });

  // ── Toggle highlights ─────────────────────────────────────────────────────

  register('todoTree.toggleHighlights', () => {
    highlightsEnabled = !highlightsEnabled;
    api.notifications.showInfo(highlightsEnabled ? 'Highlights ativados' : 'Highlights desativados');
  });

  // ── Show counts ───────────────────────────────────────────────────────────

  register('todoTree.showCounts', () => {
    if (allResults.length === 0) {
      api.notifications.showInfo('Nenhum TODO encontrado. Execute Refresh.');
      return;
    }

    const counts = {};
    for (const item of allResults) {
      counts[item.tag] = (counts[item.tag] || 0) + 1;
    }

    const lines = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => `${tag}: ${count}`)
      .join('  |  ');

    api.notifications.showInfo(`Total: ${allResults.length} — ${lines}`);
  });

  // ── Status bar ────────────────────────────────────────────────────────────

  try {
    const statusBar = api.window.createStatusBarItem({
      id: 'todoTree.statusBar',
      text: '$(checklist) TODOs: —',
      tooltip: 'Todo Tree — Ctrl+Shift+T para refresh',
      command: 'todoTree.refresh',
      alignment: 'right',
      priority: 30,
    });
    disposables.push(statusBar);
  } catch { /* ignore */ }

  // ── Search listener ───────────────────────────────────────────────────────

  try {
    const d = api.views.onDidChangeSearch('todoTree.panel', (query) => {
      searchQuery = query;
      renderView();
    });
    disposables.push(d);
  } catch { /* views API may not be available yet */ }

  // ── Settings tab ──────────────────────────────────────────────────────────

  if (api.settings?.updateTabContent) {
    api.settings.updateTabContent('todo-tree.settings', {
      sections: [
        {
          title: 'Scanning',
          items: [
            {
              type: 'select', key: 'scanMode', label: 'Scan Mode',
              description: 'Scope of TODO scanning', defaultValue: 'workspace',
              options: [
                { value: 'workspace',    label: 'Workspace' },
                { value: 'openFiles',    label: 'Open Files' },
                { value: 'currentFile',  label: 'Current File' },
              ],
            },
          ],
        },
        {
          title: 'Editor Highlights',
          items: [
            { type: 'toggle', key: 'highlightEnabled', label: 'Enable Highlights',
              description: 'Highlight TODO tags directly in the editor', defaultValue: true },
          ],
        },
      ],
    });
  }

  // ── Initial view + auto-scan ──────────────────────────────────────────────

  showWelcomeView();

  setTimeout(() => {
    api.commands?.execute?.('todoTree.refresh');
  }, 2000);
}

export function deactivate() {
  disposables.forEach(d => {
    if (typeof d === 'function') d();
    else if (d && typeof d.dispose === 'function') d.dispose();
  });
  disposables = [];
  allResults = [];
  currentIndex = -1;
  activeFilter = null;
  searchQuery = '';
  settingsCache = {};
  api = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// View Rendering
// ─────────────────────────────────────────────────────────────────────────────

function showWelcomeView() {
  try {
    api.views.updateView('todoTree.panel', {
      type: 'welcome',
      welcome: {
        icon: '$(check)',
        title: 'Todo Tree',
        description: 'Scan your workspace to find TODO, FIXME, BUG, HACK and other tags in your codebase.',
        actions: [
          { id: 'scan', label: 'Scan Workspace', icon: '$(refresh)', command: 'todoTree.refresh' },
        ],
      },
    });
  } catch (e) {
    console.error('[TodoTree] updateView FAILED:', e);
  }
}

function showScanningView() {
  try {
    api.views.updateView('todoTree.panel', {
      type: 'sections',
      sections: [
        {
          id: 'scanning',
          title: 'Scanning',
          collapsible: false,
          type: 'progress',
          progress: { label: 'Scanning workspace for TODO tags...' },
        },
      ],
    });
  } catch { /* views API not ready */ }
}

function renderView() {
  try {
    const items = getVisibleItems();
    const groupBy = getSetting('todoTree.groupBy', 'tag');

    const tagCounts = {};
    for (const item of allResults) {
      tagCounts[item.tag] = (tagCounts[item.tag] || 0) + 1;
    }

    const stats = [
      { label: 'Total', value: allResults.length, icon: '$(check)', color: '#8b5cf6' },
    ];
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [tag, count] of topTags) {
      stats.push({
        label: tag,
        value: count,
        icon: TAG_ICONS[tag] || '$(check)',
        color: TAG_COLORS[tag] || '#8b5cf6',
      });
    }

    const treeSections = [];

    if (items.length === 0 && allResults.length > 0) {
      treeSections.push({
        id: 'no-results',
        title: 'No Matches',
        collapsible: false,
        type: 'actions',
        actions: [
          { id: 'clear-filter', label: 'Clear Filter', icon: '$(filter)', command: 'todoTree.clearFilter' },
        ],
      });
    } else if (groupBy === 'tag') {
      const groups = {};
      for (const item of items) {
        if (!groups[item.tag]) groups[item.tag] = [];
        groups[item.tag].push(item);
      }

      for (const [tag, tagItems] of Object.entries(groups).sort()) {
        treeSections.push({
          id: `tag-${tag}`,
          title: tag,
          collapsible: true,
          collapsed: false,
          badge: String(tagItems.length),
          badgeColor: TAG_COLORS[tag] || '#8b5cf6',
          type: 'tree',
          items: tagItems.map(todoToViewItem),
        });
      }
    } else if (groupBy === 'file') {
      const groups = {};
      for (const item of items) {
        if (!groups[item.file]) groups[item.file] = [];
        groups[item.file].push(item);
      }

      for (const [file, fileItems] of Object.entries(groups).sort()) {
        const shortName = file.split(/[/\\]/).pop() || file;
        treeSections.push({
          id: `file-${file}`,
          title: shortName,
          collapsible: true,
          collapsed: false,
          badge: String(fileItems.length),
          type: 'tree',
          items: fileItems.map(todoToViewItem),
        });
      }
    } else {
      treeSections.push({
        id: 'flat',
        title: 'All Items',
        collapsible: true,
        collapsed: false,
        badge: String(items.length),
        type: 'tree',
        items: items.map(todoToViewItem),
      });
    }

    api.views.updateView('todoTree.panel', {
      type: 'sections',
      toolbar: [
        { id: 'refresh', label: 'Refresh', icon: '$(refresh)', tooltip: 'Scan workspace', command: 'todoTree.refresh' },
        { id: 'filter',  label: 'Filter',  icon: '$(filter)',  tooltip: 'Filter by tag',  command: 'todoTree.filterByTag' },
        { id: 'export',  label: 'Export',  icon: '$(export)',  tooltip: 'Export as Markdown', command: 'todoTree.exportTree' },
      ],
      searchable: true,
      searchPlaceholder: 'Search TODOs...',
      badge: allResults.length > 0 ? { count: allResults.length, tooltip: `${allResults.length} TODO items found` } : undefined,
      sections: [
        { id: 'stats', title: 'Overview', collapsible: true, collapsed: false, type: 'stats', stats },
        ...treeSections,
      ],
      footer: activeFilter
        ? { text: `Filtrado: ${activeFilter} — clique para limpar`, command: 'todoTree.clearFilter' }
        : { text: `${allResults.length} itens em ${Object.keys(tagCounts).length} tags` },
    });
  } catch (e) {
    console.warn('[TodoTree] Failed to render view:', e);
  }
}

function todoToViewItem(item) {
  const shortFile = item.file.split(/[/\\]/).pop() || item.file;
  return {
    id: `${item.file}:${item.line}:${item.col}:${item.tag}`,
    label: item.text.slice(0, 80) || `${item.tag} at line ${item.line}`,
    description: `${shortFile}:${item.line}`,
    icon: TAG_ICONS[item.tag] || '$(check)',
    iconColor: TAG_COLORS[item.tag] || '#8b5cf6',
    tooltip: `[${item.tag}] ${item.file}:${item.line}\n${item.text}`,
    command: 'todoTree.goToItem',
    commandArgs: [item.file, item.line],
    badge: item.tag,
    badgeColor: TAG_COLORS[item.tag] || '#8b5cf6',
    contextMenu: [
      { id: 'goto', label: 'Go to Location', icon: '$(file-text)', command: 'todoTree.goToItem', commandArgs: [item.file, item.line] },
    ],
  };
}

function getVisibleItems() {
  let items = filteredResults();

  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    items = items.filter(item =>
      item.text.toLowerCase().includes(q) ||
      item.file.toLowerCase().includes(q) ||
      item.tag.toLowerCase().includes(q)
    );
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core scanning
// ─────────────────────────────────────────────────────────────────────────────

async function scanWorkspace() {
  const tags        = getSetting('todoTree.tags',         defaultTags());
  const excludeGlobs = getSetting('todoTree.excludeGlobs', defaultExcludes());
  const maxResults  = getSetting('todoTree.maxResults',   5000);

  if (tags.length === 0) return [];

  const results = [];

  try {
    const files = await listAllFiles(excludeGlobs);

    for (const file of files) {
      if (results.length >= maxResults) break;

      try {
        const content = await api.workspace.readFile(file);
        if (!content) continue;

        const found = scanLines(content, file, tags);
        for (const item of found) {
          if (results.length >= maxResults) break;
          results.push(item);
        }
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // fallback: no workspace listing available
  }

  return results;
}

/**
 * Scan all lines of a file and return matched TODO items.
 *
 * Supported formats:
 *   // TODO: text
 *   // TODO text
 *   // TODO(user): text
 *   // TODO(#123): text
 *   # TODO: text            (Python / shell)
 *   -- TODO: text           (SQL / Lua)
 *   <!-- TODO: text -->     (HTML)
 *   @todo text              (JSDoc)
 *   @TODO: text
 *
 * @param {string}   source   Full file content
 * @param {string}   filePath File path (for the result objects)
 * @param {string[]} tags     List of tag names to search (e.g. ['TODO', 'FIXME'])
 * @returns {TodoItem[]}
 */
function scanLines(source, filePath, tags) {
  const results = [];
  const lines = source.split('\n');

  // Build tag alternation — case-insensitive via flag, word-boundary enforced
  const tagAlt = tags.map(escapeRegex).join('|');

  /**
   * Pattern breakdown:
   *  (?:^|[^a-zA-Z@])        — word boundary: start of line OR preceded by non-letter/non-@
   *  (@?)                    — optional @ prefix for JSDoc style (@todo)
   *  (TAG_ALT)               — the tag itself (captured, group 2)
   *  (?:\([^)]{0,60}\))?     — optional (username) or (#123) annotation, max 60 chars
   *  [ \t]*[:：]?[ \t]*      — optional colon (ASCII or fullwidth) + surrounding spaces
   *  (.+)                    — the comment text (captured, group 3) — must have content
   */
  const re = new RegExp(
    `(?:^|[^a-zA-Z@])(@?)(${tagAlt})(?:\\([^)]{0,60}\\))?[ \\t]*[:：]?[ \\t]*(.+)`,
    'gi'
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Reset lastIndex for each line (since we reuse the same `re` object with `g` flag)
    re.lastIndex = 0;

    let m;
    while ((m = re.exec(line)) !== null) {
      const rawTag = m[2].toUpperCase();          // group 2 = tag name
      const text   = m[3].trim()                  // group 3 = message text
        .replace(/\*+\/\s*$/, '')                 // strip trailing */ from block comments
        .replace(/-->$/, '')                       // strip trailing --> from HTML comments
        .trim();

      if (!text) continue;

      // Col: position of the tag in the line
      // m.index points to the char before the tag (the [^a-zA-Z@] match) when not at start
      const atPrefix = m[1] ? 1 : 0;             // group 1 = '@' or ''
      const prefixLen = m[0].length - m[2].length - text.length - atPrefix;
      const col = Math.max(0, m.index + (m[0][0].match(/[a-zA-Z@]/) ? 0 : 1));

      results.push({ tag: rawTag, text, file: filePath, line: i + 1, col });

      // Advance past this match to find further TODOs on the same line
      re.lastIndex = m.index + m[0].length;
    }
  }

  return results;
}

async function listAllFiles(excludeGlobs) {
  const files = [];

  async function walk(dir) {
    try {
      const entries = await api.workspace.listDir(dir);
      if (!entries) return;

      for (const entry of entries) {
        const name = entry.name || (typeof entry === 'string' ? entry : '');
        const path = dir ? `${dir}/${name}` : name;

        if (!name || shouldExclude(path)) continue;

        if (entry.isDirectory || name.endsWith('/')) {
          await walk(path.replace(/\/$/, ''));
        } else {
          if (isTextFile(name)) {
            files.push(path);
          }
        }
      }
    } catch {
      // skip inaccessible directories
    }
  }

  await walk('');
  return files;
}

function isTextFile(name) {
  const exts = [
    '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs',
    '.py', '.rs', '.go', '.java', '.kt', '.kts', '.scala',
    '.c', '.cpp', '.h', '.hpp', '.cs',
    '.rb', '.php', '.swift', '.dart',
    '.html', '.htm', '.css', '.scss', '.less', '.sass',
    '.yaml', '.yml', '.json', '.jsonc', '.toml', '.ini', '.cfg', '.env',
    '.md', '.mdx', '.txt', '.rst',
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
    '.sql', '.graphql', '.gql',
    '.vue', '.svelte', '.astro',
    '.xml', '.svg',
    '.gitignore', '.dockerignore', '.editorconfig',
    '.prisma', '.proto',
    '.lua', '.r', '.ex', '.exs', '.erl', '.hrl',
    '.clj', '.cljs', '.elm', '.ml', '.fs', '.fsx',
    '.zig', '.nim', '.v',
  ];
  const lower = name.toLowerCase();
  return exts.some(ext => lower.endsWith(ext));
}

function shouldExclude(path) {
  const norm = path.replace(/\\/g, '/');
  const excludeSegments = [
    'node_modules', 'dist', 'build', '.git', 'target',
    '__pycache__', 'vendor', '.next', '.nuxt', 'coverage',
    '.turbo', '.cache', '.yarn', 'out', '.svelte-kit',
    '.vite', 'storybook-static', '.parcel-cache',
  ];
  return excludeSegments.some(seg =>
    norm.includes(`/${seg}/`) ||
    norm.startsWith(`${seg}/`) ||
    norm === seg
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function defaultTags() {
  return [
    'TODO', 'FIXME', 'BUG', 'HACK', 'XXX',
    'NOTE', 'WARN', 'PERF',
    'REVIEW', 'DEPRECATED', 'OPTIMIZE', 'CHANGED', 'IDEA', 'QUESTION', 'SAFETY',
  ];
}

function defaultExcludes() {
  return [
    '**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**',
    '**/target/**', '**/__pycache__/**', '**/vendor/**', '**/coverage/**',
  ];
}

function filteredResults() {
  if (!activeFilter) return allResults;
  return allResults.filter(r => r.tag === activeFilter);
}

function goToItem(item) {
  if (!item) return;
  api.editor?.openFile?.(item.file);
  api.editor?.goToLine?.(item.line);
  api.notifications.showInfo(`[${item.tag}] ${item.file}:${item.line} — ${item.text.slice(0, 60)}`);
}

function updateStatusBar() {
  try {
    const mode = getSetting('todoTree.statusBar', 'total');
    let text = `$(checklist) TODOs: ${allResults.length}`;

    if (mode === 'perTag' || mode === 'topThree') {
      const counts = {};
      for (const item of allResults) {
        counts[item.tag] = (counts[item.tag] || 0) + 1;
      }
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, mode === 'topThree' ? 3 : 99);
      text = `$(checklist) ${top.map(([t, c]) => `${t}:${c}`).join(' ')}`;
    }

    api.window.createStatusBarItem?.({
      id: 'todoTree.statusBar',
      text,
      tooltip: `Todo Tree — ${allResults.length} items`,
      command: 'todoTree.refresh',
      alignment: 'right',
      priority: 30,
    });
  } catch { /* ignore */ }
}

function exportAsMarkdown(items, groupBy) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let md = `# TODO Report\n\nGenerated: ${now}\nTotal: ${items.length}\n\n`;

  if (groupBy === 'tag') {
    const groups = {};
    for (const item of items) {
      if (!groups[item.tag]) groups[item.tag] = [];
      groups[item.tag].push(item);
    }

    for (const [tag, tagItems] of Object.entries(groups).sort()) {
      md += `## ${tag} (${tagItems.length})\n\n`;
      for (const i of tagItems) {
        md += `- **${i.file}:${i.line}** — ${i.text}\n`;
      }
      md += '\n';
    }
  } else {
    const groups = {};
    for (const item of items) {
      if (!groups[item.file]) groups[item.file] = [];
      groups[item.file].push(item);
    }

    for (const [file, fileItems] of Object.entries(groups).sort()) {
      md += `## ${file}\n\n`;
      for (const i of fileItems) {
        md += `- **L${i.line}** [${i.tag}] ${i.text}\n`;
      }
      md += '\n';
    }
  }

  return md;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

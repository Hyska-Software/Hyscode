/**
 * project-manager — Extensão Project Manager para HysCode
 * Salvar, organizar, alternar projetos com tags e auto-detecção de repos
 */

'use strict';

/** @type {import('../extension-api/src').HyscodeAPI | null} */
let api = null;

/** @type {Array<() => void>} */
let disposables = [];

/** @type {ProjectEntry[]} */
let projects = [];

/** @type {string|null} */
let activeTagFilter = null;

/** @type {string} */
let searchQuery = '';

/**
 * @typedef {{ name: string, path: string, tags: string[], lastOpened?: string, favorite?: boolean }} ProjectEntry
 */

const PROJECTS_FILE = 'projects.json';

function register(id, handler) {
  const d = api.commands.register(id, handler);
  disposables.push(d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Activate
// ─────────────────────────────────────────────────────────────────────────────

export function activate(context) {
  console.log('[ProjectManager] activate() called, context._api=', !!context._api, 'globalThis.hyscode=', !!globalThis.hyscode);
  api = context._api || globalThis.hyscode;
  console.log('[ProjectManager] api=', !!api, 'api.views=', !!(api && api.views), 'api.views.updateView=', !!(api && api.views && api.views.updateView));

  // Load stored projects
  loadProjects().then(() => {
    console.log('[ProjectManager] loadProjects() resolved, calling renderView()');
    renderView();
  }).catch(e => console.error('[ProjectManager] loadProjects() failed:', e));

  // ── Save project ──────────────────────────────────────────────────────────

  register('projectManager.saveProject', async () => {
    const currentPath = getCurrentProjectPath();
    const defaultName = currentPath
      ? currentPath.split(/[/\\]/).filter(Boolean).pop()
      : '';

    const name = await api.window.showInputBox({
      prompt: 'Nome do projeto',
      placeholder: defaultName || 'My Project',
      value: defaultName,
    });
    if (!name) return;

    let path = currentPath;
    if (!path) {
      path = await api.window.showInputBox({
        prompt: 'Caminho do projeto',
        placeholder: '/home/user/projects/my-project',
      });
      if (!path) return;
    }

    // Ask for tags
    const tagsInput = await api.window.showInputBox({
      prompt: 'Tags (separadas por vírgula, ou vazio)',
      placeholder: 'web, react, personal',
    });
    const tags = tagsInput
      ? tagsInput.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    // Check if project already exists
    const existing = projects.findIndex(p => p.path === path);
    if (existing >= 0) {
      projects[existing].name = name;
      projects[existing].tags = tags;
      projects[existing].lastOpened = new Date().toISOString();
    } else {
      projects.push({ name, path, tags, lastOpened: new Date().toISOString() });
    }

    await saveProjects();
    renderView();
    updateStatusBar(name);
    api.notifications?.info?.(`Projeto "${name}" salvo!`);
  });

  // ── Edit projects ─────────────────────────────────────────────────────────

  register('projectManager.editProjects', async () => {
    const filePath = getProjectsFilePath();
    await api.editor?.openFile?.(filePath);
  });

  // ── List / open project ───────────────────────────────────────────────────

  register('projectManager.listProjects', async () => {
    const items = getProjectPickItems();
    if (items.length === 0) {
      api.notifications?.info?.('Nenhum projeto salvo. Use "Save Project" primeiro.');
      return;
    }

    const choice = await api.window.showQuickPick(items, {
      placeholder: 'Selecionar projeto para abrir',
    });
    if (!choice) return;

    const project = projects.find(p => p.path === choice.description);
    if (project) {
      project.lastOpened = new Date().toISOString();
      await saveProjects();
      openProject(project.path, false);
    }
  });

  // ── Open in new window ────────────────────────────────────────────────────

  register('projectManager.listProjectsNewWindow', async () => {
    const items = getProjectPickItems();
    if (items.length === 0) {
      api.notifications?.info?.('Nenhum projeto salvo.');
      return;
    }

    const choice = await api.window.showQuickPick(items, {
      placeholder: 'Abrir projeto em nova janela',
    });
    if (!choice) return;

    const project = projects.find(p => p.path === choice.description);
    if (project) {
      project.lastOpened = new Date().toISOString();
      await saveProjects();
      openProject(project.path, true);
    }
  });

  // ── Open project by path (from view click) ───────────────────────────────

  register('projectManager.openByPath', (path) => {
    if (!path) return;
    const project = projects.find(p => p.path === path);
    if (project) {
      project.lastOpened = new Date().toISOString();
      saveProjects().then(() => renderView());
    }
    openProject(path, false);
  });

  // ── Toggle favorite ───────────────────────────────────────────────────────

  register('projectManager.toggleFavorite', async (path) => {
    const project = projects.find(p => p.path === path);
    if (project) {
      project.favorite = !project.favorite;
      await saveProjects();
      renderView();
    }
  });

  // ── Remove project ────────────────────────────────────────────────────────

  register('projectManager.removeProject', async (path) => {
    // If called from view, path is passed directly
    if (path) {
      projects = projects.filter(p => p.path !== path);
      await saveProjects();
      renderView();
      api.notifications?.info?.('Projeto removido');
      return;
    }

    const items = projects.map(p => ({
      label: p.name,
      description: p.path,
    }));

    if (items.length === 0) {
      api.notifications?.info?.('Nenhum projeto salvo.');
      return;
    }

    const choice = await api.window.showQuickPick(items, {
      placeholder: 'Selecionar projeto para remover',
    });
    if (!choice) return;

    projects = projects.filter(p => p.path !== choice.description);
    await saveProjects();
    renderView();
    api.notifications?.info?.(`Projeto "${choice.label}" removido`);
  });

  // ── Filter by tag ─────────────────────────────────────────────────────────

  register('projectManager.filterByTag', async () => {
    const allTags = [...new Set(projects.flatMap(p => p.tags))].sort();
    if (allTags.length === 0) {
      api.notifications?.info?.('Nenhuma tag encontrada.');
      return;
    }

    const choice = await api.window.showQuickPick(
      [{ label: 'All' }, ...allTags.map(t => ({ label: t }))],
      { placeholder: 'Filtrar projetos por tag' },
    );
    if (!choice) return;

    activeTagFilter = choice.label === 'All' ? null : choice.label;
    renderView();
  });

  register('projectManager.clearFilter', () => {
    activeTagFilter = null;
    renderView();
  });

  // ── Add tag to project ────────────────────────────────────────────────────

  register('projectManager.addTag', async () => {
    const items = projects.map(p => ({
      label: p.name,
      description: p.path,
      detail: p.tags.length ? `Tags: ${p.tags.join(', ')}` : 'Sem tags',
    }));

    if (items.length === 0) {
      api.notifications?.info?.('Nenhum projeto salvo.');
      return;
    }

    const choice = await api.window.showQuickPick(items, {
      placeholder: 'Selecionar projeto',
    });
    if (!choice) return;

    const tag = await api.window.showInputBox({
      prompt: 'Tag para adicionar',
      placeholder: 'work',
    });
    if (!tag) return;

    const project = projects.find(p => p.path === choice.description);
    if (project && !project.tags.includes(tag)) {
      project.tags.push(tag);
      await saveProjects();
      renderView();
      api.notifications?.info?.(`Tag "${tag}" adicionada a "${project.name}"`);
    }
  });

  // ── Refresh auto-detected ─────────────────────────────────────────────────

  register('projectManager.refreshDetected', async () => {
    const baseFolders = getSetting('projectManager.baseFolders', []);
    if (baseFolders.length === 0) {
      api.notifications?.warning?.('Configure projectManager.baseFolders para auto-detecção');
      return;
    }

    const progress = api.notifications?.progress?.('Detectando projetos...');
    try {
      const detected = await detectRepositories(baseFolders);
      let added = 0;

      for (const repo of detected) {
        if (!projects.some(p => p.path === repo.path)) {
          projects.push(repo);
          added++;
        }
      }

      await saveProjects();
      renderView();
      api.notifications?.info?.(`${detected.length} repos encontrados, ${added} novos adicionados`);
    } finally {
      progress?.done?.();
    }
  });

  // ── Open projects.json ────────────────────────────────────────────────────

  register('projectManager.openProjectsFile', async () => {
    const filePath = getProjectsFilePath();
    try {
      await api.editor?.openFile?.(filePath);
    } catch {
      api.notifications?.warning?.('Arquivo projects.json não encontrado. Salve um projeto primeiro.');
    }
  });

  // ── Status bar ────────────────────────────────────────────────────────────

  if (getSetting('projectManager.showProjectInStatusBar', true)) {
    try {
      const currentPath = getCurrentProjectPath();
      const currentProject = projects.find(p => p.path === currentPath);
      const projectName = currentProject?.name || getFolderName() || '—';

      const statusBar = api.window.createStatusBarItem({
        id: 'projectManager.statusBar',
        text: `$(folder) ${projectName}`,
        tooltip: 'Project Manager — Alt+Shift+P para trocar',
        command: 'projectManager.listProjects',
        alignment: 'left',
        priority: 100,
      });
      disposables.push(statusBar);
    } catch {
      // ignore
    }
  }

  // ── Search listener ───────────────────────────────────────────────────────

  try {
    const d = api.views.onDidChangeSearch('projectManager.panel', (query) => {
      searchQuery = query;
      renderView();
    });
    disposables.push(d);
  } catch {
    // views API may not be available yet
  }

  // Settings tab
  if (api.settings?.updateTabContent) {
    api.settings.updateTabContent('project-manager.settings', {
      sections: [
        {
          title: 'Project List',
          items: [
            { type: 'select', key: 'sortList', label: 'Sort By', description: 'Sort order for project list', defaultValue: 'name', options: [{ value: 'name', label: 'Name' }, { value: 'recent', label: 'Most Recent' }, { value: 'saved', label: 'Saved Order' }] },
            { type: 'toggle', key: 'groupList', label: 'Group by Tag', description: 'Group projects by tag', defaultValue: false },
            { type: 'toggle', key: 'removeCurrentFromList', label: 'Hide Current Project', description: 'Remove current project from the selection list', defaultValue: false },
            { type: 'toggle', key: 'showProjectInStatusBar', label: 'Show in Status Bar', description: 'Display project name in the status bar', defaultValue: true },
          ],
        },
        {
          title: 'Auto-Detection',
          items: [
            { type: 'number', key: 'maxDepthRecursion', label: 'Max Depth', description: 'Maximum recursion depth for auto-detecting repositories', defaultValue: 3, min: 1, max: 10 },
          ],
        },
      ],
    });
  }
}
  disposables.forEach(d => {
    if (typeof d === 'function') d();
    else if (d && typeof d.dispose === 'function') d.dispose();
  });
  disposables = [];
  projects = [];
  activeTagFilter = null;
  searchQuery = '';
  api = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// View Rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderView() {
  console.log('[ProjectManager] renderView() — projects.length=', projects.length, 'api.views=', !!(api && api.views));
  try {
    if (projects.length === 0) {
      console.log('[ProjectManager] calling updateView(projectManager.panel) [welcome]...');
      api.views.updateView('projectManager.panel', {
        type: 'welcome',
        welcome: {
          icon: '$(folder-opened)',
          title: 'Project Manager',
          description: 'Save your current workspace or detect repositories to get started.',
          actions: [
            { id: 'save', label: 'Save Current Project', icon: '$(add)', command: 'projectManager.saveProject' },
            { id: 'detect', label: 'Detect Repositories', icon: '$(search)', command: 'projectManager.refreshDetected' },
          ],
        },
      });
      return;
    }

    const visibleProjects = getVisibleProjects();

    // ── Stats ───────────────────────────────────────────────────────────────
    const allTags = [...new Set(projects.flatMap(p => p.tags))];
    const favorites = projects.filter(p => p.favorite);
    const detected = projects.filter(p => p.tags.includes('detected'));

    const stats = [
      { label: 'Projects', value: projects.length, icon: '$(folder)', color: '#3b82f6' },
      { label: 'Favorites', value: favorites.length, icon: '$(star-full)', color: '#f59e0b' },
      { label: 'Tags', value: allTags.length, icon: '$(tag)', color: '#8b5cf6' },
      { label: 'Detected', value: detected.length, icon: '$(search)', color: '#22c55e' },
    ];

    // ── Build sections ──────────────────────────────────────────────────────
    const sections = [
      {
        id: 'overview',
        title: 'Overview',
        collapsible: true,
        collapsed: false,
        type: 'stats',
        stats,
      },
    ];

    // Quick actions
    sections.push({
      id: 'actions',
      title: 'Quick Actions',
      collapsible: true,
      collapsed: true,
      type: 'actions',
      actions: [
        { id: 'save', label: 'Save Project', icon: '$(add)', command: 'projectManager.saveProject' },
        { id: 'detect', label: 'Detect Repos', icon: '$(search)', command: 'projectManager.refreshDetected' },
        { id: 'edit', label: 'Edit File', icon: '$(file-text)', command: 'projectManager.openProjectsFile' },
      ],
    });

    // ── Favorites section ───────────────────────────────────────────────────
    const favVisible = visibleProjects.filter(p => p.favorite);
    if (favVisible.length > 0) {
      sections.push({
        id: 'favorites',
        title: 'Favorites',
        collapsible: true,
        collapsed: false,
        badge: String(favVisible.length),
        badgeColor: '#f59e0b',
        type: 'list',
        items: favVisible.map(projectToViewItem),
      });
    }

    // ── Recent section (last 5 opened) ──────────────────────────────────────
    const recent = [...visibleProjects]
      .filter(p => p.lastOpened)
      .sort((a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || ''))
      .slice(0, 5);
    if (recent.length > 0) {
      sections.push({
        id: 'recent',
        title: 'Recent',
        collapsible: true,
        collapsed: false,
        badge: String(recent.length),
        type: 'list',
        items: recent.map(projectToViewItem),
      });
    }

    // ── Group by tag or flat list ───────────────────────────────────────────
    const groupByTags = getSetting('projectManager.groupList', false);

    if (groupByTags && allTags.length > 0) {
      // Group by each tag
      for (const tag of allTags.sort()) {
        const tagProjects = visibleProjects.filter(p => p.tags.includes(tag));
        if (tagProjects.length === 0) continue;

        sections.push({
          id: `tag-${tag}`,
          title: tag,
          collapsible: true,
          collapsed: true,
          badge: String(tagProjects.length),
          badgeColor: '#8b5cf6',
          type: 'list',
          items: tagProjects.map(projectToViewItem),
        });
      }

      // Untagged
      const untagged = visibleProjects.filter(p => p.tags.length === 0);
      if (untagged.length > 0) {
        sections.push({
          id: 'untagged',
          title: 'Untagged',
          collapsible: true,
          collapsed: true,
          badge: String(untagged.length),
          type: 'list',
          items: untagged.map(projectToViewItem),
        });
      }
    } else {
      // All projects flat
      const sortedProjects = [...visibleProjects].sort((a, b) => a.name.localeCompare(b.name));
      sections.push({
        id: 'all-projects',
        title: 'All Projects',
        collapsible: true,
        collapsed: false,
        badge: String(sortedProjects.length),
        type: 'list',
        items: sortedProjects.map(projectToViewItem),
      });
    }

    // ── Compose view ────────────────────────────────────────────────────────
    const viewContent = {
      type: 'sections',
      toolbar: [
        { id: 'add', label: 'Save Project', icon: '$(add)', tooltip: 'Save current project', command: 'projectManager.saveProject' },
        { id: 'filter', label: 'Filter by Tag', icon: '$(filter)', tooltip: 'Filter by tag', command: 'projectManager.filterByTag' },
        { id: 'refresh', label: 'Detect Repos', icon: '$(refresh)', tooltip: 'Detect repositories', command: 'projectManager.refreshDetected' },
      ],
      searchable: true,
      searchPlaceholder: 'Search projects...',
      badge: projects.length > 0 ? { count: projects.length, tooltip: `${projects.length} projects saved` } : undefined,
      sections,
      footer: activeTagFilter
        ? { text: `Filtered: ${activeTagFilter} — click to clear`, command: 'projectManager.clearFilter' }
        : { text: `${projects.length} projects saved` },
    };

    console.log('[ProjectManager] calling updateView(projectManager.panel) [sections]...');
    api.views.updateView('projectManager.panel', viewContent);
    console.log('[ProjectManager] updateView SUCCESS');
  } catch (e) {
    console.error('[ProjectManager] renderView FAILED:', e);
  }
}

function projectToViewItem(project) {
  const shortPath = project.path.length > 40
    ? '...' + project.path.slice(-37)
    : project.path;
  const timeAgo = project.lastOpened ? formatTimeAgo(project.lastOpened) : '';

  return {
    id: `project-${project.path}`,
    label: project.name,
    description: timeAgo ? `${shortPath} · ${timeAgo}` : shortPath,
    icon: project.favorite ? '$(star-full)' : '$(folder)',
    iconColor: project.favorite ? '#f59e0b' : project.tags.includes('detected') ? '#22c55e' : '#3b82f6',
    tooltip: `${project.name}\n${project.path}\nTags: ${project.tags.join(', ') || 'none'}`,
    command: 'projectManager.openByPath',
    commandArgs: [project.path],
    badge: project.tags.length > 0 ? project.tags[0] : undefined,
    badgeColor: '#8b5cf6',
    contextMenu: [
      { id: 'open', label: 'Open Project', icon: '$(folder-opened)', command: 'projectManager.openByPath', commandArgs: [project.path] },
      { id: 'fav', label: project.favorite ? 'Remove Favorite' : 'Add to Favorites', icon: '$(star)', command: 'projectManager.toggleFavorite', commandArgs: [project.path] },
      { id: 'remove', label: 'Remove Project', icon: '$(trash)', command: 'projectManager.removeProject', commandArgs: [project.path] },
    ],
  };
}

function getVisibleProjects() {
  let list = [...projects];

  // Tag filter
  if (activeTagFilter) {
    list = list.filter(p => p.tags.includes(activeTagFilter));
  }

  // Search filter
  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.path.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  return list;
}

function formatTimeAgo(isoDate) {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return date.toLocaleDateString();
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

function getProjectsFilePath() {
  const custom = getSetting('projectManager.projectsLocation', '');
  if (custom) return custom.endsWith('.json') ? custom : `${custom}/${PROJECTS_FILE}`;
  return PROJECTS_FILE;
}

async function loadProjects() {
  try {
    const filePath = getProjectsFilePath();
    const content = await api.workspace.readFile(filePath);
    if (content) {
      const parsed = JSON.parse(content);
      projects = Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    projects = [];
  }
}

async function saveProjects() {
  try {
    const filePath = getProjectsFilePath();
    const content = JSON.stringify(projects, null, 2);
    await api.workspace.writeFile(filePath, content);
  } catch {
    // storage may not be available
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-detection
// ─────────────────────────────────────────────────────────────────────────────

async function detectRepositories(baseFolders) {
  const maxDepth = getSetting('projectManager.maxDepthRecursion', 3);
  const ignoredFolders = getSetting('projectManager.ignoredFolders', [
    'node_modules', '.git', 'dist', 'build', '__pycache__', '.cache',
  ]);
  const detectGit = getSetting('projectManager.detectGit', true);
  const detectSvn = getSetting('projectManager.detectSvn', false);
  const detectMercurial = getSetting('projectManager.detectMercurial', false);

  const vcsMarkers = [];
  if (detectGit) vcsMarkers.push('.git');
  if (detectSvn) vcsMarkers.push('.svn');
  if (detectMercurial) vcsMarkers.push('.hg');

  if (vcsMarkers.length === 0) return [];

  const found = [];

  async function scan(dir, depth) {
    if (depth > maxDepth) return;

    try {
      const entries = await api.workspace.listDir(dir);
      if (!entries) return;

      const names = entries.map(e => (typeof e === 'string' ? e : e.name));

      // Check if current directory is a repo
      const isRepo = vcsMarkers.some(marker => names.includes(marker) || names.includes(marker + '/'));
      if (isRepo) {
        const name = dir.split(/[/\\]/).filter(Boolean).pop() || dir;
        found.push({ name, path: dir, tags: ['detected'], lastOpened: null });
        return; // Don't recurse into repos
      }

      // Recurse into subdirectories
      for (const entry of entries) {
        const entryName = typeof entry === 'string' ? entry : entry.name;
        const isDir = entry.isDirectory || (typeof entry === 'string' && entry.endsWith('/'));
        const cleanName = entryName.replace(/\/$/, '');

        if (isDir && !ignoredFolders.includes(cleanName) && !cleanName.startsWith('.')) {
          await scan(`${dir}/${cleanName}`, depth + 1);
        }
      }
    } catch {
      // skip inaccessible directories
    }
  }

  for (const base of baseFolders) {
    await scan(base, 0);
  }

  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────

function getProjectPickItems() {
  const sortBy = getSetting('projectManager.sortList', 'name');
  const removeCurrentFromList = getSetting('projectManager.removeCurrentFromList', false);
  const currentPath = getCurrentProjectPath();

  let sorted = [...projects];

  if (removeCurrentFromList && currentPath) {
    sorted = sorted.filter(p => p.path !== currentPath);
  }

  if (sortBy === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === 'recent') {
    sorted.sort((a, b) => {
      if (!a.lastOpened) return 1;
      if (!b.lastOpened) return -1;
      return b.lastOpened.localeCompare(a.lastOpened);
    });
  }

  return sorted.map(p => ({
    label: p.name,
    description: p.path,
    detail: p.tags.length ? `Tags: ${p.tags.join(', ')}` : undefined,
  }));
}

function updateStatusBar(projectName) {
  try {
    api.window.createStatusBarItem?.({
      id: 'projectManager.statusBar',
      text: `$(folder) ${projectName}`,
      tooltip: `Project Manager — ${projectName}`,
      command: 'projectManager.listProjects',
      alignment: 'left',
      priority: 100,
    });
  } catch {
    // ignore
  }
}

function openProject(projectPath, newWindow) {
  try {
    if (newWindow && api.workspace?.openFolder) {
      api.workspace.openFolder(projectPath, { newWindow: true });
    } else if (api.workspace?.openFolder) {
      api.workspace.openFolder(projectPath);
    } else {
      api.notifications?.info?.(`Abrir: ${projectPath}`);
    }
  } catch {
    api.notifications?.error?.(`Erro ao abrir projeto: ${projectPath}`);
  }
}

function getCurrentProjectPath() {
  try {
    return api.workspace?.rootPath || api.workspace?.getRootPath?.() || null;
  } catch {
    return null;
  }
}

function getFolderName() {
  const path = getCurrentProjectPath();
  if (!path) return null;
  return path.split(/[/\\]/).filter(Boolean).pop() || null;
}

// NOTE: api.settings.get is async — getSetting wraps it safely for sync use
function getSetting(key, defaultValue) {
  try {
    const val = api.settings?.get?.(key);
    // api.settings.get is async — if it returns a Promise, fall back to defaultValue
    if (val === undefined || val === null || (typeof val === 'object' && typeof val.then === 'function')) {
      return defaultValue;
    }
    return val;
  } catch {
    return defaultValue;
  }
}

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import type {
  ExtensionManifest,
  StatusBarItemContribution,
  ViewContribution,
  ThemeContribution,
  LanguageContribution,
  LspContribution,
  CommandContribution,
  KeybindingContribution,
  ConfigurationContribution,
  SnippetContribution,
  IconThemeContribution,
  MenuItem,
  ThemeDefinition,
  SettingsTabContribution,
} from '@hyscode/extension-api';
import { registerExtensionTheme, unregisterExtensionTheme } from '../lib/monaco-themes';
import {
  registerIconTheme,
  unregisterIconTheme,
  setActiveIconThemeId,
  registerLanguageIcon,
  clearLanguageIcons,
} from '../lib/icon-theme-registry';
import { useSettingsStore } from './settings-store';
import {
  activateAllExtensions,
  activateExtension,
  deactivateExtension,
  reloadExtension,
  checkAndReloadChangedExtensions,
} from '../lib/extension-loader';

// ── Types ────────────────────────────────────────────────────────────────────

export interface InstalledExtension {
  name: string;
  displayName: string;
  version: string;
  description: string;
  publisher: string;
  path: string;
  enabled: boolean;
  installedAt: string;
  manifest: ExtensionManifest | null;
  icon: string | null;
  categories: string[];
  activationEvents: string[];
  hasMain: boolean;
}

export type ExtensionFilter = 'all' | 'enabled' | 'disabled' | 'themes' | 'languages';

// ── Store (Marketplace) Types ─────────────────────────────────────────────────

export interface StoreItem {
  name: string;        // slug derived from filename, e.g. "angular-support"
  displayName: string; // formatted, e.g. "Angular Support"
  fileName: string;    // e.g. "angular-support.rar" or "angular-support.zip"
  downloadUrl: string; // raw GitHub download URL
  size: number;        // bytes
  sha: string;         // git blob sha for deduplication / update detection
}

const STORE_REPO_API = 'https://api.github.com/repos/Hyska-Software/Hyscode-Extensions/contents/';
export const STORE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Store-sha persistence (localStorage) ─────────────────────────────────────

const STORE_SHAS_KEY = 'hyscode.storeInstalledShas';

function loadStoreShas(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE_SHAS_KEY) ?? '{}') as Record<string, string>;
  } catch { return {}; }
}

function saveStoreShas(shas: Record<string, string>) {
  try { localStorage.setItem(STORE_SHAS_KEY, JSON.stringify(shas)); } catch { /* ignore */ }
}

function formatStoreName(fileName: string): string {
  const slug = fileName.replace(/\.(rar|zip)$/i, '');
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface GitUpdateInfo {
  extensionName: string;
  repoUrl: string;
  currentSha: string;
  remoteSha: string;
  hasUpdate: boolean;
}

export interface ExtensionGitSource {
  extensionName: string;
  repoUrl: string;
  branch: string;
  localClonePath: string;
  localCommitSha: string;
}

export interface MergedContributions {
  themes: Array<ThemeContribution & { extensionName: string }>;
  languages: Array<LanguageContribution & { extensionName: string }>;
  languageServers: Array<LspContribution & { extensionName: string }>;
  commands: Array<CommandContribution & { extensionName: string }>;
  keybindings: Array<KeybindingContribution & { extensionName: string }>;
  views: Array<ViewContribution & { extensionName: string }>;
  statusBarItems: Array<StatusBarItemContribution & { extensionName: string }>;
  configurations: Array<{ extensionName: string; config: ConfigurationContribution }>;
  snippets: Array<SnippetContribution & { extensionName: string }>;
  iconThemes: Array<IconThemeContribution & { extensionName: string }>;
  settingsTabs: Array<SettingsTabContribution & { extensionName: string }>;
  menus: {
    'editor/context': Array<MenuItem & { extensionName: string }>;
    'editor/title': Array<MenuItem & { extensionName: string }>;
    'explorer/context': Array<MenuItem & { extensionName: string }>;
    commandPalette: Array<MenuItem & { extensionName: string }>;
  };
}

function emptyContributions(): MergedContributions {
  return {
    themes: [],
    languages: [],
    languageServers: [],
    commands: [],
    keybindings: [],
    views: [],
    statusBarItems: [],
    configurations: [],
    snippets: [],
    iconThemes: [],
    settingsTabs: [],
    menus: {
      'editor/context': [],
      'editor/title': [],
      'explorer/context': [],
      commandPalette: [],
    },
  };
}

// ── State ────────────────────────────────────────────────────────────────────

interface ExtensionState {
  extensions: InstalledExtension[];
  loading: boolean;
  installing: boolean;
  error: string | null;
  searchQuery: string;
  filter: ExtensionFilter;
  selectedExtension: string | null;
  contributions: MergedContributions;
  extensionThemesVersion: number;
  extensionIconThemesVersion: number;
  // Git install/update
  gitUpdates: Record<string, GitUpdateInfo>;
  gitSources: Record<string, ExtensionGitSource>;
  checkingUpdates: boolean;
  installingFromGit: boolean;

  // Extension store (marketplace)
  storeItems: StoreItem[];
  storeLoading: boolean;
  storeError: string | null;
  installingFromStore: string | null;
  updatingFromStore: string | null;
  storeFetchedAt: number | null;
  installedStoreShas: Record<string, string>;

  // Actions
  loadExtensions: () => Promise<void>;
  installFromFolder: (sourcePath: string) => Promise<void>;
  installFromZip: (zipPath: string) => Promise<void>;
  installFromGit: (repoUrl: string, branch?: string) => Promise<void>;
  uninstallExtension: (name: string) => Promise<void>;
  toggleExtension: (name: string) => Promise<void>;
  checkGitUpdates: () => Promise<void>;
  updateFromGit: (extensionName: string) => Promise<void>;
  loadGitSources: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setFilter: (filter: ExtensionFilter) => void;
  selectExtension: (name: string | null) => void;
  rebuildContributions: () => void;
  loadExtensionThemes: (themes: Array<ThemeContribution & { extensionName: string }>) => Promise<void>;
  loadExtensionIconThemes: (
    iconThemes: Array<IconThemeContribution & { extensionName: string }>,
    languages: Array<LanguageContribution & { extensionName: string }>,
  ) => Promise<void>;
  fetchStoreItems: () => Promise<void>;
  installFromStore: (item: StoreItem) => Promise<void>;
  updateExtensionFromStore: (item: StoreItem) => Promise<void>;
  getStoreUpdates: () => string[];
  notifyIconThemeChanged: () => void;
  // Computed-like helpers
  getFiltered: () => InstalledExtension[];
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useExtensionStore = create<ExtensionState>()(
  immer((set, get) => ({
    extensions: [],
    loading: false,
    installing: false,
    error: null,
    searchQuery: '',
    filter: 'all' as ExtensionFilter,
    selectedExtension: null,
    contributions: emptyContributions(),
    extensionThemesVersion: 0,
    extensionIconThemesVersion: 0,
    gitUpdates: {},
    gitSources: {},
    checkingUpdates: false,
    installingFromGit: false,
    storeItems: [],
    storeLoading: false,
    storeError: null,
    installingFromStore: null,
    updatingFromStore: null,
    storeFetchedAt: null,
    installedStoreShas: loadStoreShas(),

    loadExtensions: async () => {
      const previousExtensions = get().extensions;

      set((s) => {
        s.loading = true;
        s.error = null;
      });

      try {
        const result = await invoke<InstalledExtension[]>('extension_list');
        set((s) => {
          s.extensions = result;
          s.loading = false;
        });
        get().rebuildContributions();

        if (previousExtensions.length === 0) {
          // First load (startup): activate all extensions then check for git updates
          void activateAllExtensions(get().extensions);
          void get().loadGitSources();
          void get().checkGitUpdates();
        } else {
          // Subsequent load (refresh): check for code changes and reload
          const current = get().extensions;
          void checkAndReloadChangedExtensions(current).then(() => {
            // Activate any newly added extensions that aren't active yet
            void activateAllExtensions(current);
          });
        }
      } catch (err) {
        set((s) => {
          s.error = String(err);
          s.loading = false;
        });
      }
    },

    installFromFolder: async (sourcePath: string) => {
      set((s) => {
        s.installing = true;
        s.error = null;
      });

      try {
        const ext = await invoke<InstalledExtension>('extension_install', {
          sourcePath,
        });
        set((s) => {
          s.extensions = s.extensions.filter((e) => e.name !== ext.name);
          s.extensions.push(ext);
          s.installing = false;
        });
        get().rebuildContributions();
        // Reload (deactivate + reactivate) so fresh code runs immediately
        void reloadExtension(ext);
      } catch (err) {
        set((s) => {
          s.error = String(err);
          s.installing = false;
        });
      }
    },

    installFromZip: async (zipPath: string) => {
      set((s) => {
        s.installing = true;
        s.error = null;
      });

      try {
        const ext = await invoke<InstalledExtension>('extension_install_zip', {
          zipPath,
        });
        set((s) => {
          s.extensions = s.extensions.filter((e) => e.name !== ext.name);
          s.extensions.push(ext);
          s.installing = false;
        });
        get().rebuildContributions();
        // Reload (deactivate + reactivate) so fresh code runs immediately
        void reloadExtension(ext);
      } catch (err) {
        set((s) => {
          s.error = String(err);
          s.installing = false;
        });
      }
    },

    installFromGit: async (repoUrl: string, branch?: string) => {
      set((s) => {
        s.installingFromGit = true;
        s.error = null;
      });

      try {
        const ext = await invoke<InstalledExtension>('extension_install_git', {
          repoUrl,
          branch: branch ?? null,
        });
        set((s) => {
          s.extensions = s.extensions.filter((e) => e.name !== ext.name);
          s.extensions.push(ext);
          s.installingFromGit = false;
        });
        get().rebuildContributions();
        void reloadExtension(ext);
        // Reload git sources to reflect the new entry
        void get().loadGitSources();
      } catch (err) {
        set((s) => {
          s.error = String(err);
          s.installingFromGit = false;
        });
      }
    },

    checkGitUpdates: async () => {
      set((s) => {
        s.checkingUpdates = true;
      });
      try {
        const updates = await invoke<GitUpdateInfo[]>('extension_check_git_updates');
        set((s) => {
          s.checkingUpdates = false;
          s.gitUpdates = {};
          for (const u of updates) {
            s.gitUpdates[u.extensionName] = u;
          }
        });
      } catch {
        set((s) => {
          s.checkingUpdates = false;
        });
      }
    },

    updateFromGit: async (extensionName: string) => {
      set((s) => {
        s.error = null;
      });
      try {
        const ext = await invoke<InstalledExtension>('extension_update_git', { extensionName });
        set((s) => {
          s.extensions = s.extensions.filter((e) => e.name !== ext.name);
          s.extensions.push(ext);
          // Clear the update badge
          if (s.gitUpdates[extensionName]) {
            s.gitUpdates[extensionName].hasUpdate = false;
          }
        });
        get().rebuildContributions();
        void reloadExtension(ext);
        void get().loadGitSources();
      } catch (err) {
        set((s) => {
          s.error = String(err);
        });
      }
    },

    loadGitSources: async () => {
      try {
        const sources = await invoke<ExtensionGitSource[]>('extension_get_git_sources');
        set((s) => {
          s.gitSources = {};
          for (const src of sources) {
            s.gitSources[src.extensionName] = src;
          }
        });
      } catch {
        // silently ignore — not critical
      }
    },

    uninstallExtension: async (name: string) => {
      try {
        await invoke('extension_uninstall', { name });
        // Also clean up git source record if this was a git-sourced extension
        const isGit = !!get().gitSources[name];
        if (isGit) {
          await invoke('extension_remove_git_source', { extensionName: name }).catch(() => {});
        }
        await deactivateExtension(name);
        set((s) => {
          s.extensions = s.extensions.filter((e) => e.name !== name);
          if (s.selectedExtension === name) s.selectedExtension = null;
          delete s.gitSources[name];
          delete s.gitUpdates[name];
        });
        get().rebuildContributions();
      } catch (err) {
        set((s) => {
          s.error = String(err);
        });
      }
    },

    toggleExtension: async (name: string) => {
      const ext = get().extensions.find((e) => e.name === name);
      if (!ext) return;

      const newEnabled = !ext.enabled;

      try {
        await invoke('extension_toggle', { name, enabled: newEnabled });
        set((s) => {
          const target = s.extensions.find((e) => e.name === name);
          if (target) target.enabled = newEnabled;
        });
        get().rebuildContributions();
        // Activate or deactivate the extension's main.js
        if (newEnabled) {
          const ext = get().extensions.find((e) => e.name === name);
          if (ext) void activateExtension(ext);
        } else {
          void deactivateExtension(name);
        }
      } catch (err) {
        set((s) => {
          s.error = String(err);
        });
      }
    },

    setSearchQuery: (query: string) => {
      set((s) => {
        s.searchQuery = query;
      });
    },

    setFilter: (filter: ExtensionFilter) => {
      set((s) => {
        s.filter = filter;
      });
    },

    selectExtension: (name: string | null) => {
      set((s) => {
        s.selectedExtension = name;
      });
    },

    fetchStoreItems: async () => {
      // Prevent concurrent fetches
      if (get().storeLoading) return;

      set((s) => { s.storeLoading = true; s.storeError = null; });
      try {
        const res = await fetch(STORE_REPO_API);
        if (!res.ok) {
          throw new Error(`GitHub API returned ${res.status}`);
        }
        const data = await res.json() as Array<{
          name: string;
          download_url: string;
          size: number;
          sha: string;
        }>;
        const items: StoreItem[] = data
          .filter((f) => /\.(rar|zip)$/i.test(f.name))
          .map((f) => ({
            name: f.name.replace(/\.(rar|zip)$/i, ''),
            displayName: formatStoreName(f.name),
            fileName: f.name,
            downloadUrl: f.download_url,
            size: f.size,
            sha: f.sha,
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));

        set((s) => {
          s.storeItems = items;
          s.storeLoading = false;
          s.storeFetchedAt = Date.now();

          // Establish sha baseline for installed extensions that have no
          // recorded sha yet (e.g. installed before tracking was added, or
          // installed via folder/zip and also present in the store).
          // Recording now means the NEXT sha change will be detected.
          const installedNames = new Set(s.extensions.map((e) => e.name));
          let baselineAdded = false;
          for (const item of items) {
            if (installedNames.has(item.name) && s.installedStoreShas[item.name] === undefined) {
              s.installedStoreShas[item.name] = item.sha;
              baselineAdded = true;
            }
          }
          if (baselineAdded) {
            saveStoreShas(s.installedStoreShas);
          }
        });
      } catch (err) {
        set((s) => { s.storeLoading = false; s.storeError = String(err); });
      }
    },

    installFromStore: async (item: StoreItem) => {
      set((s) => { s.installingFromStore = item.name; s.error = null; });
      try {
        const ext = await invoke<InstalledExtension>('extension_install_from_store', {
          downloadUrl: item.downloadUrl,
        });
        set((s) => {
          s.extensions = s.extensions.filter((e) => e.name !== ext.name);
          s.extensions.push(ext);
          s.extensions.sort((a, b) =>
            (a.displayName || a.name).toLowerCase().localeCompare((b.displayName || b.name).toLowerCase())
          );
          s.installingFromStore = null;
          // Record the installed sha so we can detect future updates
          s.installedStoreShas[ext.name] = item.sha;
          saveStoreShas(s.installedStoreShas);
        });
        get().rebuildContributions();
        void reloadExtension(ext);
      } catch (err) {
        set((s) => { s.installingFromStore = null; s.error = String(err); });
      }
    },

    updateExtensionFromStore: async (item: StoreItem) => {
      set((s) => { s.updatingFromStore = item.name; s.error = null; });
      try {
        const ext = await invoke<InstalledExtension>('extension_install_from_store', {
          downloadUrl: item.downloadUrl,
        });
        set((s) => {
          s.extensions = s.extensions.filter((e) => e.name !== ext.name);
          s.extensions.push(ext);
          s.extensions.sort((a, b) =>
            (a.displayName || a.name).toLowerCase().localeCompare((b.displayName || b.name).toLowerCase())
          );
          s.updatingFromStore = null;
          // Update recorded sha
          s.installedStoreShas[ext.name] = item.sha;
          saveStoreShas(s.installedStoreShas);
        });
        get().rebuildContributions();
        void reloadExtension(ext);
      } catch (err) {
        set((s) => { s.updatingFromStore = null; s.error = String(err); });
      }
    },

    getStoreUpdates: () => {
      const { storeItems, installedStoreShas, extensions } = get();
      const installedNames = new Set(extensions.map((e) => e.name));
      return storeItems
        .filter((item) => {
          if (!installedNames.has(item.name)) return false;
          const recordedSha = installedStoreShas[item.name];
          // Only flag as outdated if we have a recorded sha AND it differs
          return recordedSha !== undefined && recordedSha !== item.sha;
        })
        .map((item) => item.name);
    },

    getFiltered: () => {
      const { extensions, searchQuery, filter } = get();
      let filtered = [...extensions];

      // Apply search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.displayName.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.publisher.toLowerCase().includes(q) ||
            e.categories?.some((c) => c.toLowerCase().includes(q)),
        );
      }

      // Apply filter
      switch (filter) {
        case 'enabled':
          filtered = filtered.filter((e) => e.enabled);
          break;
        case 'disabled':
          filtered = filtered.filter((e) => !e.enabled);
          break;
        case 'themes':
          filtered = filtered.filter(
            (e) =>
              e.categories?.some((c) => c.toLowerCase().includes('theme')) ||
              e.manifest?.contributes?.themes?.length,
          );
          break;
        case 'languages':
          filtered = filtered.filter(
            (e) =>
              e.categories?.some((c) => c.toLowerCase().includes('language')) ||
              e.manifest?.contributes?.languages?.length ||
              e.manifest?.contributes?.languageServers?.length,
          );
          break;
      }

      return filtered;
    },

    rebuildContributions: () => {
      const enabled = get().extensions.filter((e) => e.enabled && e.manifest);
      const prev = get().contributions;
      const next = emptyContributions();

      for (const ext of enabled) {
        const c = ext.manifest?.contributes;
        if (!c) continue;
        const extName = ext.name;

        if (c.themes) {
          for (const t of c.themes) next.themes.push({ ...t, extensionName: extName });
        }
        if (c.languages) {
          for (const l of c.languages) next.languages.push({ ...l, extensionName: extName });
        }
        if (c.languageServers) {
          for (const ls of c.languageServers) next.languageServers.push({ ...ls, extensionName: extName });
        }
        if (c.commands) {
          for (const cmd of c.commands) next.commands.push({ ...cmd, extensionName: extName });
        }
        if (c.keybindings) {
          for (const kb of c.keybindings) next.keybindings.push({ ...kb, extensionName: extName });
        }
        if (c.views) {
          for (const v of c.views) next.views.push({ ...v, extensionName: extName });
        }
        if (c.statusBarItems) {
          for (const si of c.statusBarItems) next.statusBarItems.push({ ...si, extensionName: extName });
        }
        if (c.configuration) {
          next.configurations.push({ extensionName: extName, config: c.configuration });
        }
        if (c.snippets) {
          for (const s of c.snippets) next.snippets.push({ ...s, extensionName: extName });
        }
        if (c.iconThemes) {
          for (const it of c.iconThemes) next.iconThemes.push({ ...it, extensionName: extName });
        }
        if (c.settingsTabs) {
          for (const st of c.settingsTabs) next.settingsTabs.push({ ...st, extensionName: extName });
        }
        if (c.menus) {
          const menuKeys = ['editor/context', 'editor/title', 'explorer/context', 'commandPalette'] as const;
          for (const key of menuKeys) {
            const items = c.menus[key];
            if (items) {
              for (const item of items) next.menus[key].push({ ...item, extensionName: extName });
            }
          }
        }
      }

      // Unregister themes that are no longer active
      for (const old of prev.themes) {
        if (!next.themes.find((t) => t.id === old.id)) {
          unregisterExtensionTheme(old.id);
        }
      }

      // Unregister icon themes that are no longer active
      for (const old of prev.iconThemes) {
        if (!next.iconThemes.find((it) => it.id === old.id)) {
          unregisterIconTheme(old.id);
        }
      }

      set((s) => {
        s.contributions = next;
      });

      // Async: read theme JSON files and register them with Monaco + theme picker
      void get().loadExtensionThemes(next.themes);
      // Async: read icon theme JSON + SVG files and register with icon registry
      void get().loadExtensionIconThemes(next.iconThemes, next.languages);
    },

    loadExtensionThemes: async (themes: Array<ThemeContribution & { extensionName: string }>) => {
      for (const theme of themes) {
        if (!theme.path) continue;
        try {
          const content = await invoke<string>('extension_read_asset', {
            name: theme.extensionName,
            assetPath: theme.path,
          });
          const def = JSON.parse(content) as ThemeDefinition;
          // Ensure label and extensionName are populated
          if (!def.label) def.label = theme.label ?? def.id;
          if (!def.extensionName) def.extensionName = theme.extensionName;
          registerExtensionTheme(def);
        } catch (e) {
          console.warn(`[ExtensionStore] Failed to load theme "${theme.id}" from ${theme.path}:`, e);
        }
      }
      // Bump version so theme-tab re-renders and picks up getCustomThemeMetas()
      set((s) => { s.extensionThemesVersion++; });
    },

    loadExtensionIconThemes: async (
      iconThemes: Array<IconThemeContribution & { extensionName: string }>,
      languages: Array<LanguageContribution & { extensionName: string }>,
    ) => {
      // Generation token: if rebuildContributions is called again while this
      // async load is in flight, the new call will have a newer token and the
      // old results will be silently discarded.
      const generation = Date.now();
      (get() as unknown as { _iconThemeGeneration?: number })._iconThemeGeneration = generation;

      const isStale = () =>
        (get() as unknown as { _iconThemeGeneration?: number })._iconThemeGeneration !== generation;

      // ── Full icon theme packs ──────────────────────────────────────────────
      for (const contrib of iconThemes) {
        if (!contrib.path || isStale()) continue;
        try {
          const content = await invoke<string>('extension_read_asset', {
            name: contrib.extensionName,
            assetPath: contrib.path,
          });
          if (isStale()) continue;

          const def = JSON.parse(content) as import('@hyscode/extension-api').IconThemeDefinition;

          // Determine the directory of the theme JSON relative to extension root
          const themeDir = contrib.path.includes('/')
            ? contrib.path.substring(0, contrib.path.lastIndexOf('/') + 1)
            : contrib.path.includes('\\')
            ? contrib.path.substring(0, contrib.path.lastIndexOf('\\') + 1)
            : '';

          const svgLoader = async (svgPath: string): Promise<string | null> => {
            const fullPath = themeDir + svgPath;
            try {
              const raw = await invoke<string>('extension_read_asset', {
                name: contrib.extensionName,
                assetPath: fullPath,
              });
              const b64 = btoa(unescape(encodeURIComponent(raw)));
              return `data:image/svg+xml;base64,${b64}`;
            } catch {
              return null;
            }
          };

          await registerIconTheme(contrib.id, contrib.label, contrib.extensionName, def, svgLoader);
        } catch (e) {
          console.warn(`[ExtensionStore] Failed to load icon theme "${contrib.id}":`, e);
        }
      }

      if (isStale()) return;

      // ── Language icon contributions ────────────────────────────────────────
      // Collect all keys contributed by extension languages to clear stale entries first
      const allLangKeys: Array<{ ext?: string; name?: string }> = [];
      for (const lang of languages) {
        for (const ext of lang.extensions ?? []) allLangKeys.push({ ext });
        for (const name of lang.filenames ?? []) allLangKeys.push({ name });
      }
      clearLanguageIcons(allLangKeys);

      for (const lang of languages) {
        if (!lang.icon || isStale()) continue;
        try {
          const raw = await invoke<string>('extension_read_asset', {
            name: lang.extensionName,
            assetPath: lang.icon,
          });
          if (isStale()) continue;
          const b64 = btoa(unescape(encodeURIComponent(raw)));
          const dataUrl = `data:image/svg+xml;base64,${b64}`;
          registerLanguageIcon(lang.extensions ?? [], lang.filenames ?? [], dataUrl);
        } catch (e) {
          console.warn(`[ExtensionStore] Failed to load language icon for "${lang.id}":`, e);
        }
      }

      if (isStale()) return;

      // Sync active icon theme from settings (handles app restart persistence)
      const savedIconThemeId = useSettingsStore.getState().iconThemeId;
      setActiveIconThemeId(savedIconThemeId);

      set((s) => { s.extensionIconThemesVersion++; });
    },

    notifyIconThemeChanged: () => {
      set((s) => { s.extensionIconThemesVersion++; });
    },
  })),
);

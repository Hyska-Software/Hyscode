/**
 * Extension Loader
 *
 * Manages lifecycle of enabled extensions: activates them on startup,
 * deactivates them on disable/uninstall, and provides a minimal HyscodeAPI
 * implementation backed by existing Zustand stores.
 *
 * NOTE: Do NOT import from extension-store here — extension-store imports
 * from this module (activation helpers), which would create a circular dep.
 */

import { invoke } from '@tauri-apps/api/core';
import { ExtensionSandbox } from '@hyscode/extension-host';
import type {
  HyscodeAPI,
  Disposable,
  ThemeDefinition,
  LanguageRegistration,
  LspContribution,
  ExtensionContextMenuItem,
  DocumentFormatter,
  ExtensionStatusBarItem,
  ExtensionPanel,
  ExtensionToolbarAction,
  QuickPickItem,
  QuickPickOptions,
  InputBoxOptions,
  ViewContent,
  SettingsTabContent,
} from '@hyscode/extension-api';
import { registerExtensionTheme } from './monaco-themes';
import {
  registerLanguageIcon,
  getActiveIconThemeId,
  subscribeIconThemeChange,
} from './icon-theme-registry';
import { useProjectStore } from '../stores/project-store';
import { useSettingsStore } from '../stores/settings-store';
import { useEditorStore } from '../stores/editor-store';
import { useExtensionUiStore } from '../stores/extension-ui-store';
import { useExtensionSettingsStore } from '../stores/extension-settings-store';
import { useCommandStore } from '../stores/command-store';
import { useKeybindingStore } from '../stores/keybinding-store';
import { useViewRegistryStore } from '../stores/view-registry-store';
import { useTerminalStore } from '../stores/terminal-store';
import { useLayoutStore } from '../stores/layout-store';
import type { InstalledExtension } from '../stores/extension-store';

// ── Singleton sandbox ────────────────────────────────────────────────────────

const _sandbox = new ExtensionSandbox();

// ── Tab visibility listener map ───────────────────────────────────────────────
// Maps tabId → Set of handlers to call when the user opens that settings tab.

const _tabVisibilityListeners = new Map<string, Set<() => void>>();

/**
 * Called by the Settings modal when the user activates an extension tab.
 * Notifies all `onTabVisible` subscribers for that tabId.
 */
export function notifyTabVisible(tabId: string): void {
  _tabVisibilityListeners.get(tabId)?.forEach((fn) => fn());
}

// ── Source hash cache (detects code changes on disk) ─────────────────────────

const _sourceHashes = new Map<string, string>();

/** Simple hash of a string (DJB2). Fast, no crypto needed — just change detection. */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

// ── Minimal HyscodeAPI implementation ────────────────────────────────────────

function noop(): Disposable {
  return { dispose() {} };
}

const _api: HyscodeAPI = {
  workspace: {
    get rootPath() {
      return useProjectStore.getState().rootPath;
    },
    async readFile(path: string): Promise<string> {
      return invoke<string>('fs_read_text', { path });
    },
    async writeFile(path: string, content: string): Promise<void> {
      await invoke('fs_write_text', { path, content });
    },
    async listDir(path: string) {
      return invoke('fs_list_dir', { path });
    },
    onDidOpenFile: noop,
    onDidSaveFile: noop,
    onDidCloseFile: noop,
  },

  commands: {
    register(id: string, handler: (...args: unknown[]) => unknown): Disposable {
      const dispose = useCommandStore.getState().registerCommand(id, handler);
      return { dispose };
    },
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable {
      const dispose = useCommandStore.getState().registerCommand(id, handler);
      return { dispose };
    },
    async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
      return (await useCommandStore.getState().executeCommand(id, ...args)) as T;
    },
    getCommands(): string[] {
      return useCommandStore.getState().getAllCommands().map((c) => c.id);
    },
  },

  window: {
    async showInformationMessage(message: string): Promise<string | undefined> {
      console.info(`[Extension] ℹ️ ${message}`);
      return undefined;
    },
    async showWarningMessage(message: string): Promise<string | undefined> {
      console.warn(`[Extension] ⚠️ ${message}`);
      return undefined;
    },
    async showErrorMessage(message: string): Promise<string | undefined> {
      console.error(`[Extension] ❌ ${message}`);
      return undefined;
    },
    createStatusBarItem(options) {
      return {
        id: options.id,
        text: options.text,
        tooltip: options.tooltip,
        command: options.command,
        show() {},
        hide() {},
        update() {},
        dispose() {},
      };
    },
    registerViewProvider(_viewId: string): Disposable {
      // Legacy provider — extensions should use api.views.updateView() instead
      return noop();
    },
    async showQuickPick(
      items: QuickPickItem[],
      options?: QuickPickOptions,
    ): Promise<QuickPickItem | undefined> {
      const result = await useExtensionUiStore.getState().showQuickPick(items, options);
      return result ? items.find((i) => i.label === result.label) : undefined;
    },
    async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
      return useExtensionUiStore.getState().showInputBox(options);
    },
  },

  views: {
    updateView(viewId: string, content: ViewContent): void {
      console.log(`[ExtAPI:views] updateView("${viewId}") type="${content?.type}"`);
      useViewRegistryStore.getState().updateView(viewId, content);
    },
    setViewBadge(viewId: string, badge: { count: number; tooltip?: string } | null): void {
      useViewRegistryStore.getState().setViewBadge(viewId, badge);
    },
    onDidChangeSearch(viewId: string, handler: (query: string) => void): Disposable {
      return useViewRegistryStore.getState().onDidChangeSearch(viewId, handler);
    },
    onDidChangeVisibility(viewId: string, handler: (visible: boolean) => void): Disposable {
      return useViewRegistryStore.getState().onDidChangeVisibility(viewId, handler);
    },
    revealView(_viewId: string): void {
      // TODO: integrate with sidebar store to switch active view
    },
  },

  editor: {
    get activeFilePath(): string | null {
      return useEditorStore.getState().activeTabId ?? null;
    },
    async openFile(path: string): Promise<void> {
      const { openTab } = useEditorStore.getState();
      const sep = path.includes('/') ? '/' : '\\';
      const fileName = path.split(sep).pop() ?? 'file';
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      openTab({ id: path, filePath: path, fileName, language: ext || 'plaintext', viewerType: 'code' });
    },
    getSelectedText(): string | null {
      return null;
    },
    insertText(_text: string): void {
      console.warn('[HyscodeAPI] insertText not implemented');
    },
    addDecorations(): Disposable {
      return noop();
    },
  },

  settings: {
    async get<T>(_key: string, defaultValue?: T): Promise<T | undefined> {
      return defaultValue;
    },
    async set(_key: string, _value: unknown): Promise<void> {},
    onDidChange(_key: string): Disposable {
      return noop();
    },
    updateTabContent(_tabId: string, _content: SettingsTabContent): void {},
    onTabVisible(_tabId: string): Disposable {
      return noop();
    },
  },

  git: {
    async currentBranch(): Promise<string | null> {
      return null;
    },
    async status() {
      return [];
    },
    async diff(): Promise<string> {
      return '';
    },
    onDidChangeBranch: noop,
  },

  themes: {
    registerTheme(theme: ThemeDefinition): Disposable {
      registerExtensionTheme(theme);
      return {
        dispose() {
          // Note: unregisterExtensionTheme is available but we keep it simple
        },
      };
    },
    getActiveThemeId(): string {
      return useSettingsStore.getState().themeId;
    },
  },

  iconThemes: {
    registerFileExtensionIcon(extensions: string[], svgDataUrl: string): Disposable {
      registerLanguageIcon(extensions, [], svgDataUrl);
      return { dispose() {} };
    },
    registerFileNameIcon(fileNames: string[], svgDataUrl: string): Disposable {
      registerLanguageIcon([], fileNames, svgDataUrl);
      return { dispose() {} };
    },
    getActiveIconThemeId(): string {
      return getActiveIconThemeId();
    },
    onDidChangeIconTheme(handler: (themeId: string) => void): Disposable {
      const unsub = subscribeIconThemeChange(handler);
      return { dispose: unsub };
    },
  },

  languages: {
    registerLanguage(_language: LanguageRegistration): Disposable {
      return noop();
    },
    registerLanguageServer(_config: LspContribution): Disposable {
      return noop();
    },
    setLanguageDiagnostics(_uri: string, _diagnostics: unknown[]): void {},
  },

  notifications: {
    showInfo(message: string): void {
      useExtensionUiStore.getState().showNotification('info', message);
    },
    showWarning(message: string): void {
      useExtensionUiStore.getState().showNotification('warning', message);
    },
    showError(message: string): void {
      useExtensionUiStore.getState().showNotification('error', message);
    },
    showProgress(_title: string, task): void {
      task({ report() {} }).catch(console.error);
    },
  },

  extensions: {
    getExtension(_name: string) {
      return undefined;
    },
    getAllExtensions() {
      return [];
    },
    onDidChange: noop,
  },

  ui: {
    registerContextMenuItem(item: ExtensionContextMenuItem): Disposable {
      return useExtensionUiStore.getState().addContextMenuItem('__runtime__', item);
    },
    registerDocumentFormatter(formatter: DocumentFormatter): Disposable {
      return useExtensionUiStore.getState().addFormatter('__runtime__', formatter);
    },
    registerStatusBarItem(item: ExtensionStatusBarItem): Disposable {
      return useExtensionUiStore.getState().addStatusBarItem('__runtime__', item);
    },
    registerPanel(panel: ExtensionPanel): Disposable {
      return useExtensionUiStore.getState().addPanel('__runtime__', panel);
    },
    registerToolbarAction(action: ExtensionToolbarAction): Disposable {
      return useExtensionUiStore.getState().addToolbarAction('__runtime__', action);
    },
    async showQuickPick(
      items: QuickPickItem[],
      options?: QuickPickOptions,
    ): Promise<QuickPickItem | undefined> {
      const result = await useExtensionUiStore.getState().showQuickPick(items, options);
      return result ? items.find((i) => i.label === result.label) : undefined;
    },
    async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
      return useExtensionUiStore.getState().showInputBox(options);
    },
  },

  terminal: {
    async sendToActive(command: string): Promise<void> {
      const termStore = useTerminalStore.getState();
      const rootPath = useProjectStore.getState().rootPath;

      // Try active session first, then any live non-agent session
      let session =
        termStore.sessions.find(
          (s) => s.id === termStore.activeSessionId && !s.isDead && s.ptyId,
        ) ??
        termStore.sessions.find((s) => !s.isAgentSession && !s.isDead && s.ptyId);

      let ptyId = session?.ptyId ?? null;
      let isNewPty = false;

      // No live session — spawn PTY FIRST, then show terminal so the component
      // reuses our ptyId instead of creating a second shell (race-condition fix).
      if (!ptyId) {
        const sessionId = termStore.createSession('Extension Terminal', false, rootPath ?? undefined);
        ptyId = await invoke<string>('pty_spawn', {
          shell: null,
          cwd: rootPath ?? null,
          env: null,
        });
        termStore.setPtyId(sessionId, ptyId);
        isNewPty = true;
      }

      // Show terminal panel AFTER ptyId is registered so the component sees it
      useLayoutStore.getState().setTerminalVisible(true);

      // Wait for shell to initialize before writing command
      if (isNewPty) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      }

      await invoke('pty_write', { ptyId, data: command + '\r' });
    },
  },

  process: {
    async exec(program: string, args: string[], cwd?: string): Promise<string> {
      return invoke<string>('shell_exec', { program, args, cwd: cwd ?? null });
    },
  },
};

// ── Per-extension API factory ────────────────────────────────────────────────

/** Creates an API clone whose `ui`, `commands`, and `settings` calls are scoped to the extension. */
function createExtensionApi(extensionName: string): HyscodeAPI {
  const uiStore = useExtensionUiStore.getState;
  const cmdStore = useCommandStore.getState;
  /** Returns the scoped storage key: `extensionName.userKey` */
  const scopedKey = (key: string) => `${extensionName}.${key}`;
  return {
    ..._api,
    settings: {
      async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
        return useExtensionSettingsStore.getState().getValue<T>(scopedKey(key), defaultValue);
      },
      async set(key: string, value: unknown): Promise<void> {
        useExtensionSettingsStore.getState().setValue(scopedKey(key), value);
      },
      onDidChange(key: string, handler: (newValue: unknown) => void): Disposable {
        const unsub = useExtensionSettingsStore.getState().subscribe(scopedKey(key), handler);
        return { dispose: unsub };
      },
      updateTabContent(tabId: string, content: SettingsTabContent): void {
        useExtensionUiStore.getState().setSettingsTabContent(tabId, content);
      },
      onTabVisible(tabId: string, handler: () => void): Disposable {
        if (!_tabVisibilityListeners.has(tabId)) {
          _tabVisibilityListeners.set(tabId, new Set());
        }
        _tabVisibilityListeners.get(tabId)!.add(handler);
        return {
          dispose() {
            _tabVisibilityListeners.get(tabId)?.delete(handler);
          },
        };
      },
    },
    commands: {
      register(id: string, handler: (...args: unknown[]) => unknown): Disposable {
        const dispose = cmdStore().registerCommand(id, handler, { extensionName });
        return { dispose };
      },
      registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable {
        const dispose = cmdStore().registerCommand(id, handler, { extensionName });
        return { dispose };
      },
      async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
        return (await cmdStore().executeCommand(id, ...args)) as T;
      },
      getCommands(): string[] {
        return cmdStore().getAllCommands().map((c) => c.id);
      },
    },
    ui: {
      registerContextMenuItem(item: ExtensionContextMenuItem): Disposable {
        return uiStore().addContextMenuItem(extensionName, item);
      },
      registerDocumentFormatter(formatter: DocumentFormatter): Disposable {
        return uiStore().addFormatter(extensionName, formatter);
      },
      registerStatusBarItem(item: ExtensionStatusBarItem): Disposable {
        return uiStore().addStatusBarItem(extensionName, item);
      },
      registerPanel(panel: ExtensionPanel): Disposable {
        return uiStore().addPanel(extensionName, panel);
      },
      registerToolbarAction(action: ExtensionToolbarAction): Disposable {
        return uiStore().addToolbarAction(extensionName, action);
      },
      async showQuickPick(
        items: QuickPickItem[],
        options?: QuickPickOptions,
      ): Promise<QuickPickItem | undefined> {
        const result = await uiStore().showQuickPick(items, options);
        return result ? items.find((i) => i.label === result.label) : undefined;
      },
      async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
        return uiStore().showInputBox(options);
      },
    },
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register command metadata and keybindings from extension manifests into
 * the command store and keybinding store. This ensures commands declared in
 * extension.json (but whose handlers are registered at runtime by main.js)
 * appear in the Command Palette with titles, categories and keybindings.
 */
export function registerExtensionContributions(ext: InstalledExtension): void {
  if (!ext.manifest?.contributes) return;
  const { commands: cmds, keybindings: kbs } = ext.manifest.contributes;
  const cmdStore = useCommandStore.getState();
  const kbStore = useKeybindingStore.getState();

  // Register command metadata (title/category) if not yet registered by main.js
  if (cmds) {
    for (const cmd of cmds) {
      if (!cmdStore.hasCommand(cmd.id)) {
        cmdStore.registerCommand(cmd.id, () => {
          console.warn(`[ExtensionLoader] Command "${cmd.id}" invoked but no handler registered yet.`);
        }, {
          title: cmd.title,
          category: cmd.category,
          extensionName: ext.name,
        });
      }
    }
  }

  // Register keybindings
  if (kbs) {
    for (const kb of kbs) {
      kbStore.register({
        command: kb.command,
        key: kb.key,
        when: kb.when,
        extensionName: ext.name,
      });
    }
  }
}

/**
 * Unregister all commands and keybindings from a specific extension.
 */
export function unregisterExtensionContributions(name: string): void {
  useCommandStore.getState().removeExtensionCommands(name);
  useKeybindingStore.getState().removeExtensionBindings(name);
}

/**
 * Activate a single enabled extension that has a main entry point.
 * Reads main.js from the Rust backend and executes it in the sandbox.
 */
export async function activateExtension(ext: InstalledExtension): Promise<void> {
  if (!ext.enabled || !ext.hasMain || !ext.manifest) {
    console.log(`[ExtensionLoader] Skip "${ext.name}" — enabled=${ext.enabled} hasMain=${ext.hasMain} hasManifest=${!!ext.manifest}`);
    return;
  }
  if (_sandbox.isActive(ext.name)) {
    console.log(`[ExtensionLoader] Already active: "${ext.name}"`);
    return;
  }

  // Pre-register command metadata & keybindings from manifest
  registerExtensionContributions(ext);

  console.log(`[ExtensionLoader] Activating "${ext.name}"...`);
  try {
    const mainPath = ext.manifest.main ?? 'main.js';
    const source = await invoke<string>('extension_read_asset', {
      name: ext.name,
      assetPath: mainPath,
    });
    // Store content hash for change detection
    _sourceHashes.set(ext.name, hashString(source + JSON.stringify(ext.manifest)));
    console.log(`[ExtensionLoader] Source loaded for "${ext.name}" (${source?.length ?? 0} chars)`);
    const api = createExtensionApi(ext.name);
    await _sandbox.activate(ext.manifest, ext.path, source, api);
    console.log(`[ExtensionLoader] ✅ Activation complete for "${ext.name}"`);
  } catch (err) {
    console.warn(`[ExtensionLoader] ❌ Could not activate "${ext.name}":`, err);
  }
}

/**
 * Deactivate a single extension.
 */
export async function deactivateExtension(name: string): Promise<void> {
  await _sandbox.deactivate(name);
  _sourceHashes.delete(name);
  useExtensionUiStore.getState().removeAllForExtension(name);
  unregisterExtensionContributions(name);
}

/**
 * Reload a single extension: deactivate then re-activate with fresh code from disk.
 */
export async function reloadExtension(ext: InstalledExtension): Promise<void> {
  console.log(`[ExtensionLoader] Reloading "${ext.name}"...`);
  await deactivateExtension(ext.name);
  await activateExtension(ext);
}

/**
 * Check all active extensions for code changes on disk.
 * If an extension's source has changed, reload it automatically.
 * Returns the names of extensions that were reloaded.
 */
export async function checkAndReloadChangedExtensions(
  extensions: InstalledExtension[],
): Promise<string[]> {
  const reloaded: string[] = [];
  const eligible = extensions.filter((e) => e.enabled && e.hasMain && e.manifest);

  for (const ext of eligible) {
    if (!_sandbox.isActive(ext.name)) continue; // not yet activated, skip

    try {
      const mainPath = ext.manifest!.main ?? 'main.js';
      const source = await invoke<string>('extension_read_asset', {
        name: ext.name,
        assetPath: mainPath,
      });
      const currentHash = hashString(source + JSON.stringify(ext.manifest));
      const previousHash = _sourceHashes.get(ext.name);

      if (previousHash && previousHash !== currentHash) {
        console.log(`[ExtensionLoader] Change detected in "${ext.name}" — reloading...`);
        await reloadExtension(ext);
        reloaded.push(ext.name);
      }
    } catch (err) {
      console.warn(`[ExtensionLoader] Failed to check "${ext.name}" for changes:`, err);
    }
  }

  if (reloaded.length > 0) {
    console.log(`[ExtensionLoader] Reloaded ${reloaded.length} extension(s):`, reloaded);
  }

  return reloaded;
}

/**
 * Activate all enabled extensions that have a main entry point.
 * Runs activations in parallel.
 */
export async function activateAllExtensions(extensions: InstalledExtension[]): Promise<void> {
  const eligible = extensions.filter((e) => e.enabled && e.hasMain && e.manifest);
  // Also register contributions for extensions without main.js (theme-only, etc.)
  for (const ext of extensions.filter((e) => e.enabled && !e.hasMain && e.manifest)) {
    registerExtensionContributions(ext);
  }
  await Promise.allSettled(eligible.map(activateExtension));
}

/**
 * Deactivate all currently active extensions.
 */
export async function deactivateAllExtensions(): Promise<void> {
  await _sandbox.deactivateAll();
}

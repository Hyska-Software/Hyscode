// ─── LSP Bridge ──────────────────────────────────────────────────────────────
// Singleton orchestration layer that connects:
//   - LspManager (manages server lifecycle)
//   - Built-in server configs (top 10 languages)
//   - Extension-contributed language servers
//   - Monaco editor (syntax + intellisense)
//   - Zustand lsp-store (status tracking)
//
// Lives outside React to avoid re-renders during LSP communication.

import {
  LspManager,
  BUILTIN_SERVERS,
  getUniqueServerCommands,
  getBuiltinServerForLanguage,
  registerAllLanguages,
  detectLspLanguage,
} from '@hyscode/lsp-client';
import type { LspContribution } from '@hyscode/extension-api';
import { useLspStore } from '@/stores/lsp-store';
import type { LspServerInfo } from '@/stores/lsp-store';
import type { LspConnectionStatus } from '@hyscode/lsp-client';
import { useSettingsStore } from '@/stores/settings-store';

type MonacoInstance = typeof import('monaco-editor');
type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriListen = (event: string, handler: (payload: { payload: string }) => void) => Promise<() => void>;

// Document version tracking for textDocument/didChange
const documentVersions = new Map<string, number>();

function getNextVersion(uri: string): number {
  const current = documentVersions.get(uri) ?? 0;
  const next = current + 1;
  documentVersions.set(uri, next);
  return next;
}

// Debounce timers for didChange notifications
const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const CHANGE_DEBOUNCE_MS = 300;

class LspBridgeImpl {
  private manager: LspManager | null = null;
  private invoke: TauriInvoke | null = null;
  private rootUri: string | null = null;
  private initialized = false;
  private openDocuments = new Set<string>(); // URIs of open documents
  private extensionConfigs: LspContribution[] = [];

  /**
   * Initialize the LSP bridge with Tauri IPC functions and workspace root.
   */
  async init(
    invoke: TauriInvoke,
    listen: TauriListen,
    rootPath: string,
  ): Promise<void> {
    if (this.initialized) return;

    this.invoke = invoke;
    const normalized = rootPath.replace(/\\/g, '/');
    this.rootUri = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
    console.log('[LspBridge] init rootPath=', rootPath, 'rootUri=', this.rootUri);

    this.manager = new LspManager(invoke, listen);
    this.manager.setRootUri(this.rootUri);

    // Register status change listener → lsp-store
    this.manager.onStatusChange((languageId, status) => {
      this.updateStoreStatus(languageId, status);
    });

    // Register built-in server configs
    const customPaths = useSettingsStore.getState().lspCustomBinaryPaths;
    for (const server of BUILTIN_SERVERS) {
      const store = useLspStore.getState();
      if (store.disabledServers.has(server.id)) continue;
      const customPath = customPaths[server.id];
      const config = customPath ? { ...server, command: customPath } : server;
      this.manager.registerServerConfig(config);
    }

    // Register any extension configs that arrived before init
    for (const config of this.extensionConfigs) {
      this.manager.registerServerConfig(config);
    }

    this.initialized = true;

    // Probe servers in background
    this.probeAllServers();
  }

  /**
   * Set the Monaco editor instance. Must be called when Monaco mounts.
   */
  setMonaco(monaco: MonacoInstance): void {
    // Register all languages for universal syntax highlighting
    registerAllLanguages(monaco);

    if (this.manager) {
      this.manager.setMonaco(monaco);
    }
  }

  /**
   * Called when a file is opened in the editor.
   * Starts the appropriate LSP server (if available) and sends didOpen.
   */
  async onFileOpened(filePath: string, languageId: string, content: string): Promise<void> {
    if (!this.manager || !this.initialized) return;

    const uri = this.filePathToUri(filePath);

    // Track open document
    this.openDocuments.add(uri);

    // Ensure the language server is running
    await this.manager.onLanguageOpened(languageId, filePath);

    // Send textDocument/didOpen
    const connection = this.manager.getConnection(languageId);
    if (connection && connection.status === 'ready') {
      const version = getNextVersion(uri);
      connection.didOpen(uri, languageId, version, content);
    }
  }

  /**
   * Called when file content changes in the editor.
   * Debounced to avoid flooding the server.
   */
  onFileChanged(filePath: string, languageId: string, content: string): void {
    if (!this.manager || !this.initialized) return;

    const uri = this.filePathToUri(filePath);

    // Clear existing timer
    const existing = changeTimers.get(uri);
    if (existing) clearTimeout(existing);

    // Set debounced didChange
    changeTimers.set(
      uri,
      setTimeout(() => {
        changeTimers.delete(uri);

        const connection = this.manager?.getConnection(languageId);
        if (connection && connection.status === 'ready') {
          const version = getNextVersion(uri);
          connection.didChange(uri, version, [{ text: content }]);
        }
      }, CHANGE_DEBOUNCE_MS),
    );
  }

  /**
   * Called when a file is saved.
   */
  onFileSaved(filePath: string, languageId: string, content: string): void {
    if (!this.manager || !this.initialized) return;

    const uri = this.filePathToUri(filePath);
    const connection = this.manager.getConnection(languageId);
    if (connection && connection.status === 'ready') {
      connection.didSave(uri, content);
    }
  }

  /**
   * Called when a file is closed in the editor.
   */
  async onFileClosed(filePath: string, languageId: string): Promise<void> {
    if (!this.manager || !this.initialized) return;

    const uri = this.filePathToUri(filePath);

    // Guard against duplicate close notifications (two effects can fire for the same doc)
    if (!this.openDocuments.has(uri)) return;

    // Send textDocument/didClose
    const connection = this.manager.getConnection(languageId);
    if (connection && connection.status === 'ready') {
      connection.didClose(uri);
    }

    this.openDocuments.delete(uri);
    documentVersions.delete(uri);

    // Clear any pending debounce
    const timer = changeTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      changeTimers.delete(uri);
    }

    // Let manager know (decrements open doc count, stops server if 0)
    await this.manager.onLanguageClosed(languageId);
  }

  /**
   * Register language server configs from an extension.
   */
  registerExtensionServers(configs: LspContribution[]): void {
    this.extensionConfigs.push(...configs);

    if (this.manager && this.initialized) {
      for (const config of configs) {
        this.manager.registerServerConfig(config);
      }
    }
  }

  /**
   * Unregister language server configs from a specific extension.
   */
  unregisterExtensionServers(_extensionName: string): void {
    this.extensionConfigs = this.extensionConfigs.filter(
      () => false, // Can't easily match by name without extensionName tracking; reload required
    );

    // Note: We can't easily unregister from the running manager without restarting servers.
    // Extension uninstall will require a reload for LSP changes to take effect.
  }

  /**
   * Restart a specific language server.
   */
  async restartServer(languageId: string): Promise<void> {
    if (!this.manager) return;

    await this.manager.stopServer(languageId);
    useLspStore.getState().removeServer(languageId);

    // Re-open if there are documents for this language (including variants like tsx → typescriptreact)
    let reopenFilePath: string | undefined;
    const hasOpenDocs = Array.from(this.openDocuments).some((uri) => {
      const path = this.uriToFilePath(uri);
      const docLang = detectLspLanguage(path);
      if (docLang === languageId) {
        reopenFilePath = path;
        return true;
      }
      return false;
    });

    if (hasOpenDocs) {
      await this.manager.onLanguageOpened(languageId, reopenFilePath);
    }
  }

  /**
   * Get the status of a specific language's server.
   */
  getStatus(languageId: string): LspConnectionStatus | undefined {
    return this.manager?.getStatus(languageId);
  }

  /**
   * Check if a language has a configured server (builtin or extension).
   */
  hasServer(languageId: string): boolean {
    return this.manager?.hasServer(languageId) ?? false;
  }

  /**
   * Probe all unique server binaries to check if they're installed.
   */
  /** Public: re-scan all server binaries (e.g. after user installs a server). */
  async reprobeServers(): Promise<void> {
    useLspStore.getState().setProbeComplete(false);
    await this.probeAllServers();
  }

  /**
   * Apply a custom binary path override for a built-in server.
   * Re-registers the config and restarts any running server so the new binary takes effect.
   */
  async updateServerBinaryPath(serverId: string, binaryPath: string): Promise<void> {
    if (!this.manager) return;

    const server = BUILTIN_SERVERS.find((s) => s.id === serverId);
    if (!server) return;

    const config = binaryPath ? { ...server, command: binaryPath } : server;
    this.manager.registerServerConfig(config);

    // Probe the new binary immediately so the UI reflects its status
    if (this.invoke) {
      const commandToProbe = binaryPath || server.command;
      const found = (await this.invoke('lsp_probe_server', { command: commandToProbe })) as boolean;
      useLspStore.getState().setProbeResult(commandToProbe, found);
    }

    // Restart any currently-running server for this config's languages
    for (const langId of server.languageIds) {
      if (this.manager.getStatus(langId) !== undefined) {
        await this.restartServer(langId);
      }
    }
  }

  private async probeAllServers(): Promise<void> {
    if (!this.invoke) return;

    const commands = getUniqueServerCommands();

    // Also probe any user-configured custom binary paths
    const customPaths = useSettingsStore.getState().lspCustomBinaryPaths;
    const allCommands = new Set(commands);
    for (const path of Object.values(customPaths)) {
      if (path) allCommands.add(path);
    }

    const store = useLspStore.getState();

    const results = await Promise.allSettled(
      Array.from(allCommands).map(async (command) => {
        const found = (await this.invoke!('lsp_probe_server', { command })) as boolean;
        store.setProbeResult(command, found);
        return { command, found };
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        console.log(
          `[LspBridge] Probe ${result.value.command}: ${result.value.found ? '✓ found' : '✗ not found'}`,
        );
      }
    }

    store.setProbeComplete(true);
  }

  /**
   * Update the Zustand store with server status changes.
   */
  private updateStoreStatus(languageId: string, status: LspConnectionStatus): void {
    const store = useLspStore.getState();
    const builtinConfig = getBuiltinServerForLanguage(languageId);

    const info: LspServerInfo = {
      serverId: `lsp-${languageId}`,
      languageId,
      displayName: builtinConfig?.displayName ?? `${languageId} LSP`,
      status,
      source: builtinConfig ? 'builtin' : 'extension',
    };

    store.setServerStatus(languageId, info);
  }

  /**
   * Stop all servers and clean up.
   */
  async destroy(): Promise<void> {
    // Clear all debounce timers
    for (const timer of changeTimers.values()) {
      clearTimeout(timer);
    }
    changeTimers.clear();
    documentVersions.clear();
    this.openDocuments.clear();

    if (this.manager) {
      await this.manager.stopAll();
    }

    useLspStore.getState().clearAll();

    this.manager = null;
    this.invoke = null;
    this.rootUri = null;
    this.initialized = false;
    this.extensionConfigs = [];
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private filePathToUri(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.startsWith('file://')) return normalized;
    return `file:///${normalized.replace(/^\//, '')}`;
  }

  private uriToFilePath(uri: string): string {
    return uri.replace('file:///', '').replace('file://', '');
  }
}

// ── Singleton Export ─────────────────────────────────────────────────────────

export const LspBridge = new LspBridgeImpl();

// Re-export language detection for convenience
export { detectLanguage, detectLspLanguage } from '@hyscode/lsp-client';

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
  fileUriToPath,
  pathToFileUri,
} from '@hyscode/lsp-client';
import type { LspContribution } from '@hyscode/extension-api';
import { useLspStore } from '@/stores/lsp-store';
import type { LspServerInfo } from '@/stores/lsp-store';
import type { LspConnectionStatus, ServerCapabilities } from '@hyscode/lsp-client';
import { useSettingsStore } from '@/stores/settings-store';

type MonacoInstance = typeof import('monaco-editor');
type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriListen = (
  event: string,
  handler: (payload: { payload: string }) => void,
) => Promise<() => void>;

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

/** Untitled buffers have no file on disk and must not be sent to a server. */
function isNonFileDocument(filePath: string): boolean {
  return filePath.startsWith('untitled:');
}

class LspBridgeImpl {
  private manager: LspManager | null = null;
  private invoke: TauriInvoke | null = null;
  private rootUri: string | null = null;
  private monaco: MonacoInstance | null = null;
  private initialized = false;
  private openDocuments = new Set<string>(); // URIs of open documents
  private managedDocuments = new Set<string>();
  private pendingDocuments = new Map<
    string,
    { filePath: string; languageId: string; content: string }
  >();
  private openingDocuments = new Map<string, Promise<void>>();
  private extensionConfigs: LspContribution[] = [];

  /**
   * Initialize the LSP bridge with Tauri IPC functions and workspace root.
   */
  async init(invoke: TauriInvoke, listen: TauriListen, rootPath: string): Promise<void> {
    if (this.initialized) return;

    this.invoke = invoke;
    this.rootUri = pathToFileUri(rootPath);
    console.log('[LspBridge] init rootPath=', rootPath, 'rootUri=', this.rootUri);

    this.manager = new LspManager(invoke, listen);
    this.manager.setRootUri(this.rootUri);
    if (this.monaco) {
      this.manager.setMonaco(this.monaco);
    }

    // Register status change listener → lsp-store
    this.manager.onStatusChange((languageId, status, capabilities) => {
      this.updateStoreStatus(languageId, status, capabilities);
    });

    // Register built-in server configs
    const customPaths = useSettingsStore.getState().lspCustomBinaryPaths;
    for (const server of BUILTIN_SERVERS) {
      const store = useLspStore.getState();
      if (store.disabledServers.has(server.id)) continue;
      const customPath = customPaths[server.id];
      let config = customPath ? { ...server, command: customPath } : server;

      // SpectraLang: feed the native settings (CLI path + lint on save) to spectra-lsp
      // via the LSP initialize request so the server's toolchain integration is live.
      if (server.id === 'builtin-spectra') {
        const settings = useSettingsStore.getState();
        config = {
          ...config,
          initializationOptions: {
            spectra: {
              cliPath: settings.spectraCliPath || 'spectralang',
              lintOnSave: settings.spectraLintOnSave,
            },
          },
        };
      }

      this.manager.registerServerConfig(config);
    }

    // Register any extension configs that arrived before init
    for (const config of this.extensionConfigs) {
      this.manager.registerServerConfig(config);
    }

    this.initialized = true;
    this.flushPendingDocuments();

    // Probe servers in background
    this.probeAllServers();
  }

  /**
   * Set the Monaco editor instance. Must be called when Monaco mounts.
   */
  setMonaco(monaco: MonacoInstance): void {
    this.monaco = monaco;
    // Register all languages for universal syntax highlighting
    registerAllLanguages(monaco);

    if (this.manager) {
      this.manager.setMonaco(monaco);
      this.flushPendingDocuments();
    }
  }

  /**
   * Called when a file is opened in the editor.
   * Starts the appropriate LSP server (if available) and sends didOpen.
   */
  async onFileOpened(filePath: string, languageId: string, content: string): Promise<void> {
    if (isNonFileDocument(filePath)) return;

    const uri = this.filePathToUri(filePath);

    // Track open document
    this.openDocuments.add(uri);
    this.pendingDocuments.set(uri, { filePath, languageId, content });

    if (!this.manager || !this.initialized) return;
    await this.openPendingDocument(uri);
  }

  private async openPendingDocument(uri: string): Promise<void> {
    const existing = this.openingDocuments.get(uri);
    if (existing) {
      await existing;
      return;
    }

    const opening = this.deliverPendingDocument(uri);
    this.openingDocuments.set(uri, opening);
    try {
      await opening;
    } finally {
      if (this.openingDocuments.get(uri) === opening) {
        this.openingDocuments.delete(uri);
      }
    }
  }

  private async deliverPendingDocument(uri: string): Promise<void> {
    const initial = this.pendingDocuments.get(uri);
    const manager = this.manager;
    if (!initial || !manager || !this.openDocuments.has(uri)) return;

    if (!manager.hasServer(initial.languageId)) {
      this.pendingDocuments.delete(uri);
      return;
    }

    // Ensure the language server is running
    await manager.onLanguageOpened(initial.languageId, initial.filePath);

    // A tab can close while the server is starting. Balance the manager's
    // document count if startup completed after that close notification.
    if (!this.openDocuments.has(uri)) {
      if (manager.getConnection(initial.languageId)) {
        await manager.onLanguageClosed(initial.languageId);
      }
      this.pendingDocuments.delete(uri);
      return;
    }

    // Send textDocument/didOpen
    const current = this.pendingDocuments.get(uri);
    if (!current) return;
    const connection = manager.getConnection(current.languageId);
    if (connection && connection.status === 'ready') {
      const version = getNextVersion(uri);
      this.managedDocuments.add(uri);
      connection.didOpen(uri, current.languageId, version, current.content);
      this.pendingDocuments.delete(uri);
    }
  }

  private flushPendingDocuments(): void {
    for (const uri of this.pendingDocuments.keys()) {
      void (async () => {
        const opening = this.openingDocuments.get(uri);
        if (opening) await opening;
        if (this.pendingDocuments.has(uri)) {
          await this.openPendingDocument(uri);
        }
      })().catch((error: unknown) => {
        console.error(`[LspBridge] Failed to resume pending document ${uri}:`, error);
      });
    }
  }

  /**
   * Called when file content changes in the editor.
   * Debounced to avoid flooding the server.
   */
  onFileChanged(filePath: string, languageId: string, content: string): void {
    if (!this.manager || !this.initialized || isNonFileDocument(filePath)) return;

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
    if (!this.manager || !this.initialized || isNonFileDocument(filePath)) return;

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
    if (isNonFileDocument(filePath)) return;

    const uri = this.filePathToUri(filePath);

    // Guard against duplicate close notifications (two effects can fire for the same doc)
    if (!this.openDocuments.has(uri)) return;

    const managerCountTracked = this.managedDocuments.delete(uri);
    this.pendingDocuments.delete(uri);

    // Send textDocument/didClose
    const manager = this.manager;
    const connection = manager?.getConnection(languageId);
    if (managerCountTracked && connection && connection.status === 'ready') {
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
    if (managerCountTracked && manager) {
      await manager.onLanguageClosed(languageId);
    }
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
   * Update the Zustand store with server status changes and publish the
   * server capabilities once the server reports `ready`.
   */
  private updateStoreStatus(
    languageId: string,
    status: LspConnectionStatus,
    capabilities?: ServerCapabilities,
  ): void {
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

    if (status === 'ready') {
      const resolved = capabilities ?? this.manager?.getCapabilities(languageId) ?? undefined;
      if (resolved) {
        store.setServerCapabilities(languageId, resolved);
      }
    }
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
    this.managedDocuments.clear();
    this.pendingDocuments.clear();
    this.openingDocuments.clear();

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
    return pathToFileUri(filePath);
  }

  private uriToFilePath(uri: string): string {
    return fileUriToPath(uri);
  }
}

// ── Singleton Export ─────────────────────────────────────────────────────────

export const LspBridge = new LspBridgeImpl();

// Re-export language detection for convenience
export { detectLanguage, detectLspLanguage } from '@hyscode/lsp-client';

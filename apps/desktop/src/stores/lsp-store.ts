// ─── LSP Store ───────────────────────────────────────────────────────────────
// Zustand store tracking language server statuses, probe results, and settings.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { LspConnectionStatus } from '@hyscode/lsp-client';

export interface LspServerInfo {
  serverId: string;
  languageId: string;
  displayName: string;
  status: LspConnectionStatus;
  source: 'builtin' | 'extension';
  extensionName?: string;
}

interface LspState {
  /** Status of each active language server, keyed by languageId */
  serverStatuses: Record<string, LspServerInfo>;

  /** Probe results: command → isInstalled on system PATH */
  probeResults: Record<string, boolean>;

  /** Disabled server IDs (user disabled via settings) */
  disabledServers: Set<string>;

  /** Whether initial probe scan has completed */
  probeComplete: boolean;

  /** Language IDs for which the "LSP not installed" banner was dismissed this session */
  dismissedLspNotifications: Set<string>;

  // Actions
  setServerStatus: (languageId: string, info: LspServerInfo) => void;
  removeServer: (languageId: string) => void;
  setProbeResult: (command: string, found: boolean) => void;
  setProbeComplete: (complete: boolean) => void;
  toggleServer: (serverId: string, enabled: boolean) => void;
  dismissLspNotification: (languageId: string) => void;
  clearAll: () => void;
}

export const useLspStore = create<LspState>()(
  immer((set) => ({
    serverStatuses: {},
    probeResults: {},
    disabledServers: new Set(),
    probeComplete: false,
    dismissedLspNotifications: new Set(),

    setServerStatus: (languageId, info) =>
      set((s) => {
        s.serverStatuses[languageId] = info;
      }),

    removeServer: (languageId) =>
      set((s) => {
        delete s.serverStatuses[languageId];
      }),

    setProbeResult: (command, found) =>
      set((s) => {
        s.probeResults[command] = found;
      }),

    setProbeComplete: (complete) =>
      set((s) => {
        s.probeComplete = complete;
      }),

    toggleServer: (serverId, enabled) =>
      set((s) => {
        if (enabled) {
          s.disabledServers.delete(serverId);
        } else {
          s.disabledServers.add(serverId);
        }
      }),

    dismissLspNotification: (languageId) =>
      set((s) => {
        s.dismissedLspNotifications.add(languageId);
      }),

    clearAll: () =>
      set((s) => {
        s.serverStatuses = {};
        s.probeResults = {};
        s.probeComplete = false;
      }),
  })),
);

/**
 * Extension UI Store
 *
 * Holds all dynamic UI contributions from extensions:
 * context menu items, formatters, status bar items, panels, toolbar actions.
 * Components subscribe to this store to render extension-contributed UI.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  Disposable,
  ExtensionContextMenuItem,
  DocumentFormatter,
  ExtensionStatusBarItem,
  ExtensionPanel,
  ExtensionToolbarAction,
  SettingsTabContent,
} from '@hyscode/extension-api';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExtensionNotification {
  id: string;
  type: 'info' | 'warning' | 'error';
  message: string;
  title?: string;
}

interface RegisteredItem<T> {
  extensionName: string;
  item: T;
}

interface ExtensionUiState {
  contextMenuItems: RegisteredItem<ExtensionContextMenuItem>[];
  formatters: RegisteredItem<DocumentFormatter>[];
  statusBarItems: RegisteredItem<ExtensionStatusBarItem>[];
  panels: RegisteredItem<ExtensionPanel>[];
  toolbarActions: RegisteredItem<ExtensionToolbarAction>[];
  /** Settings tab content pushed by extensions at runtime. Key = tabId. */
  settingsTabContents: Record<string, SettingsTabContent>;

  /** Quick-pick state (only one at a time) */
  quickPick: {
    visible: boolean;
    items: Array<{ label: string; description?: string; detail?: string; value?: string; icon?: string }>;
    title?: string;
    placeholder?: string;
    resolve?: (item: { label: string; value?: string } | undefined) => void;
  };

  /** Input box state */
  inputBox: {
    visible: boolean;
    title?: string;
    placeholder?: string;
    value?: string;
    prompt?: string;
    resolve?: (value: string | undefined) => void;
  };

  /** Toast notifications from extensions */
  notifications: ExtensionNotification[];

  // ── Mutation helpers (called from extension-loader) ──────────────────────

  addContextMenuItem: (extensionName: string, item: ExtensionContextMenuItem) => Disposable;
  addFormatter: (extensionName: string, formatter: DocumentFormatter) => Disposable;
  addStatusBarItem: (extensionName: string, item: ExtensionStatusBarItem) => Disposable;
  addPanel: (extensionName: string, panel: ExtensionPanel) => Disposable;
  addToolbarAction: (extensionName: string, action: ExtensionToolbarAction) => Disposable;

  /** Push or replace settings tab content for the given tabId. */
  setSettingsTabContent: (tabId: string, content: SettingsTabContent) => void;
  /** Remove all settings tab content registered for a given extension. */
  clearSettingsTabContents: (extensionName: string) => void;

  /** Remove all contributions for a given extension */
  removeAllForExtension: (extensionName: string) => void;

  /** Show quick pick (returns a promise resolved by the UI) */
  showQuickPick: (
    items: Array<{ label: string; description?: string; detail?: string; value?: string; icon?: string }>,
    options?: { title?: string; placeholder?: string },
  ) => Promise<{ label: string; value?: string } | undefined>;

  /** Show input box */
  showInputBox: (options?: {
    title?: string;
    placeholder?: string;
    value?: string;
    prompt?: string;
  }) => Promise<string | undefined>;

  /** Resolve quick pick selection (called from UI) */
  resolveQuickPick: (item: { label: string; value?: string } | undefined) => void;

  /** Resolve input box (called from UI) */
  resolveInputBox: (value: string | undefined) => void;

  /** Show a toast notification, returns its id */
  showNotification: (type: ExtensionNotification['type'], message: string, title?: string) => string;

  /** Dismiss a toast by id */
  dismissNotification: (id: string) => void;

  /** Get formatters matching a language */
  getFormattersForLanguage: (languageId: string) => RegisteredItem<DocumentFormatter>[];
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useExtensionUiStore = create<ExtensionUiState>()(
  immer((set, get) => ({
    contextMenuItems: [],
    formatters: [],
    statusBarItems: [],
    panels: [],
    toolbarActions: [],
    settingsTabContents: {},
    quickPick: { visible: false, items: [] },
    inputBox: { visible: false },
    notifications: [],

    addContextMenuItem: (extensionName, item) => {
      set((s) => {
        s.contextMenuItems.push({ extensionName, item });
      });
      return {
        dispose() {
          set((s) => {
            s.contextMenuItems = s.contextMenuItems.filter(
              (r) => !(r.extensionName === extensionName && r.item.id === item.id),
            );
          });
        },
      };
    },

    addFormatter: (extensionName, formatter) => {
      set((s) => {
        s.formatters.push({ extensionName, item: formatter });
      });
      return {
        dispose() {
          set((s) => {
            s.formatters = s.formatters.filter(
              (r) => !(r.extensionName === extensionName && r.item.id === formatter.id),
            );
          });
        },
      };
    },

    addStatusBarItem: (extensionName, item) => {
      set((s) => {
        s.statusBarItems.push({ extensionName, item });
      });
      return {
        dispose() {
          set((s) => {
            s.statusBarItems = s.statusBarItems.filter(
              (r) => !(r.extensionName === extensionName && r.item.id === item.id),
            );
          });
        },
      };
    },

    addPanel: (extensionName, panel) => {
      set((s) => {
        s.panels.push({ extensionName, item: panel });
      });
      return {
        dispose() {
          set((s) => {
            s.panels = s.panels.filter(
              (r) => !(r.extensionName === extensionName && r.item.id === panel.id),
            );
          });
        },
      };
    },

    addToolbarAction: (extensionName, action) => {
      set((s) => {
        s.toolbarActions.push({ extensionName, item: action });
      });
      return {
        dispose() {
          set((s) => {
            s.toolbarActions = s.toolbarActions.filter(
              (r) => !(r.extensionName === extensionName && r.item.id === action.id),
            );
          });
        },
      };
    },

    removeAllForExtension: (extensionName) => {
      set((s) => {
        s.contextMenuItems = s.contextMenuItems.filter((r) => r.extensionName !== extensionName);
        s.formatters = s.formatters.filter((r) => r.extensionName !== extensionName);
        s.statusBarItems = s.statusBarItems.filter((r) => r.extensionName !== extensionName);
        s.panels = s.panels.filter((r) => r.extensionName !== extensionName);
        s.toolbarActions = s.toolbarActions.filter((r) => r.extensionName !== extensionName);
        // Remove settings tab contents whose tabId starts with `extensionName.`
        const prefix = extensionName + '.';
        for (const tabId of Object.keys(s.settingsTabContents)) {
          if (tabId.startsWith(prefix) || tabId === extensionName) {
            delete s.settingsTabContents[tabId];
          }
        }
      });
    },

    setSettingsTabContent: (tabId, content) => {
      set((s) => {
        s.settingsTabContents[tabId] = content;
      });
    },

    clearSettingsTabContents: (extensionName) => {
      set((s) => {
        const prefix = extensionName + '.';
        for (const tabId of Object.keys(s.settingsTabContents)) {
          if (tabId.startsWith(prefix) || tabId === extensionName) {
            delete s.settingsTabContents[tabId];
          }
        }
      });
    },

    showQuickPick: (items, options) => {
      return new Promise((resolve) => {
        set((s) => {
          s.quickPick = {
            visible: true,
            items,
            title: options?.title,
            placeholder: options?.placeholder,
            resolve: resolve as (item: { label: string; value?: string } | undefined) => void,
          };
        });
      });
    },

    showInputBox: (options) => {
      return new Promise((resolve) => {
        set((s) => {
          s.inputBox = {
            visible: true,
            title: options?.title,
            placeholder: options?.placeholder,
            value: options?.value,
            prompt: options?.prompt,
            resolve,
          };
        });
      });
    },

    resolveQuickPick: (item) => {
      const { resolve } = get().quickPick;
      resolve?.(item);
      set((s) => {
        s.quickPick = { visible: false, items: [], resolve: undefined };
      });
    },

    resolveInputBox: (value) => {
      const { resolve } = get().inputBox;
      resolve?.(value);
      set((s) => {
        s.inputBox = { visible: false, resolve: undefined };
      });
    },

    showNotification: (type, message, title) => {
      const id = Math.random().toString(36).slice(2);
      set((s) => {
        s.notifications.push({ id, type, message, title });
      });
      return id;
    },

    dismissNotification: (id) => {
      set((s) => {
        s.notifications = s.notifications.filter((n) => n.id !== id);
      });
    },

    getFormattersForLanguage: (languageId) => {
      return get().formatters.filter((r) =>
        r.item.languageIds.includes(languageId) || r.item.languageIds.includes('*'),
      );
    },
  })),
);

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ViewerType } from '../lib/utils';

export interface Tab {
  id: string;
  filePath: string;
  fileName: string;
  language: string;
  isDirty: boolean;
  isPinned: boolean;
  isPreview: boolean;
  type: 'file' | 'diff' | 'terminal' | 'commit' | 'history';
  viewerType: ViewerType;
  markdownMode?: 'preview' | 'code';
  diffProps?: {
    filePath: string;
    staged: boolean;
  };
  /** Commit details when type === 'commit' */
  commitProps?: {
    hash: string;
    shortHash: string;
    message: string;
  };
  /** Terminal session id when type === 'terminal' */
  terminalSessionId?: string;
  /** Snapshot details when type === 'history' */
  historyProps?: {
    snapshotId: string;
    originalPath: string;
    timestamp: string;
    content: string;
  };
}

let untitledCounter = 0;

interface EditorState {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: Omit<Tab, 'isDirty' | 'isPinned' | 'isPreview' | 'type' | 'diffProps' | 'viewerType' | 'markdownMode'> & { type?: Tab['type']; diffProps?: Tab['diffProps']; viewerType?: ViewerType; markdownMode?: Tab['markdownMode'] }) => void;
  openUntitled: () => void;
  openTerminalTab: (sessionId: string, name: string) => void;
  openCommitTab: (hash: string, shortHash: string, message: string) => void;
  openHistoryTab: (snapshotId: string, originalPath: string, timestamp: string, content: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToTheRight: (id: string) => void;
  closeSavedTabs: () => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string) => void;
  markDirty: (id: string, dirty: boolean) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  pinTab: (id: string) => void;
  unpinTab: (id: string) => void;
  setMarkdownMode: (id: string, mode: 'preview' | 'code') => void;
}

export const useEditorStore = create<EditorState>()(
  immer((set) => ({
    tabs: [],
    activeTabId: null,

    openTab: (tab) =>
      set((state) => {
        const existing = state.tabs.find((t) => t.id === tab.id);
        if (existing) {
          state.activeTabId = existing.id;
          return;
        }

        // Replace preview tab if exists
        const previewIdx = state.tabs.findIndex((t) => t.isPreview);
        const isFileTab = (tab.type ?? 'file') === 'file';
        const newTab: Tab = {
          ...tab,
          type: tab.type ?? 'file',
          viewerType: tab.viewerType ?? 'code',
          isDirty: false,
          isPinned: false,
          isPreview: isFileTab,
        };

        if (previewIdx >= 0) {
          state.tabs[previewIdx] = newTab;
        } else {
          state.tabs.push(newTab);
        }
        state.activeTabId = tab.id;
      }),

    openUntitled: () =>
      set((state) => {
        untitledCounter++;
        const name = `Untitled-${untitledCounter}`;
        const id = `untitled:${untitledCounter}`;
        const newTab: Tab = {
          id,
          filePath: id,
          fileName: name,
          language: 'plaintext',
          isDirty: false,
          isPinned: false,
          isPreview: false,
          type: 'file',
          viewerType: 'code',
        };
        state.tabs.push(newTab);
        state.activeTabId = id;
      }),

    openTerminalTab: (sessionId: string, name: string) =>
      set((state) => {
        const id = `terminal:${sessionId}`;
        const existing = state.tabs.find((t) => t.id === id);
        if (existing) {
          state.activeTabId = existing.id;
          return;
        }
        const newTab: Tab = {
          id,
          filePath: id,
          fileName: name,
          language: 'plaintext',
          isDirty: false,
          isPinned: false,
          isPreview: false,
          type: 'terminal',
          viewerType: 'code',
          terminalSessionId: sessionId,
        };
        state.tabs.push(newTab);
        state.activeTabId = id;
      }),

    openCommitTab: (hash: string, shortHash: string, message: string) =>
      set((state) => {
        const id = `commit:${hash}`;
        const existing = state.tabs.find((t) => t.id === id);
        if (existing) {
          state.activeTabId = existing.id;
          return;
        }
        const firstLine = message.split('\n')[0] ?? message;
        const label = firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
        const newTab: Tab = {
          id,
          filePath: id,
          fileName: `Commit ${shortHash}`,
          language: 'plaintext',
          isDirty: false,
          isPinned: false,
          isPreview: false,
          type: 'commit',
          viewerType: 'code',
          commitProps: { hash, shortHash, message: label },
        };
        state.tabs.push(newTab);
        state.activeTabId = id;
      }),

    openHistoryTab: (snapshotId: string, originalPath: string, timestamp: string, content: string) =>
      set((state) => {
        const id = `history:${snapshotId}`;
        const existing = state.tabs.find((t) => t.id === id);
        if (existing) {
          state.activeTabId = existing.id;
          return;
        }
        const fileName = originalPath.split(/[\\/]/).pop() ?? originalPath;
        const newTab: Tab = {
          id,
          filePath: id,
          fileName: `${fileName} (snapshot)`,
          language: 'plaintext',
          isDirty: false,
          isPinned: false,
          isPreview: false,
          type: 'history',
          viewerType: 'code',
          historyProps: { snapshotId, originalPath, timestamp, content },
        };
        state.tabs.push(newTab);
        state.activeTabId = id;
      }),

    closeTab: (id) =>
      set((state) => {
        const idx = state.tabs.findIndex((t) => t.id === id);
        if (idx < 0) return;
        const tab = state.tabs[idx];
        state.tabs.splice(idx, 1);
        if (state.activeTabId === id) {
          state.activeTabId = state.tabs[Math.min(idx, state.tabs.length - 1)]?.id ?? null;
        }
        // If closing a terminal tab, also remove the underlying terminal session
        if (tab.type === 'terminal' && tab.terminalSessionId) {
          import('./terminal-store').then((m) => {
            m.useTerminalStore.getState().closeSession(tab.terminalSessionId!);
          });
        }
      }),

    closeAllTabs: () =>
      set((state) => {
        state.tabs = [];
        state.activeTabId = null;
      }),

    closeOtherTabs: (id) =>
      set((state) => {
        state.tabs = state.tabs.filter((t) => t.id === id);
        state.activeTabId = id;
      }),

    closeTabsToTheRight: (id) =>
      set((state) => {
        const idx = state.tabs.findIndex((t) => t.id === id);
        if (idx < 0) return;
        state.tabs = state.tabs.slice(0, idx + 1);
        if (state.activeTabId && !state.tabs.find((t) => t.id === state.activeTabId)) {
          state.activeTabId = id;
        }
      }),

    closeSavedTabs: () =>
      set((state) => {
        state.tabs = state.tabs.filter((t) => t.isDirty);
        if (state.activeTabId && !state.tabs.find((t) => t.id === state.activeTabId)) {
          state.activeTabId = state.tabs[state.tabs.length - 1]?.id ?? null;
        }
      }),

    setActiveTab: (id) =>
      set((state) => {
        state.activeTabId = id;
      }),

    markDirty: (id, dirty) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === id);
        if (tab) {
          tab.isDirty = dirty;
          if (dirty) tab.isPreview = false;
        }
      }),

    reorderTabs: (fromIndex, toIndex) =>
      set((state) => {
        if (fromIndex < 0 || fromIndex >= state.tabs.length) return;
        if (toIndex < 0 || toIndex >= state.tabs.length) return;
        const [moved] = state.tabs.splice(fromIndex, 1);
        state.tabs.splice(toIndex, 0, moved);
      }),

    pinTab: (id) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === id);
        if (tab) {
          tab.isPinned = true;
          tab.isPreview = false;
        }
      }),

    unpinTab: (id) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === id);
        if (tab) {
          tab.isPinned = false;
        }
      }),

    setMarkdownMode: (id, mode) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === id);
        if (tab) tab.markdownMode = mode;
      }),
  })),
);

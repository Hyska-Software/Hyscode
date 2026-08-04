import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { tauriFs } from '../lib/tauri-fs';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useDiagnosticsStore } from './diagnostics-store';

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

interface FsChangePayload {
  kind: string;   // "create" | "modify" | "remove" | "rename"
  paths: string[];
}

interface FileState {
  rootPath: string | null;
  tree: FileNode[];
  fileCache: Map<string, string>;
  externalConflicts: Set<string>;
  showHidden: boolean;
  _watchUnlisten: UnlistenFn | null;
  _refreshTimer: ReturnType<typeof setTimeout> | null;
  _pathIndex: Map<string, FileNode>;
  _parentMap: Map<string, string>;
  setRootPath: (path: string) => void;
  setTree: (tree: FileNode[]) => void;
  toggleExpand: (path: string) => void;
  setFileContent: (path: string, content: string) => void;
  getFileContent: (path: string) => string | undefined;
  clearExternalConflict: (path: string) => void;
  loadDirectory: (path: string) => Promise<FileNode[]>;
  openFolder: (path: string) => Promise<void>;
  expandDirectory: (path: string) => Promise<void>;
  refreshExpandedDirs: () => Promise<void>;
  closeFolder: () => void;
  toggleShowHidden: () => Promise<void>;
  startWatching: () => Promise<void>;
  stopWatching: () => Promise<void>;
  // O(1) lookups (best-effort, rebuilt on full tree updates)
  findNode: (path: string) => FileNode | undefined;
  getParentPath: (path: string) => string | undefined;
}

export type ExternalFileUpdateDecision = 'ignore-agent-edit' | 'mark-conflict' | 'reload' | 'ignore-uncached';

export function decideExternalFileUpdate(input: {
  hasAgentEdit: boolean;
  isDirty: boolean;
  isCached: boolean;
}): ExternalFileUpdateDecision {
  if (input.hasAgentEdit) return 'ignore-agent-edit';
  if (input.isDirty) return 'mark-conflict';
  return input.isCached ? 'reload' : 'ignore-uncached';
}

function entriesToNodes(entries: { name: string; path: string; is_dir: boolean; size: number }[]): FileNode[] {
  return entries.map((e) => ({
    name: e.name,
    path: e.path,
    isDir: e.is_dir,
    size: e.size,
    children: e.is_dir ? [] : undefined,
    isExpanded: false,
    isLoading: false,
  }));
}

function buildIndex(
  nodes: FileNode[],
  pathIndex: Map<string, FileNode>,
  parentMap: Map<string, string>,
  parentPath = ''
) {
  for (const node of nodes) {
    pathIndex.set(node.path, node);
    if (parentPath) parentMap.set(node.path, parentPath);
    if (node.children) {
      buildIndex(node.children, pathIndex, parentMap, node.path);
    }
  }
}

function rebuildIndex(state: { tree: FileNode[]; _pathIndex: Map<string, FileNode>; _parentMap: Map<string, string> }) {
  state._pathIndex.clear();
  state._parentMap.clear();
  buildIndex(state.tree, state._pathIndex, state._parentMap);
}

function findNodeInTree(nodes: FileNode[], path: string): FileNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

function getParentPathFromTree(nodes: FileNode[], path: string, parentPath = ''): string | undefined {
  for (const node of nodes) {
    if (node.path === path) return parentPath || undefined;
    if (node.children) {
      const found = getParentPathFromTree(node.children, path, node.path);
      if (found) return found;
    }
  }
  return undefined;
}

let folderLoadGeneration = 0;

export const useFileStore = create<FileState>()(
  immer((set, get) => ({
    rootPath: null,
    tree: [],
    fileCache: new Map(),
    externalConflicts: new Set(),
    showHidden: (() => {
      try { return localStorage.getItem('hscode-show-hidden') === 'true'; } catch { return false; }
    })(),
    _watchUnlisten: null,
    _refreshTimer: null,
    _pathIndex: new Map(),
    _parentMap: new Map(),

    setRootPath: (path) =>
      set((state) => {
        folderLoadGeneration += 1;
        state.rootPath = path;
        state.tree = [];
        state.fileCache.clear();
        state.externalConflicts.clear();
        state._pathIndex.clear();
        state._parentMap.clear();
      }),

    setTree: (tree) =>
      set((state) => {
        state.tree = tree;
        rebuildIndex(state);
      }),

    toggleExpand: (path) =>
      set((state) => {
        const findAndToggle = (nodes: FileNode[]): boolean => {
          for (const node of nodes) {
            if (node.path === path) {
              node.isExpanded = !node.isExpanded;
              return true;
            }
            if (node.children && findAndToggle(node.children)) return true;
          }
          return false;
        };
        findAndToggle(state.tree);
        rebuildIndex(state);
      }),

    setFileContent: (path, content) =>
      set((state) => {
        state.fileCache.set(path, content);
      }),

    getFileContent: (path) => get().fileCache.get(path),
    clearExternalConflict: (path) => set((state) => { state.externalConflicts.delete(path); }),

    loadDirectory: async (path) => {
      const entries = await tauriFs.listDir(path, get().showHidden);
      return entriesToNodes(entries);
    },

    openFolder: async (path) => {
      const requestId = ++folderLoadGeneration;
      await get().stopWatching();
      if (requestId !== folderLoadGeneration) return;
      useDiagnosticsStore.getState().clearAll();

      set((state) => {
        state.rootPath = path;
        state.tree = [];
        state.fileCache.clear();
        state.externalConflicts.clear();
        state._pathIndex.clear();
        state._parentMap.clear();
      });
      const nodes = await get().loadDirectory(path);
      if (requestId !== folderLoadGeneration || get().rootPath !== path) return;
      set((state) => {
        state.tree = nodes;
        rebuildIndex(state);
      });

      await get().startWatching();
      if (requestId !== folderLoadGeneration || get().rootPath !== path) {
        await get().stopWatching();
      }
    },

    closeFolder: () => {
      folderLoadGeneration += 1;
      get().stopWatching();
      useDiagnosticsStore.getState().clearAll();
      set((state) => {
        state.rootPath = null;
        state.tree = [];
        state.fileCache.clear();
        state.externalConflicts.clear();
        state._pathIndex.clear();
        state._parentMap.clear();
      });
    },

    expandDirectory: async (path) => {
      const requestId = folderLoadGeneration;
      const rootPath = get().rootPath;
      if (!rootPath) return;
      set((state) => {
        const markLoading = (nodes: FileNode[]): boolean => {
          for (const n of nodes) {
            if (n.path === path) {
              n.isLoading = true;
              n.isExpanded = true;
              return true;
            }
            if (n.children && markLoading(n.children)) return true;
          }
          return false;
        };
        markLoading(state.tree);
      });

      const children = await get().loadDirectory(path);
      if (requestId !== folderLoadGeneration || get().rootPath !== rootPath) return;

      set((state) => {
        const assignChildren = (nodes: FileNode[]): boolean => {
          for (const n of nodes) {
            if (n.path === path) {
              n.children = children;
              n.isLoading = false;
              return true;
            }
            if (n.children && assignChildren(n.children)) return true;
          }
          return false;
        };
        assignChildren(state.tree);
        rebuildIndex(state);
      });
    },

    refreshExpandedDirs: async () => {
      const { rootPath, loadDirectory } = get();
      if (!rootPath) return;
      const requestId = folderLoadGeneration;

      // Collect all expanded directory paths from current tree
      const expandedPaths: string[] = [];
      const collectExpanded = (nodes: FileNode[]) => {
        for (const n of nodes) {
          if (n.isDir && n.isExpanded) {
            expandedPaths.push(n.path);
            if (n.children) collectExpanded(n.children);
          }
        }
      };
      collectExpanded(get().tree);

      // Refresh root
      const rootNodes = await loadDirectory(rootPath);
      if (requestId !== folderLoadGeneration || get().rootPath !== rootPath) return;
      set((state) => {
        state.tree = rootNodes;
      });

      // Re-expand previously expanded directories
      for (const dirPath of expandedPaths) {
        try {
          const children = await loadDirectory(dirPath);
          if (requestId !== folderLoadGeneration || get().rootPath !== rootPath) return;
          set((state) => {
            const assign = (nodes: FileNode[]): boolean => {
              for (const n of nodes) {
                if (n.path === dirPath) {
                  n.children = children;
                  n.isExpanded = true;
                  n.isLoading = false;
                  return true;
                }
                if (n.children && assign(n.children)) return true;
              }
              return false;
            };
            assign(state.tree);
          });
        } catch {
          // Directory may have been deleted
        }
      }

      // Rebuild index once at the end
      if (requestId !== folderLoadGeneration || get().rootPath !== rootPath) return;
      set((state) => {
        rebuildIndex(state);
      });
    },

    toggleShowHidden: async () => {
      const newVal = !get().showHidden;
      set((state) => { state.showHidden = newVal; });
      try { localStorage.setItem('hscode-show-hidden', String(newVal)); } catch {}
      const { rootPath, openFolder } = get();
      if (rootPath) await openFolder(rootPath);
    },

    findNode: (path) => {
      const fromIndex = get()._pathIndex.get(path);
      if (fromIndex) return fromIndex;
      return findNodeInTree(get().tree, path);
    },

    getParentPath: (path) => {
      const fromIndex = get()._parentMap.get(path);
      if (fromIndex) return fromIndex;
      return getParentPathFromTree(get().tree, path);
    },

    startWatching: async () => {
      const { rootPath } = get();
      if (!rootPath) return;
      const watchedPath = rootPath;
      const watchGeneration = folderLoadGeneration;

      try {
        await tauriFs.watch(rootPath);
      } catch (err) {
        console.warn('[FileStore] Failed to start watcher:', err);
        return;
      }

      if (watchGeneration !== folderLoadGeneration || get().rootPath !== watchedPath) {
        try {
          await tauriFs.unwatch(watchedPath);
        } catch {
          // Ignore stale watcher cleanup failures
        }
        return;
      }

      const unlisten = await listen<FsChangePayload>('fs:changed', (event) => {
        if (watchGeneration !== folderLoadGeneration || get().rootPath !== watchedPath) return;
        const current = get();
        if (current._refreshTimer) {
          clearTimeout(current._refreshTimer);
        }
        const timer = setTimeout(() => {
          if (watchGeneration !== folderLoadGeneration || get().rootPath !== watchedPath) return;
          // For real-time updates, do a smart partial refresh:
          // If it's a simple create/remove in an expanded dir, just refresh that dir.
          // Otherwise, do a full expanded refresh.
          const { refreshExpandedDirs } = get();
          refreshExpandedDirs().catch((err) => {
            console.warn('[FileStore] Refresh failed:', err);
          });
        }, 120);
        (get() as any)._refreshTimer = timer;

        if (event.payload.kind === 'modify') {
          void Promise.all([import('./editor-store'), import('./agent-store')]).then(async ([editorModule, agentModule]) => {
            if (watchGeneration !== folderLoadGeneration || get().rootPath !== watchedPath) return;
            for (const path of event.payload.paths) {
              if (watchGeneration !== folderLoadGeneration || get().rootPath !== watchedPath) return;
              const hasAgentEdit = agentModule.useAgentStore.getState().agentEditSessions.some((session) =>
                session.filePath === path && (session.phase === 'streaming' || session.phase === 'pending_review'),
              );
              const tab = editorModule.useEditorStore.getState().tabs.find((item) => item.filePath === path);
              const decision = decideExternalFileUpdate({
                hasAgentEdit,
                isDirty: tab?.isDirty ?? false,
                isCached: get().fileCache.has(path),
              });
              if (decision === 'ignore-agent-edit' || decision === 'ignore-uncached') continue;
              if (decision === 'mark-conflict') {
                set((state) => { state.externalConflicts.add(path); });
                continue;
              }
              try {
                const content = await tauriFs.readFile(path);
                if (watchGeneration !== folderLoadGeneration || get().rootPath !== watchedPath) return;
                set((state) => {
                  state.fileCache.set(path, content);
                  state.externalConflicts.delete(path);
                });
              } catch {
                // Removed/non-text files are handled by the tree refresh.
              }
            }
          });
        }
      });

      if (watchGeneration !== folderLoadGeneration || get().rootPath !== watchedPath) {
        (unlisten as UnlistenFn)();
        try {
          await tauriFs.unwatch(watchedPath);
        } catch {
          // Ignore stale watcher cleanup failures
        }
        return;
      }

      set((state) => {
        state._watchUnlisten = unlisten as any;
      });
    },

    stopWatching: async () => {
      const state = get();
      if (state._watchUnlisten) {
        (state._watchUnlisten as UnlistenFn)();
        set((s) => { s._watchUnlisten = null; });
      }
      if (state._refreshTimer) {
        clearTimeout(state._refreshTimer);
        set((s) => { s._refreshTimer = null; });
      }
      if (state.rootPath) {
        try {
          await tauriFs.unwatch(state.rootPath);
        } catch {
          // Ignore
        }
      }
    },
  })),
);

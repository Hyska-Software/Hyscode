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

export const useFileStore = create<FileState>()(
  immer((set, get) => ({
    rootPath: null,
    tree: [],
    fileCache: new Map(),
    showHidden: (() => {
      try { return localStorage.getItem('hscode-show-hidden') === 'true'; } catch { return false; }
    })(),
    _watchUnlisten: null,
    _refreshTimer: null,
    _pathIndex: new Map(),
    _parentMap: new Map(),

    setRootPath: (path) =>
      set((state) => {
        state.rootPath = path;
        state.tree = [];
        state.fileCache.clear();
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

    loadDirectory: async (path) => {
      const entries = await tauriFs.listDir(path, get().showHidden);
      return entriesToNodes(entries);
    },

    openFolder: async (path) => {
      await get().stopWatching();
      useDiagnosticsStore.getState().clearAll();

      set((state) => {
        state.rootPath = path;
        state.tree = [];
        state.fileCache.clear();
        state._pathIndex.clear();
        state._parentMap.clear();
      });
      const nodes = await get().loadDirectory(path);
      set((state) => {
        state.tree = nodes;
        rebuildIndex(state);
      });

      await get().startWatching();
    },

    closeFolder: () => {
      get().stopWatching();
      useDiagnosticsStore.getState().clearAll();
      set((state) => {
        state.rootPath = null;
        state.tree = [];
        state.fileCache.clear();
        state._pathIndex.clear();
        state._parentMap.clear();
      });
    },

    expandDirectory: async (path) => {
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
      set((state) => {
        state.tree = rootNodes;
      });

      // Re-expand previously expanded directories
      for (const dirPath of expandedPaths) {
        try {
          const children = await loadDirectory(dirPath);
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

      try {
        await tauriFs.watch(rootPath);
      } catch (err) {
        console.warn('[FileStore] Failed to start watcher:', err);
        return;
      }

      const unlisten = await listen<FsChangePayload>('fs:changed', (_event) => {
        const current = get();
        if (current._refreshTimer) {
          clearTimeout(current._refreshTimer);
        }
        const timer = setTimeout(() => {
          // For real-time updates, do a smart partial refresh:
          // If it's a simple create/remove in an expanded dir, just refresh that dir.
          // Otherwise, do a full expanded refresh.
          const { refreshExpandedDirs } = get();
          refreshExpandedDirs().catch((err) => {
            console.warn('[FileStore] Refresh failed:', err);
          });
        }, 120);
        (get() as any)._refreshTimer = timer;
      });

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

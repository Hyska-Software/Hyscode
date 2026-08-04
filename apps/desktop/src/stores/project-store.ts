import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import { normalizeProjectPath, projectPathKey } from '@/lib/project-path';

export interface RecentProject {
  name: string;
  path: string;
  lastOpened: number;
}

interface ProjectState {
  name: string | null;
  rootPath: string | null;
  isLoading: boolean;
  recentProjects: RecentProject[];
  vortexHiddenProjectPaths: string[];
  openProject: (path: string) => void;
  setLoading: (isLoading: boolean) => void;
  closeProject: () => void;
  removeRecent: (path: string) => void;
  clearRecent: () => void;
  hideFromVortex: (path: string) => void;
  unhideFromVortex: (path: string) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    immer((set) => ({
      name: null,
      rootPath: null,
      isLoading: false,
      recentProjects: [],
      vortexHiddenProjectPaths: [],

      openProject: (path) =>
        set((state) => {
          const normalizedPath = normalizeProjectPath(path);
          const parts = normalizedPath.split('/');
          const projectName = parts[parts.length - 1] || 'project';
          state.name = projectName;
          state.rootPath = normalizedPath;
          state.isLoading = false;

          // Update recent projects, move this to top
          const pathKey = projectPathKey(normalizedPath);
          const filtered = state.recentProjects.filter((p) => projectPathKey(p.path) !== pathKey);
          filtered.unshift({ name: projectName, path: normalizedPath, lastOpened: Date.now() });
          // Keep only 10 recent projects
          state.recentProjects = filtered.slice(0, 10);
          state.vortexHiddenProjectPaths = state.vortexHiddenProjectPaths.filter(
            (hiddenPath) => projectPathKey(hiddenPath) !== pathKey,
          );
        }),

      setLoading: (isLoading) =>
        set((state) => {
          state.isLoading = isLoading;
        }),

      closeProject: () =>
        set((state) => {
          state.name = null;
          state.rootPath = null;
        }),

      removeRecent: (path) =>
        set((state) => {
          const pathKey = projectPathKey(path);
          state.recentProjects = state.recentProjects.filter(
            (project) => projectPathKey(project.path) !== pathKey,
          );
        }),

      clearRecent: () =>
        set((state) => {
          state.recentProjects = [];
        }),

      hideFromVortex: (path) =>
        set((state) => {
          const pathKey = projectPathKey(path);
          if (!state.vortexHiddenProjectPaths.some((hiddenPath) => projectPathKey(hiddenPath) === pathKey)) {
            state.vortexHiddenProjectPaths.push(normalizeProjectPath(path));
          }
        }),

      unhideFromVortex: (path) =>
        set((state) => {
          const pathKey = projectPathKey(path);
          state.vortexHiddenProjectPaths = state.vortexHiddenProjectPaths.filter(
            (hiddenPath) => projectPathKey(hiddenPath) !== pathKey,
          );
        }),
    })),
    {
      name: 'hyscode-project-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        name: state.name,
        rootPath: state.rootPath,
        recentProjects: state.recentProjects,
        vortexHiddenProjectPaths: state.vortexHiddenProjectPaths,
      }),
    },
  ),
);

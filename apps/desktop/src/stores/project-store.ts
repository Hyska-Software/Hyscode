import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';

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
  openProject: (path: string) => void;
  setLoading: (isLoading: boolean) => void;
  closeProject: () => void;
  removeRecent: (path: string) => void;
  clearRecent: () => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    immer((set) => ({
      name: null,
      rootPath: null,
      isLoading: false,
      recentProjects: [],

      openProject: (path) =>
        set((state) => {
          const parts = path.replace(/\\/g, '/').split('/');
          const projectName = parts[parts.length - 1] || 'project';
          state.name = projectName;
          state.rootPath = path;
          state.isLoading = false;

          // Update recent projects, move this to top
          const filtered = state.recentProjects.filter((p) => p.path !== path);
          filtered.unshift({ name: projectName, path, lastOpened: Date.now() });
          // Keep only 10 recent projects
          state.recentProjects = filtered.slice(0, 10);
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
          state.recentProjects = state.recentProjects.filter((p) => p.path !== path);
        }),

      clearRecent: () =>
        set((state) => {
          state.recentProjects = [];
        }),
    })),
    {
      name: 'hyscode-project-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        name: state.name,
        rootPath: state.rootPath,
        recentProjects: state.recentProjects,
      }),
    },
  ),
);

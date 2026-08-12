import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  KanbanTask,
  KanbanTaskArchiveInput,
  KanbanTaskDeleteInput,
  KanbanTaskCommentInput,
  KanbanTaskCreateInput,
  KanbanTaskDelegateInput,
  KanbanTaskMoveInput,
  KanbanTaskMutationResult,
  KanbanTaskToolContext,
  KanbanTaskUpdateInput,
} from '@hyscode/agent-harness';
import {
  kanbanService,
  mapKanbanTask,
  type KanbanChangeListener,
} from '@/lib/kanban-service';
import { kanbanTaskExecutionCoordinator } from '@/lib/task-execution-coordinator';
import { useAgentStore } from '@/stores/agent-store';
import { useSettingsStore } from '@/stores/settings-store';
import type {
  KanbanChangedEventContract,
  KanbanTaskActivityContract,
  KanbanTaskContract,
} from '@/lib/tauri-invoke';

type KanbanStoreState = {
  projectId: string | null;
  boardId: string | null;
  boardRevision: number;
  tasks: KanbanTask[];
  activities: KanbanTaskActivityContract[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;
  loadGeneration: number;
  start: () => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
  refresh: () => Promise<void>;
  loadActivity: (taskId: string) => Promise<void>;
  reset: () => void;
  selectTask: (taskId: string | null) => void;
  createTask: (input: Omit<KanbanTaskCreateInput, 'projectId'>) => Promise<KanbanTask>;
  updateTask: (
    input: Omit<KanbanTaskUpdateInput, 'projectId'>,
  ) => Promise<KanbanTask>;
  moveTask: (input: Omit<KanbanTaskMoveInput, 'projectId'>) => Promise<KanbanTask>;
  archiveTask: (input: Omit<KanbanTaskArchiveInput, 'projectId'>) => Promise<void>;
  deleteTask: (input: Omit<KanbanTaskDeleteInput, 'projectId'>) => Promise<void>;
  addComment: (input: Omit<KanbanTaskCommentInput, 'projectId'>) => Promise<void>;
  cancelTask: (runId: string) => Promise<void>;
  delegateTask: (
    input: Omit<KanbanTaskDelegateInput, 'projectId'>,
  ) => Promise<{ task: KanbanTask; runId: string }>;
};

let unsubscribeEvents: (() => void) | null = null;
let eventStart: Promise<void> | null = null;

function userContext(projectId: string): KanbanTaskToolContext {
  const conversationId = useAgentStore.getState().conversationId ?? 'desktop-kanban-ui';
  const settings = useSettingsStore.getState();
  return {
    projectId,
    conversationId,
    toolCallId: 'desktop-kanban-ui',
    delegationLevel: 0,
    signal: new AbortController().signal,
    providerId: settings.activeProviderId ?? undefined,
    modelId: settings.activeModelId ?? undefined,
    actor: 'user',
  };
}

function replaceTask(tasks: KanbanTask[], next: KanbanTask): void {
  const index = tasks.findIndex((task) => task.id === next.id);
  if (index >= 0) {
    tasks[index] = next;
  } else {
    tasks.push(next);
  }
}

function mapEventTask(event: KanbanChangedEventContract): KanbanTask | null {
  if (event.entity_kind !== 'task') return null;
  const snapshot = event.snapshot as KanbanTaskContract;
  if (!snapshot.id || !snapshot.project_id) return null;
  return mapKanbanTask(snapshot);
}

export const useKanbanStore = create<KanbanStoreState>()(
  immer((set, get) => ({
    projectId: null,
    boardId: null,
    boardRevision: 0,
    tasks: [],
    activities: [],
    selectedTaskId: null,
    isLoading: false,
    error: null,
    loadGeneration: 0,

    start: async () => {
      if (unsubscribeEvents) return;
      if (eventStart) return eventStart;
      const listener: KanbanChangeListener = (event) => {
        const current = useKanbanStore.getState();
        if (current.projectId !== event.project_id) return;
        if (event.board_revision < current.boardRevision) return;
        if (current.boardRevision > 0 && event.board_revision > current.boardRevision + 1) {
          void useKanbanStore.getState().refresh().catch((error: unknown) => {
            set((state) => {
              state.error = error instanceof Error ? error.message : String(error);
            });
          });
          return;
        }

        if (event.entity_kind === 'task_deleted') {
          set((state) => {
            state.boardRevision = event.board_revision;
            state.tasks = state.tasks.filter((task) => task.id !== event.entity_id);
            if (state.selectedTaskId === event.entity_id) {
              state.selectedTaskId = null;
              state.activities = [];
            }
          });
          return;
        }

        const task = mapEventTask(event);
        if (task) {
          set((state) => {
            state.boardRevision = event.board_revision;
            if (task.archivedAt) {
              state.tasks = state.tasks.filter((item) => item.id !== task.id);
              if (state.selectedTaskId === task.id) {
                state.selectedTaskId = null;
                state.activities = [];
              }
            } else {
              replaceTask(state.tasks, task);
            }
          });
          return;
        }

        void useKanbanStore.getState().refresh().catch((error: unknown) => {
          set((state) => {
            state.error = error instanceof Error ? error.message : String(error);
          });
        });
      };
      eventStart = Promise.resolve().then(async () => {
        unsubscribeEvents = kanbanService.subscribe(listener);
        await kanbanService.startEvents();
      });
      try {
        await eventStart;
      } finally {
        eventStart = null;
      }
    },

    loadProject: async (projectId) => {
      const generation = get().loadGeneration + 1;
      set((state) => {
        state.projectId = projectId;
        state.boardId = null;
        state.boardRevision = 0;
        state.tasks = [];
        state.selectedTaskId = null;
        state.isLoading = true;
        state.error = null;
        state.loadGeneration = generation;
      });
      try {
        await get().start();
        const snapshot = await kanbanService.listTasks(
          { projectId, limit: 200 },
          userContext(projectId),
        );
        const current = useKanbanStore.getState();
        if (current.projectId !== projectId || current.loadGeneration !== generation) return;
        set((state) => {
          state.boardId = snapshot.boardId;
          state.boardRevision = snapshot.boardRevision;
          state.tasks = snapshot.tasks;
          state.isLoading = false;
        });
      } catch (error) {
        if (useKanbanStore.getState().loadGeneration !== generation) return;
        set((state) => {
          state.isLoading = false;
          state.error = error instanceof Error ? error.message : String(error);
        });
      }
    },

    refresh: async () => {
      const projectId = get().projectId;
      if (!projectId) return;
      const snapshot = await kanbanService.listTasks(
        { projectId, boardId: get().boardId ?? undefined, limit: 200 },
        userContext(projectId),
      );
      const current = useKanbanStore.getState();
      if (current.projectId !== projectId) return;
      set((state) => {
        state.boardId = snapshot.boardId;
        state.boardRevision = Math.max(state.boardRevision, snapshot.boardRevision);
        state.tasks = snapshot.tasks;
        state.error = null;
      });
    },

    loadActivity: async (taskId) => {
      const projectId = get().projectId;
      if (!projectId) return;
      const activities = await kanbanService.listActivity(projectId, taskId);
      const current = useKanbanStore.getState();
      if (current.projectId !== projectId || current.selectedTaskId !== taskId) return;
      set((state) => {
        state.activities = activities;
      });
    },

    reset: () => {
      set((state) => {
        state.projectId = null;
        state.boardId = null;
        state.boardRevision = 0;
        state.tasks = [];
        state.activities = [];
        state.selectedTaskId = null;
        state.isLoading = false;
        state.error = null;
        state.loadGeneration += 1;
      });
    },

    selectTask: (taskId) =>
      set((state) => {
        state.selectedTaskId = taskId;
      }),

    createTask: async (input) => {
      const projectId = get().projectId;
      if (!projectId) throw new Error('Open a project before creating a Kanban task.');
      const result = await kanbanService.createTask(
        { ...input, projectId },
        userContext(projectId),
      );
      set((state) => {
        state.boardId = result.task.boardId;
        state.boardRevision = result.boardRevision;
        replaceTask(state.tasks, result.task);
      });
      return result.task;
    },

    updateTask: async (input) => {
      const projectId = get().projectId;
      if (!projectId) throw new Error('Open a project before updating a Kanban task.');
      let result: KanbanTaskMutationResult;
      try {
        result = await kanbanService.updateTask(
          { ...input, projectId },
          userContext(projectId),
        );
      } catch (error) {
        await get().refresh().catch(() => undefined);
        throw error;
      }
      set((state) => {
        state.boardRevision = Math.max(state.boardRevision, result.boardRevision);
        replaceTask(state.tasks, result.task);
      });
      return result.task;
    },

    moveTask: async (input) => {
      const projectId = get().projectId;
      if (!projectId) throw new Error('Open a project before moving a Kanban task.');
      let result: KanbanTaskMutationResult;
      try {
        result = await kanbanService.moveTask(
          { ...input, projectId },
          userContext(projectId),
        );
      } catch (error) {
        await get().refresh().catch(() => undefined);
        throw error;
      }
      set((state) => {
        state.boardRevision = Math.max(state.boardRevision, result.boardRevision);
        replaceTask(state.tasks, result.task);
      });
      return result.task;
    },

    archiveTask: async (input) => {
      const projectId = get().projectId;
      if (!projectId) throw new Error('Open a project before archiving a Kanban task.');
      let result: KanbanTaskMutationResult;
      try {
        result = await kanbanService.archiveTask(
          { ...input, projectId },
          userContext(projectId),
        );
      } catch (error) {
        await get().refresh().catch(() => undefined);
        throw error;
      }
      set((state) => {
        state.boardRevision = Math.max(state.boardRevision, result.boardRevision);
        state.tasks = state.tasks.filter((task) => task.id !== result.task.id);
        if (state.selectedTaskId === result.task.id) {
          state.selectedTaskId = null;
          state.activities = [];
        }
      });
    },

    deleteTask: async (input) => {
      const projectId = get().projectId;
      if (!projectId) throw new Error('Open a project before deleting a Kanban task.');
      let result: KanbanTaskMutationResult;
      try {
        result = await kanbanService.deleteTask(
          { ...input, projectId },
          userContext(projectId),
        );
      } catch (error) {
        await get().refresh().catch(() => undefined);
        throw error;
      }
      set((state) => {
        state.boardRevision = Math.max(state.boardRevision, result.boardRevision);
        state.tasks = state.tasks.filter((task) => task.id !== result.task.id);
        if (state.selectedTaskId === result.task.id) {
          state.selectedTaskId = null;
          state.activities = [];
        }
      });
    },

    addComment: async (input) => {
      const projectId = get().projectId;
      if (!projectId) throw new Error('Open a project before commenting on a Kanban task.');
      const result = await kanbanService.addComment(
        { ...input, projectId },
        userContext(projectId),
      );
      set((state) => {
        state.boardRevision = Math.max(state.boardRevision, result.boardRevision);
      });
      await get().loadActivity(input.taskId);
    },

    cancelTask: async (runId) => {
      const projectId = get().projectId;
      if (!projectId) throw new Error('Open a project before cancelling a Kanban task.');
      kanbanTaskExecutionCoordinator.cancelTask(projectId, runId);
      await get().refresh();
    },

    delegateTask: async (input) => {
      const projectId = get().projectId;
      if (!projectId) throw new Error('Open a project before delegating a Kanban task.');
      const result = await kanbanTaskExecutionCoordinator.delegateTask(
        { ...input, projectId },
        userContext(projectId),
      );
      set((state) => {
        state.boardRevision = Math.max(state.boardRevision, result.boardRevision);
        replaceTask(state.tasks, result.task);
      });
      return { task: result.task, runId: result.run.id };
    },
  })),
);

export type { KanbanStoreState };

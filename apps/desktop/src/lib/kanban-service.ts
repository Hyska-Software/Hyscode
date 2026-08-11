import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  KanbanTaskCommentInput,
  KanbanTaskCommentResult,
  KanbanTaskCreateInput,
  KanbanTaskDelegateInput,
  KanbanTaskDelegateResult,
  KanbanTaskGetInput,
  KanbanTaskIntegration,
  KanbanTaskListInput,
  KanbanTaskListResult,
  KanbanTaskMoveInput,
  KanbanTaskArchiveInput,
  KanbanTaskDeleteInput,
  KanbanTaskMutationResult,
  KanbanTaskRunSummary,
  KanbanTaskToolContext,
  KanbanTaskUpdateInput,
  KanbanTask,
} from '@hyscode/agent-harness';
import {
  tauriInvoke,
  type KanbanBoardSnapshotContract,
  type KanbanChangedEventContract,
  type KanbanTaskActivityContract,
  type KanbanTaskContract,
  type KanbanTaskRunContract,
} from './tauri-invoke';

export type KanbanChangeListener = (event: KanbanChangedEventContract) => void;

export function mapKanbanRun(run: KanbanTaskRunContract | null): KanbanTaskRunSummary | null {
  if (!run) return null;
  return {
    id: run.id,
    state: run.state,
    mode: run.mode,
    conversationId: run.conversation_id,
    turnId: run.turn_id,
    providerId: run.provider_id,
    modelId: run.model_id,
    error: run.error,
    instructions: run.instructions,
    summary: run.summary,
    startedAt: run.started_at,
    completedAt: run.completed_at,
  };
}

export function mapKanbanTask(task: KanbanTaskContract): KanbanTask {
  return {
    id: task.id,
    projectId: task.project_id,
    boardId: task.board_id,
    columnId: task.column_id,
    columnKey: task.column_key,
    title: task.title,
    description: task.description,
    priority: task.priority,
    position: task.position,
    dueDate: task.due_date,
    autoTransition: task.auto_transition,
    archivedAt: task.archived_at,
    labels: task.labels,
    version: task.version,
    createdBy: task.created_by,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    activeRun: mapKanbanRun(task.active_run),
    latestRun: mapKanbanRun(task.latest_run),
  };
}

function mapSnapshot(snapshot: KanbanBoardSnapshotContract): KanbanTaskListResult {
  return {
    boardId: snapshot.board_id,
    boardRevision: snapshot.board_revision,
    tasks: snapshot.tasks.map(mapKanbanTask),
  };
}

function actor(context: KanbanTaskToolContext): 'user' | 'agent' | 'system' {
  return context.actor;
}

function taskMutation(
  boardRevision: number,
  task: KanbanTaskContract,
): KanbanTaskMutationResult {
  return { boardRevision, task: mapKanbanTask(task) };
}

export class KanbanService implements KanbanTaskIntegration {
  private unlisten: UnlistenFn | null = null;
  private eventListeners = new Set<KanbanChangeListener>();
  private eventStart: Promise<void> | null = null;

  async startEvents(): Promise<void> {
    if (this.unlisten) return;
    if (this.eventStart) return this.eventStart;
    this.eventStart = listen<KanbanChangedEventContract>('kanban:changed', (event) => {
      for (const listener of this.eventListeners) listener(event.payload);
    })
      .then((unlisten) => {
        this.unlisten = unlisten;
      })
      .finally(() => {
        this.eventStart = null;
      });
    return this.eventStart;
  }

  subscribe(listener: KanbanChangeListener): () => void {
    this.eventListeners.add(listener);
    void this.startEvents().catch((error) => {
      console.warn('[kanban] Failed to subscribe to change events:', error);
    });
    return () => this.eventListeners.delete(listener);
  }

  disposeEvents(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.eventListeners.clear();
  }

  async listTasks(
    input: KanbanTaskListInput,
    _context: KanbanTaskToolContext,
  ): Promise<KanbanTaskListResult> {
    const snapshot = await tauriInvoke('kanban_list_tasks', {
      projectId: input.projectId,
      boardId: input.boardId,
      columnKey: input.columnKey,
      search: input.search,
      limit: input.limit,
    });
    return mapSnapshot(snapshot);
  }

  async getTask(
    input: KanbanTaskGetInput,
    _context: KanbanTaskToolContext,
  ): Promise<KanbanTaskMutationResult> {
    const snapshot = await tauriInvoke('kanban_get_task', {
      projectId: input.projectId,
      taskId: input.taskId,
    });
    if (!snapshot.task) throw new Error('Kanban task was not found.');
    return taskMutation(snapshot.board_revision, snapshot.task);
  }

  async createTask(
    input: KanbanTaskCreateInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskMutationResult> {
    const task = await tauriInvoke('kanban_create_task', {
      projectId: input.projectId,
      boardId: input.boardId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      columnKey: input.columnKey,
      dueDate: input.dueDate,
      labels: input.labels,
      autoTransition: input.autoTransition,
      actor: actor(context),
    });
    return taskMutation(task.board_revision, task.task);
  }

  async updateTask(
    input: KanbanTaskUpdateInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskMutationResult> {
    const task = await tauriInvoke('kanban_update_task', {
      projectId: input.projectId,
      taskId: input.taskId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueDate: typeof input.dueDate === 'string' ? input.dueDate : undefined,
      clearDueDate: input.dueDate === null ? true : undefined,
      labels: input.labels,
      autoTransition: input.autoTransition,
      expectedVersion: input.expectedVersion,
      actor: actor(context),
    });
    return taskMutation(task.board_revision, task.task);
  }

  async moveTask(
    input: KanbanTaskMoveInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskMutationResult> {
    const task = await tauriInvoke('kanban_move_task', {
      projectId: input.projectId,
      taskId: input.taskId,
      columnKey: input.columnKey,
      position: input.position,
      expectedVersion: input.expectedVersion,
      actor: actor(context),
    });
    return taskMutation(task.board_revision, task.task);
  }

  async addComment(
    input: KanbanTaskCommentInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskCommentResult> {
    const activity = await tauriInvoke('kanban_add_comment', {
      projectId: input.projectId,
      taskId: input.taskId,
      body: input.body,
      actor: actor(context),
    });
    const task = await this.getTask(input, context);
    return {
      boardRevision: task.boardRevision,
      task: task.task,
      activityId: activity.id,
    };
  }

  async archiveTask(
    input: KanbanTaskArchiveInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskMutationResult> {
    const task = await tauriInvoke('kanban_archive_task', {
      projectId: input.projectId,
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      actor: actor(context),
    });
    return taskMutation(task.board_revision, task.task);
  }

  async deleteTask(
    input: KanbanTaskDeleteInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskMutationResult> {
    const task = await tauriInvoke('kanban_delete_task', {
      projectId: input.projectId,
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      actor: actor(context),
    });
    return taskMutation(task.board_revision, task.task);
  }

  async delegateTask(
    input: KanbanTaskDelegateInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskDelegateResult> {
    const run = await tauriInvoke('kanban_create_task_run', {
      projectId: input.projectId,
      taskId: input.taskId,
      mode: input.mode,
      instructions: input.instructions,
      providerId: context.providerId,
      modelId: context.modelId,
      actor: actor(context),
    });
    const task = await this.getTask(input, context);
    return {
      boardRevision: task.boardRevision,
      task: task.task,
      run: mapKanbanRun(run)!,
    };
  }

  async listActivity(
    projectId: string,
    taskId: string,
    limit = 100,
  ): Promise<KanbanTaskActivityContract[]> {
    return tauriInvoke('kanban_list_task_activity', { projectId, taskId, limit });
  }

  async updateTaskRun(input: {
    projectId: string;
    runId: string;
    stateName: KanbanTaskRunContract['state'];
    conversationId?: string;
    turnId?: string;
    summary?: string;
    error?: string;
  }): Promise<KanbanTaskRunContract> {
    return tauriInvoke('kanban_update_task_run', {
      ...input,
      actor: 'agent',
    });
  }
}

export const kanbanService = new KanbanService();

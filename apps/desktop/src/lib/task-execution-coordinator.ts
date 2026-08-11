import type {
  KanbanTask,
  KanbanTaskDelegateInput,
  KanbanTaskDelegateResult,
  KanbanTaskIntegration,
  KanbanTaskRunSummary,
  KanbanTaskToolContext,
} from '@hyscode/agent-harness';
import { kanbanService, mapKanbanRun } from './kanban-service';

export type TaskExecutionRequest = {
  task: KanbanTask;
  run: KanbanTaskRunSummary;
  instructions: string;
};

export type TaskExecutionResult = {
  conversationId: string | null;
  turnId?: string | null;
  summary?: string;
};

export type TaskExecutionTarget = {
  prepare?(request: TaskExecutionRequest, context: KanbanTaskToolContext): Promise<void>;
  run(request: TaskExecutionRequest, context: KanbanTaskToolContext): Promise<TaskExecutionResult>;
  cancel?(): void;
};

export type DedicatedTaskRunner = (
  request: TaskExecutionRequest,
  context: KanbanTaskToolContext,
) => Promise<TaskExecutionResult>;

export class TaskExecutionCoordinator {
  private readonly targets = new Map<string, TaskExecutionTarget>();
  private readonly activeRuns = new Map<
    string,
    { target: TaskExecutionTarget; abortController: AbortController }
  >();
  private dedicatedRunner: DedicatedTaskRunner | null = null;
  private dedicatedCancel: ((runId: string) => void) | null = null;

  constructor(private readonly integration: KanbanTaskIntegration) {}

  registerTarget(conversationId: string, target: TaskExecutionTarget): () => void {
    this.targets.set(conversationId, target);
    return () => {
      if (this.targets.get(conversationId) === target) this.targets.delete(conversationId);
    };
  }

  setDedicatedRunner(runner: DedicatedTaskRunner | null): void {
    this.dedicatedRunner = runner;
  }

  setDedicatedCancelHandler(handler: ((runId: string) => void) | null): void {
    this.dedicatedCancel = handler;
  }

  async updateTaskRunState(
    projectId: string,
    runId: string,
    stateName: 'waiting' | 'running',
  ): Promise<void> {
    await kanbanService.updateTaskRun({ projectId, runId, stateName });
  }

  async delegateTask(
    input: KanbanTaskDelegateInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskDelegateResult> {
    const queued = await this.integration.delegateTask(input, context);
    const target =
      input.mode === 'current_chat'
        ? this.targets.get(context.conversationId)
        : this.dedicatedRunner
          ? {
              run: this.dedicatedRunner,
              cancel: () => this.dedicatedCancel?.(queued.run.id),
            }
          : undefined;

    if (!queued.run.providerId || !queued.run.modelId) {
      const failed = await kanbanService.updateTaskRun({
        projectId: input.projectId,
        runId: queued.run.id,
        stateName: 'failed',
        summary: 'Task could not start because no provider/model is configured.',
        error: 'Configure an active AI provider and model before delegating a Kanban task.',
      });
      const failedRun = mapKanbanRun(failed);
      if (!failedRun) throw new Error('The failed task run could not be read back.');
      return { ...queued, run: failedRun };
    }

    if (!target) {
      const failed = await kanbanService.updateTaskRun({
        projectId: input.projectId,
        runId: queued.run.id,
        stateName: 'failed',
        summary: 'Task was queued but no Desktop runtime is available.',
        error:
          input.mode === 'current_chat'
            ? 'The current chat runtime is not available.'
            : 'The dedicated VORTEX runtime is not available.',
      });
      const failedRun = mapKanbanRun(failed);
      if (!failedRun) throw new Error('The failed task run could not be read back.');
      return { ...queued, run: failedRun };
    }

    const abortController = new AbortController();
    if (context.signal.aborted) abortController.abort(context.signal.reason);
    this.activeRuns.set(queued.run.id, { target, abortController });
    void this.execute(input, { ...context, signal: abortController.signal }, queued, target);
    return queued;
  }

  cancelTask(projectId: string, runId: string): void {
    const active = this.activeRuns.get(runId);
    active?.abortController.abort(new Error('Task execution was cancelled.'));
    active?.target.cancel?.();
    void kanbanService
      .updateTaskRun({
        projectId,
        runId,
        stateName: 'cancelled',
        summary: 'Task cancelled by the user.',
      })
      .catch((error: unknown) => {
        console.warn('[kanban] Failed to persist task cancellation:', error);
      });
  }

  private async execute(
    input: KanbanTaskDelegateInput,
    context: KanbanTaskToolContext,
    queued: KanbanTaskDelegateResult,
    target: TaskExecutionTarget,
  ): Promise<void> {
    try {
      const taskContext: KanbanTaskToolContext = {
        ...context,
        taskContext: {
          taskId: queued.task.id,
          taskRunId: queued.run.id,
          runMode: queued.run.mode,
        },
      };
      const executionRequest: TaskExecutionRequest = {
        task: queued.task,
        run: queued.run,
        instructions: input.instructions?.trim() || queued.task.description || queued.task.title,
      };
      await target.prepare?.(executionRequest, taskContext);
      await kanbanService.updateTaskRun({
        projectId: input.projectId,
        runId: queued.run.id,
        stateName: 'running',
        conversationId: input.mode === 'current_chat' ? context.conversationId : undefined,
      });
      const result = await target.run(executionRequest, taskContext);
      await kanbanService.updateTaskRun({
        projectId: input.projectId,
        runId: queued.run.id,
        stateName: 'completed',
        conversationId: result.conversationId ?? undefined,
        turnId: result.turnId ?? undefined,
        summary: result.summary ?? 'Task completed.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await kanbanService
        .updateTaskRun({
          projectId: input.projectId,
          runId: queued.run.id,
          stateName: 'failed',
          summary: 'Task execution failed.',
          error: message,
        })
        .catch((persistError: unknown) => {
          console.warn('[kanban] Failed to persist task failure:', persistError);
        });
    } finally {
      this.activeRuns.delete(queued.run.id);
    }
  }
}

export const kanbanTaskExecutionCoordinator = new TaskExecutionCoordinator(kanbanService);

export const desktopKanbanHarnessIntegration: KanbanTaskIntegration = {
  listTasks: (input, context) => kanbanService.listTasks(input, context),
  getTask: (input, context) => kanbanService.getTask(input, context),
  createTask: (input, context) => kanbanService.createTask(input, context),
  updateTask: (input, context) => kanbanService.updateTask(input, context),
  moveTask: (input, context) => kanbanService.moveTask(input, context),
  archiveTask: (input, context) => kanbanService.archiveTask(input, context),
  deleteTask: (input, context) => kanbanService.deleteTask(input, context),
  addComment: (input, context) => kanbanService.addComment(input, context),
  delegateTask: (input, context) => kanbanTaskExecutionCoordinator.delegateTask(input, context),
};

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  KanbanTask,
  KanbanTaskDelegateResult,
  KanbanTaskIntegration,
  KanbanTaskToolContext,
} from '@hyscode/agent-harness';

const mocks = vi.hoisted(() => ({
  updateTaskRun: vi.fn(async (input: { stateName: string }) => ({
    id: 'run-1',
    state: input.stateName,
    mode: 'current_chat',
    conversation_id: 'conversation-1',
    turn_id: null,
    provider_id: 'provider-1',
    model_id: 'model-1',
    error: null,
    started_at: null,
    completed_at: null,
    instructions: 'Implement it',
    summary: null,
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
  })),
  mapKanbanRun: vi.fn((run: unknown) => run),
}));

vi.mock('./kanban-service', () => ({
  kanbanService: { updateTaskRun: mocks.updateTaskRun },
  mapKanbanRun: mocks.mapKanbanRun,
}));

import { TaskExecutionCoordinator } from './task-execution-coordinator';

const task: KanbanTask = {
  id: 'task-1',
  projectId: 'project-1',
  boardId: 'board-1',
  columnId: 'column-1',
  columnKey: 'todo',
  title: 'Implement it',
  description: 'Implement it',
  priority: 'medium',
  position: 0,
  dueDate: null,
  autoTransition: true,
  archivedAt: null,
  labels: [],
  version: 1,
  createdBy: 'user',
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
  activeRun: null,
  latestRun: null,
};

function context(): KanbanTaskToolContext {
  return {
    projectId: 'project-1',
    conversationId: 'conversation-1',
    toolCallId: 'call-1',
    delegationLevel: 0,
    signal: new AbortController().signal,
    providerId: 'provider-1',
    modelId: 'model-1',
    actor: 'user',
  };
}

function integration(): KanbanTaskIntegration {
  const run = {
    id: 'run-1',
    state: 'queued' as const,
    mode: 'current_chat' as const,
    conversationId: null,
    turnId: null,
    providerId: 'provider-1',
    modelId: 'model-1',
    error: null,
    instructions: 'Implement it',
    summary: null,
    startedAt: null,
    completedAt: null,
  };
  const result: KanbanTaskDelegateResult = {
    boardRevision: 2,
    task,
    run,
  };
  return {
    listTasks: vi.fn(),
    getTask: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    moveTask: vi.fn(),
    addComment: vi.fn(),
    delegateTask: vi.fn(async () => result),
  } as unknown as KanbanTaskIntegration;
}

describe('TaskExecutionCoordinator', () => {
  beforeEach(() => {
    mocks.updateTaskRun.mockClear();
    mocks.mapKanbanRun.mockClear();
  });

  it('runs a current-chat task through the registered target with task context', async () => {
    const coordinator = new TaskExecutionCoordinator(integration());
    const target = {
      run: vi.fn(async (_request, receivedContext: KanbanTaskToolContext) => {
        expect(receivedContext.taskContext).toEqual({
          taskId: 'task-1',
          taskRunId: 'run-1',
          runMode: 'current_chat',
        });
        return { conversationId: 'conversation-1', turnId: 'turn-1', summary: 'Done' };
      }),
    };
    coordinator.registerTarget('conversation-1', target);

    await coordinator.delegateTask(
      { projectId: 'project-1', taskId: 'task-1', mode: 'current_chat', instructions: 'Implement it' },
      context(),
    );

    await vi.waitFor(() => expect(target.run).toHaveBeenCalledOnce());
    expect(mocks.updateTaskRun.mock.calls.map(([input]) => input.stateName)).toEqual([
      'running',
      'completed',
    ]);
    expect(mocks.updateTaskRun.mock.calls[1]?.[0]).toMatchObject({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      summary: 'Done',
    });
  });

  it('fails a queued run when no Desktop target is available', async () => {
    const coordinator = new TaskExecutionCoordinator(integration());

    const result = await coordinator.delegateTask(
      { projectId: 'project-1', taskId: 'task-1', mode: 'current_chat' },
      context(),
    );

    expect(result.run.state).toBe('failed');
    await vi.waitFor(() => expect(mocks.updateTaskRun).toHaveBeenCalled());
    expect(mocks.updateTaskRun.mock.calls[0]?.[0]).toMatchObject({
      stateName: 'failed',
      error: 'The current chat runtime is not available.',
    });
  });
});

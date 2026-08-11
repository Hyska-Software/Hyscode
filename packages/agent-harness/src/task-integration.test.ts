import { describe, expect, it, vi } from 'vitest';
import { getAllBuiltinTools } from './tools';
import type { ToolExecutionContext } from './types';
import {
  createKanbanTools,
  type KanbanTask,
  type KanbanTaskIntegration,
  type KanbanTaskRunSummary,
} from './task-integration';

const run: KanbanTaskRunSummary = {
  id: 'run-1',
  state: 'queued',
  mode: 'dedicated_session',
  conversationId: null,
  turnId: null,
  providerId: 'provider-1',
  modelId: 'model-1',
  error: null,
  instructions: 'Run the task',
  summary: null,
  startedAt: null,
  completedAt: null,
};

const task: KanbanTask = {
  id: 'task-1',
  projectId: 'project-1',
  boardId: 'board-1',
  columnId: 'column-1',
  columnKey: 'todo',
  title: 'Implement the task board',
  description: '',
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

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    workspacePath: 'C:\\workspace',
    conversationId: 'conversation-1',
    toolCallId: 'call-1',
    signal: new AbortController().signal,
    projectId: 'project-1',
    invoke: vi.fn(),
    ...overrides,
  };
}

function integration(): KanbanTaskIntegration {
  return {
    listTasks: vi.fn(async () => ({ boardId: 'board-1', boardRevision: 3, tasks: [task] })),
    getTask: vi.fn(async () => ({ boardRevision: 3, task })),
    createTask: vi.fn(async () => ({ boardRevision: 4, task })),
    updateTask: vi.fn(async () => ({ boardRevision: 5, task })),
    moveTask: vi.fn(async () => ({ boardRevision: 6, task })),
    archiveTask: vi.fn(async () => ({ boardRevision: 7, task })),
    deleteTask: vi.fn(async () => ({ boardRevision: 8, task })),
    addComment: vi.fn(async () => ({ boardRevision: 9, activityId: 'activity-1', task })),
    delegateTask: vi.fn(async () => ({ boardRevision: 10, task, run })),
  };
}

describe('Desktop Kanban harness integration', () => {
  it('keeps Kanban tools out of the default built-in catalog', () => {
    const names = getAllBuiltinTools().map((tool) => tool.definition.name);

    expect(names.some((name) => name.startsWith('kanban_'))).toBe(false);
  });

  it('creates read and mutation tools with the expected approval boundary', () => {
    const tools = createKanbanTools(integration());
    const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));

    expect(byName.get('kanban_list_tasks')?.requiresApproval).toBe(false);
    expect(byName.get('kanban_get_task')?.requiresApproval).toBe(false);
    expect(byName.get('kanban_create_task')?.requiresApproval).toBe(true);
    expect(byName.get('kanban_update_task')?.requiresApproval).toBe(true);
    expect(byName.get('kanban_move_task')?.requiresApproval).toBe(true);
    expect(byName.get('kanban_archive_task')?.requiresApproval).toBe(true);
    expect(byName.get('kanban_delete_task')?.requiresApproval).toBe(true);
    expect(byName.get('kanban_add_comment')?.requiresApproval).toBe(true);
    expect(byName.get('kanban_delegate_task')?.requiresApproval).toBe(true);
  });

  it('scopes every tool call to the current project', async () => {
    const adapter = integration();
    const list = createKanbanTools(adapter).find(
      (tool) => tool.definition.name === 'kanban_list_tasks',
    );
    const result = await list!.execute({ project_id: 'other-project' }, context());

    expect(result.success).toBe(false);
    expect(result.error).toContain('current project');
    expect(adapter.listTasks).not.toHaveBeenCalled();
  });

  it('passes the current project and task context to the adapter', async () => {
    const adapter = integration();
    const list = createKanbanTools(adapter).find(
      (tool) => tool.definition.name === 'kanban_list_tasks',
    );
    const taskContext = {
      taskId: 'task-1',
      taskRunId: 'run-1',
      runMode: 'dedicated_session' as const,
    };
    const result = await list!.execute({ column_key: 'in_progress', limit: 20 }, context({ taskContext }));

    expect(result.success).toBe(true);
    expect(adapter.listTasks).toHaveBeenCalledWith(
      { projectId: 'project-1', columnKey: 'in_progress', limit: 20 },
      expect.objectContaining({ projectId: 'project-1', taskContext }),
    );
  });

  it('rejects task delegation from nested agents', async () => {
    const adapter = integration();
    const delegate = createKanbanTools(adapter).find(
      (tool) => tool.definition.name === 'kanban_delegate_task',
    );
    const result = await delegate!.execute(
      { task_id: 'task-1' },
      context({ delegationLevel: 1 }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('top-level Desktop agent');
    expect(adapter.delegateTask).not.toHaveBeenCalled();
  });
});

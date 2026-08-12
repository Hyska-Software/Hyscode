// ─── Desktop Kanban integration ────────────────────────────────────────────
// The harness owns the tool contract, while the Desktop owns persistence and
// execution. The integration is optional so the TUI keeps its existing tool
// surface and lifecycle unchanged.

import type {
  AgentTaskContext,
  ToolExecutionContext,
  ToolHandler,
  ToolResult,
} from './types';

export type KanbanTaskColumnKey = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done';
export type KanbanTaskPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type KanbanTaskRunMode = 'current_chat' | 'dedicated_session';
export type KanbanTaskRunState =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type KanbanTaskRunSummary = {
  id: string;
  state: KanbanTaskRunState;
  mode: KanbanTaskRunMode;
  conversationId: string | null;
  turnId: string | null;
  providerId: string | null;
  modelId: string | null;
  error: string | null;
  instructions: string;
  summary: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type KanbanTask = {
  id: string;
  projectId: string;
  boardId: string;
  columnId: string;
  columnKey: KanbanTaskColumnKey;
  title: string;
  description: string;
  priority: KanbanTaskPriority;
  position: number;
  dueDate: string | null;
  autoTransition: boolean;
  archivedAt: string | null;
  labels: string[];
  version: number;
  createdBy: 'user' | 'agent' | 'system';
  createdAt: string;
  updatedAt: string;
  activeRun: KanbanTaskRunSummary | null;
  latestRun: KanbanTaskRunSummary | null;
};

export type KanbanTaskToolContext = {
  projectId: string;
  conversationId: string;
  toolCallId: string;
  delegationLevel: number;
  signal: AbortSignal;
  taskContext?: AgentTaskContext;
  providerId?: string;
  modelId?: string;
  actor: 'user' | 'agent' | 'system';
};

export type KanbanTaskListInput = {
  projectId: string;
  boardId?: string;
  columnKey?: KanbanTaskColumnKey;
  search?: string;
  limit?: number;
};

export type KanbanTaskGetInput = {
  projectId: string;
  taskId: string;
};

export type KanbanTaskCreateInput = {
  projectId: string;
  boardId?: string;
  title: string;
  description?: string;
  priority?: KanbanTaskPriority;
  columnKey?: KanbanTaskColumnKey;
  dueDate?: string;
  autoTransition?: boolean;
  labels?: string[];
};

export type KanbanTaskUpdateInput = {
  projectId: string;
  taskId: string;
  title?: string;
  description?: string;
  priority?: KanbanTaskPriority;
  dueDate?: string | null;
  labels?: string[];
  autoTransition?: boolean;
  expectedVersion?: number;
};

export type KanbanTaskMoveInput = {
  projectId: string;
  taskId: string;
  columnKey: KanbanTaskColumnKey;
  position?: number;
  expectedVersion?: number;
};

export type KanbanTaskArchiveInput = {
  projectId: string;
  taskId: string;
  expectedVersion?: number;
};

export type KanbanTaskDeleteInput = {
  projectId: string;
  taskId: string;
  expectedVersion?: number;
};

export type KanbanTaskCommentInput = {
  projectId: string;
  taskId: string;
  body: string;
};

export type KanbanTaskDelegateInput = {
  projectId: string;
  taskId: string;
  instructions?: string;
  mode?: KanbanTaskRunMode;
};

export type KanbanTaskListResult = {
  boardId: string;
  boardRevision: number;
  tasks: KanbanTask[];
};

export type KanbanTaskMutationResult = {
  boardRevision: number;
  task: KanbanTask;
};

export type KanbanTaskCommentResult = KanbanTaskMutationResult & {
  activityId: string;
};

export type KanbanTaskDelegateResult = KanbanTaskMutationResult & {
  run: KanbanTaskRunSummary;
};

export type KanbanTaskIntegration = {
  listTasks(input: KanbanTaskListInput, context: KanbanTaskToolContext): Promise<KanbanTaskListResult>;
  getTask(input: KanbanTaskGetInput, context: KanbanTaskToolContext): Promise<KanbanTaskMutationResult>;
  createTask(
    input: KanbanTaskCreateInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskMutationResult>;
  updateTask(
    input: KanbanTaskUpdateInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskMutationResult>;
  moveTask(input: KanbanTaskMoveInput, context: KanbanTaskToolContext): Promise<KanbanTaskMutationResult>;
  archiveTask(
    input: KanbanTaskArchiveInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskMutationResult>;
  deleteTask(
    input: KanbanTaskDeleteInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskMutationResult>;
  addComment(
    input: KanbanTaskCommentInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskCommentResult>;
  delegateTask(
    input: KanbanTaskDelegateInput,
    context: KanbanTaskToolContext,
  ): Promise<KanbanTaskDelegateResult>;
};

const COLUMN_KEYS: KanbanTaskColumnKey[] = ['backlog', 'todo', 'in_progress', 'blocked', 'done'];
const PRIORITIES: KanbanTaskPriority[] = ['none', 'low', 'medium', 'high', 'urgent'];
const RUN_MODES: KanbanTaskRunMode[] = ['current_chat', 'dedicated_session'];

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`);
  return value.trim();
}

function optionalNullableString(
  input: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${key} must be a string or null.`);
  return value.trim();
}

function optionalEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${key} must be one of: ${values.join(', ')}.`);
  }
  return value as T;
}

function optionalInteger(
  input: Record<string, unknown>,
  key: string,
  minimum = 0,
): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${key} must be an integer greater than or equal to ${minimum}.`);
  }
  return value;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean.`);
  return value;
}

function optionalStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${key} must be an array of strings.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function projectId(input: Record<string, unknown>, context: KanbanTaskToolContext): string {
  const requested = optionalString(input, 'project_id');
  if (requested && requested !== context.projectId) {
    throw new Error('Kanban tools can only access the current project.');
  }
  if (!context.projectId) throw new Error('The current project is not available.');
  return context.projectId;
}

function toolContext(context: ToolExecutionContext): KanbanTaskToolContext {
  if (!context.projectId) throw new Error('Kanban tools require a project context.');
  return {
    projectId: context.projectId,
    conversationId: context.conversationId,
    toolCallId: context.toolCallId,
    delegationLevel: context.delegationLevel ?? 0,
    signal: context.signal,
    taskContext: context.taskContext,
    providerId: context.providerId,
    modelId: context.modelId,
    actor: 'agent',
  };
}

function success(name: string, value: object): ToolResult {
  return {
    success: true,
    output: JSON.stringify(value, null, 2),
    metadata: { action: name, ...value },
  };
}

function failure(error: unknown): ToolResult {
  return {
    success: false,
    output: '',
    error: error instanceof Error ? error.message : String(error),
  };
}

function kanbanTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  requiresApproval: boolean,
  execute: (input: Record<string, unknown>, context: KanbanTaskToolContext) => Promise<ToolResult>,
): ToolHandler {
  return {
    definition: {
      name,
      description,
      inputSchema: { type: 'object', properties, required },
    },
    category: 'meta',
    requiresApproval,
    riskLevel: requiresApproval ? 'moderate' : 'safe',
    execute: async (input, context) => {
      try {
        return await execute(input, toolContext(context));
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function createKanbanTools(integration: KanbanTaskIntegration): ToolHandler[] {
  return [
    kanbanTool(
      'kanban_list_tasks',
      'List persistent Kanban tasks for the current Desktop project. Use this instead of manage_tasks when the task must survive across conversations.',
      {
        project_id: { type: 'string', description: 'Optional project ID; defaults to the current project.' },
        board_id: { type: 'string' },
        column_key: { type: 'string', enum: COLUMN_KEYS },
        search: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      [],
      false,
      async (input, context) => {
        const result = await integration.listTasks(
          {
            projectId: projectId(input, context),
            boardId: optionalString(input, 'board_id'),
            columnKey: optionalEnum(input, 'column_key', COLUMN_KEYS),
            search: optionalString(input, 'search'),
            limit: optionalInteger(input, 'limit', 1),
          },
          context,
        );
        return success('kanban_list_tasks', result);
      },
    ),
    kanbanTool(
      'kanban_get_task',
      'Read one persistent Kanban task and its current agent run state.',
      { task_id: { type: 'string' }, project_id: { type: 'string' } },
      ['task_id'],
      false,
      async (input, context) => {
        const result = await integration.getTask(
          { projectId: projectId(input, context), taskId: requiredString(input, 'task_id') },
          context,
        );
        return success('kanban_get_task', result);
      },
    ),
    kanbanTool(
      'kanban_create_task',
      'Create a persistent Kanban task in the current Desktop project.',
      {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: PRIORITIES },
        column_key: { type: 'string', enum: COLUMN_KEYS },
        due_date: { type: 'string', description: 'ISO-8601 date/time or null.' },
        labels: { type: 'array', items: { type: 'string' } },
        auto_transition: { type: 'boolean' },
        board_id: { type: 'string' },
        project_id: { type: 'string' },
      },
      ['title'],
      true,
      async (input, context) => {
        const result = await integration.createTask(
          {
            projectId: projectId(input, context),
            boardId: optionalString(input, 'board_id'),
            title: requiredString(input, 'title'),
            description: optionalString(input, 'description'),
            priority: optionalEnum(input, 'priority', PRIORITIES),
            columnKey: optionalEnum(input, 'column_key', COLUMN_KEYS),
            dueDate: optionalString(input, 'due_date'),
            labels: optionalStringArray(input, 'labels'),
            autoTransition: optionalBoolean(input, 'auto_transition'),
          },
          context,
        );
        return success('kanban_create_task', result);
      },
    ),
    kanbanTool(
      'kanban_update_task',
      'Update the editable fields of a persistent Kanban task. Use kanban_move_task to change its column.',
      {
        task_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: PRIORITIES },
        due_date: { type: ['string', 'null'] },
        labels: { type: 'array', items: { type: 'string' } },
        auto_transition: { type: 'boolean' },
        expected_version: { type: 'integer', minimum: 1 },
        project_id: { type: 'string' },
      },
      ['task_id'],
      true,
      async (input, context) => {
        const result = await integration.updateTask(
          {
            projectId: projectId(input, context),
            taskId: requiredString(input, 'task_id'),
            title: optionalString(input, 'title'),
            description: optionalString(input, 'description'),
            priority: optionalEnum(input, 'priority', PRIORITIES),
            dueDate: optionalNullableString(input, 'due_date'),
            labels: optionalStringArray(input, 'labels'),
            autoTransition: optionalBoolean(input, 'auto_transition'),
            expectedVersion: optionalInteger(input, 'expected_version', 1),
          },
          context,
        );
        return success('kanban_update_task', result);
      },
    ),
    kanbanTool(
      'kanban_move_task',
      'Move a persistent Kanban task to another column and optionally set its position.',
      {
        task_id: { type: 'string' },
        column_key: { type: 'string', enum: COLUMN_KEYS },
        position: { type: 'integer', minimum: 0 },
        expected_version: { type: 'integer', minimum: 1 },
        project_id: { type: 'string' },
      },
      ['task_id', 'column_key'],
      true,
      async (input, context) => {
        const columnKey = optionalEnum(input, 'column_key', COLUMN_KEYS);
        if (!columnKey) throw new Error('column_key must be provided.');
        const result = await integration.moveTask(
          {
            projectId: projectId(input, context),
            taskId: requiredString(input, 'task_id'),
            columnKey,
            position: optionalInteger(input, 'position'),
            expectedVersion: optionalInteger(input, 'expected_version', 1),
          },
          context,
        );
        return success('kanban_move_task', result);
      },
    ),
    kanbanTool(
      'kanban_archive_task',
      'Archive a persistent Kanban task after its active agent run has stopped.',
      {
        task_id: { type: 'string' },
        expected_version: { type: 'integer', minimum: 1 },
        project_id: { type: 'string' },
      },
      ['task_id'],
      true,
      async (input, context) => {
        const result = await integration.archiveTask(
          {
            projectId: projectId(input, context),
            taskId: requiredString(input, 'task_id'),
            expectedVersion: optionalInteger(input, 'expected_version', 1),
          },
          context,
        );
        return success('kanban_archive_task', result);
      },
    ),
    kanbanTool(
      'kanban_delete_task',
      'Permanently delete a persistent Kanban task and its runs and activity. This cannot be undone.',
      {
        task_id: { type: 'string' },
        expected_version: { type: 'integer', minimum: 1 },
        project_id: { type: 'string' },
      },
      ['task_id'],
      true,
      async (input, context) => {
        const result = await integration.deleteTask(
          {
            projectId: projectId(input, context),
            taskId: requiredString(input, 'task_id'),
            expectedVersion: optionalInteger(input, 'expected_version', 1),
          },
          context,
        );
        return success('kanban_delete_task', result);
      },
    ),
    kanbanTool(
      'kanban_add_comment',
      'Add an activity comment to a persistent Kanban task.',
      { task_id: { type: 'string' }, body: { type: 'string' }, project_id: { type: 'string' } },
      ['task_id', 'body'],
      true,
      async (input, context) => {
        const result = await integration.addComment(
          {
            projectId: projectId(input, context),
            taskId: requiredString(input, 'task_id'),
            body: requiredString(input, 'body'),
          },
          context,
        );
        return success('kanban_add_comment', result);
      },
    ),
    kanbanTool(
      'kanban_delegate_task',
      'Delegate a persistent Kanban task to the Desktop agent. This starts a durable task run and streams progress to the Kanban board and linked agent surfaces.',
      {
        task_id: { type: 'string' },
        instructions: { type: 'string' },
        mode: { type: 'string', enum: RUN_MODES },
        project_id: { type: 'string' },
      },
      ['task_id'],
      true,
      async (input, context) => {
        if (context.delegationLevel > 0 || context.taskContext) {
          return {
            success: false,
            output: '',
            error:
              'kanban_delegate_task is only available to the top-level Desktop agent outside an existing task run. A sub-agent or task run must report delegation recommendations to its parent.',
          };
        }
        const result = await integration.delegateTask(
          {
            projectId: projectId(input, context),
            taskId: requiredString(input, 'task_id'),
            instructions: optionalString(input, 'instructions'),
            mode: optionalEnum(input, 'mode', RUN_MODES),
          },
          context,
        );
        return success('kanban_delegate_task', result);
      },
    ),
  ];
}

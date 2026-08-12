import { describe, expect, it, vi } from 'vitest';
import type { KanbanTaskContract, KanbanTaskRunContract } from './tauri-invoke';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

import { mapKanbanRun, mapKanbanTask } from './kanban-service';

const run: KanbanTaskRunContract = {
  id: 'run-1',
  state: 'completed',
  mode: 'dedicated_session',
  conversation_id: 'conversation-1',
  turn_id: 'turn-1',
  provider_id: 'provider-1',
  model_id: 'model-1',
  error: null,
  instructions: 'Implement the task',
  summary: 'Implemented the task and verified the result.',
  started_at: '2026-08-10T10:00:00.000Z',
  completed_at: '2026-08-10T10:05:00.000Z',
  created_at: '2026-08-10T10:00:00.000Z',
  updated_at: '2026-08-10T10:05:00.000Z',
};

const task: KanbanTaskContract = {
  id: 'task-1',
  project_id: 'project-1',
  board_id: 'board-1',
  column_id: 'column-done',
  column_key: 'done',
  title: 'Implement the task',
  description: 'A completed task.',
  priority: 'high',
  position: 0,
  due_date: null,
  auto_transition: true,
  archived_at: '2026-08-10T10:06:00.000Z',
  labels: ['agent'],
  version: 4,
  created_by: 'user',
  created_at: '2026-08-10T09:00:00.000Z',
  updated_at: '2026-08-10T10:06:00.000Z',
  active_run: null,
  latest_run: run,
};

describe('KanbanService domain mapping', () => {
  it('maps run linkage, instructions, and terminal summary', () => {
    expect(mapKanbanRun(run)).toEqual({
      id: 'run-1',
      state: 'completed',
      mode: 'dedicated_session',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      providerId: 'provider-1',
      modelId: 'model-1',
      error: null,
      instructions: 'Implement the task',
      summary: 'Implemented the task and verified the result.',
      startedAt: '2026-08-10T10:00:00.000Z',
      completedAt: '2026-08-10T10:05:00.000Z',
    });
  });

  it('keeps archived state and the latest terminal run in the task projection', () => {
    expect(mapKanbanTask(task)).toMatchObject({
      id: 'task-1',
      archivedAt: '2026-08-10T10:06:00.000Z',
      latestRun: {
        id: 'run-1',
        state: 'completed',
        conversationId: 'conversation-1',
        summary: 'Implemented the task and verified the result.',
      },
      activeRun: null,
    });
  });
});

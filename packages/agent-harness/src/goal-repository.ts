import type { GoalRepository, GoalState } from './goal-types';

/** Minimal invoke surface shared by the Desktop and TUI goal services. */
export type GoalInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Runtime shape check for goal rows coming back from the database layer. */
export function isGoalState(value: unknown): value is GoalState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { goal?: unknown };
  if (!candidate.goal || typeof candidate.goal !== 'object') return false;
  const goal = candidate.goal as { id?: unknown; conversationId?: unknown; status?: unknown };
  return (
    typeof goal.id === 'string'
    && typeof goal.conversationId === 'string'
    && typeof goal.status === 'string'
  );
}

function parseGoalState(raw: string | null): GoalState | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!isGoalState(parsed)) {
    throw new Error('The persisted goal state has an invalid shape.');
  }
  return parsed;
}

/**
 * Canonical JSON-invoke GoalRepository used by both the Desktop and TUI
 * hosts. Keep transport differences (Tauri `invoke` vs data-store dispatch)
 * at the call site; persistence parsing lives here exactly once.
 */
export function createInvokeGoalRepository(invoke: GoalInvoke): GoalRepository {
  return {
    async load(conversationId: string): Promise<GoalState | null> {
      const raw = await invoke<string | null>('db_goal_load_state', { conversationId });
      return parseGoalState(raw);
    },
    async save(state: GoalState, expectedVersion: number | null): Promise<GoalState> {
      const raw = await invoke<string>('db_goal_save_state', {
        stateJson: JSON.stringify(state),
        expectedVersion,
      });
      const saved = parseGoalState(raw);
      if (!saved) throw new Error('The goal storage layer returned an empty state.');
      return saved;
    },
    async clear(conversationId: string): Promise<void> {
      await invoke('db_goal_clear_state', { conversationId });
    },
  };
}

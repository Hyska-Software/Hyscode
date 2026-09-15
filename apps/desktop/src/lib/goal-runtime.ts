import {
  createDefaultGoalValidator,
  GoalService,
  type GoalChangeEvent,
  type GoalRepository,
  type GoalState,
} from '@hyscode/agent-harness';

export type DesktopGoalInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function parseState(raw: string | null): GoalState | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('goal' in parsed)) {
    throw new Error('The persisted goal state has an invalid shape.');
  }
  return parsed as GoalState;
}

export function createDesktopGoalService(
  invoke: DesktopGoalInvoke,
  onChange?: (event: GoalChangeEvent) => void,
): GoalService {
  const repository: GoalRepository = {
    async load(conversationId: string): Promise<GoalState | null> {
      const raw = await invoke<string | null>('db_goal_load_state', { conversationId });
      return parseState(raw);
    },
    async save(state: GoalState, expectedVersion: number | null): Promise<GoalState> {
      const raw = await invoke<string>('db_goal_save_state', {
        stateJson: JSON.stringify(state),
        expectedVersion,
      });
      return parseState(raw) as GoalState;
    },
    async clear(conversationId: string): Promise<void> {
      await invoke('db_goal_clear_state', { conversationId });
    },
  };
  return new GoalService(repository, onChange, createDefaultGoalValidator(invoke));
}

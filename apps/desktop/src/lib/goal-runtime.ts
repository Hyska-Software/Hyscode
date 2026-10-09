import {
  createDefaultGoalValidator,
  createInvokeGoalRepository,
  GoalService,
  type GoalChangeEvent,
} from '@hyscode/agent-harness';

export type DesktopGoalInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function createDesktopGoalService(
  invoke: DesktopGoalInvoke,
  onChange?: (event: GoalChangeEvent) => void,
): GoalService {
  return new GoalService(
    createInvokeGoalRepository(invoke),
    onChange,
    createDefaultGoalValidator(invoke),
  );
}

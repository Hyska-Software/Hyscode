import { describe, expect, it } from 'vitest';
import { createDesktopGoalService } from './goal-runtime';

describe('Desktop goal persistence adapter', () => {
  it('round-trips goal state and runs deterministic file validation', async () => {
    let persisted: string | null = null;
    const commands: string[] = [];
    const invoke = async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
      commands.push(command);
      if (command === 'db_goal_load_state') return persisted as T;
      if (command === 'db_goal_save_state') {
        const state = JSON.parse(String(args.stateJson)) as { goal: { version: number } };
        const expected = args.expectedVersion as number | null;
        const current = persisted ? (JSON.parse(persisted) as { goal: { version: number } }).goal.version : null;
        if (current !== expected) throw new Error(`version conflict: ${String(expected)} != ${String(current)}`);
        persisted = JSON.stringify(state);
        return persisted as T;
      }
      if (command === 'db_goal_clear_state') {
        persisted = null;
        return undefined as T;
      }
      if (command === 'stat_path') return { exists: true } as T;
      throw new Error(`Unexpected command: ${command}`);
    };
    const service = createDesktopGoalService(invoke);
    const created = await service.createGoal('conversation', 'project', 'Verify the artifact');
    await service.defineCriteria('conversation', [
      { description: 'Artifact exists', kind: 'file_exists', config: { path: 'artifact.txt' } },
    ]);
    const run = await service.startRun('conversation', 'user');
    const decision = await service.finishTurn('conversation', {
      runId: run.id,
      turnId: 'turn-1',
      status: 'complete',
      tokenUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      toolCalls: [],
      durationMs: 10,
      completionRequest: { summary: 'Artifact verified.', turnId: 'turn-1' },
    });

    expect(decision.state.goal.status).toBe('complete');
    expect(decision.state.goal.verification).toBe('verified');
    expect(decision.state.goal.id).toBe(created.goal.id);
    expect(JSON.parse(persisted ?? '{}').goal.objective).toBe('Verify the artifact');
    expect(commands).toContain('stat_path');
  });
});

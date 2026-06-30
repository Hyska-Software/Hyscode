import { describe, expect, it } from 'vitest';
import { SddEngine, type SddDatabase } from './sdd-engine';
import type { SddSession, SddTask, TurnOutcome } from './types';

function memoryDatabase(): SddDatabase {
  const sessions = new Map<string, SddSession>();
  const tasks = new Map<string, SddTask>();
  return {
    createSession: async (session) => { sessions.set(session.id, structuredClone(session)); },
    updateSession: async (id, updates) => {
      const session = sessions.get(id);
      if (!session) throw new Error('missing session');
      sessions.set(id, { ...session, ...structuredClone(updates) });
    },
    getSession: async (id) => structuredClone(sessions.get(id) ?? null),
    listSessions: async (projectId) => [...sessions.values()].filter((session) => session.projectId === projectId),
    createTask: async (task) => { tasks.set(task.id, structuredClone(task)); },
    updateTask: async (id, updates) => {
      const task = tasks.get(id);
      if (!task) throw new Error('missing task');
      tasks.set(id, { ...task, ...structuredClone(updates) });
    },
    getTasksForSession: async (sessionId) => [...tasks.values()]
      .filter((task) => task.sessionId === sessionId)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((task) => structuredClone(task)),
  };
}

function outcome(response: string): TurnOutcome {
  return {
    turnId: crypto.randomUUID(),
    status: 'complete',
    response,
    toolCalls: [],
    turnRecord: {
      id: crypto.randomUUID(),
      conversationId: 'conversation',
      mode: 'build',
      iterations: 1,
      toolCalls: [],
      tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      stopReason: 'complete',
      verificationPerformed: false,
      verificationForced: false,
      filesModified: [],
      durationMs: 1,
      timestamp: new Date().toISOString(),
    },
  };
}

describe('SddEngine', () => {
  it('executes and reviews a plan exactly once', async () => {
    const responses = [
      outcome('# Spec'),
      outcome('[{"title":"Implement","description":"Do it","files":["a.ts"],"dependencies":[]}]'),
      outcome('implemented'),
      outcome('reviewed'),
    ];
    const engine = new SddEngine({ db: memoryDatabase(), runAgentTurn: async () => responses.shift()! });
    const session = await engine.startSession('project', 'conversation', 'feature');
    await engine.generateSpec(session.id);
    await engine.approveSpec(session.id);
    await engine.generatePlan(session.id);
    await engine.approvePlan(session.id);
    expect(await engine.execute(session.id)).toBe('completed');
    expect(await engine.review(session.id)).toBe('reviewed');
    await expect(engine.review(session.id)).rejects.toThrow('already been reviewed');
    expect(responses).toHaveLength(0);
  });

  it('includes revision feedback when regenerating a specification', async () => {
    let captured = '';
    const engine = new SddEngine({
      db: memoryDatabase(),
      runAgentTurn: async (_system, message) => {
        captured = message;
        return outcome('# Revised');
      },
    });
    const session = await engine.startSession('project', 'conversation', 'feature');
    await engine.generateSpec(session.id, 'Preserve backward compatibility');
    expect(captured).toContain('Revision Feedback');
    expect(captured).toContain('Preserve backward compatibility');
  });

  it('rejects malformed plan task schemas before persisting tasks', async () => {
    const responses = [outcome('# Spec'), outcome('[{"title":"Missing fields"}]')];
    const engine = new SddEngine({ db: memoryDatabase(), runAgentTurn: async () => responses.shift()! });
    const session = await engine.startSession('project', 'conversation', 'feature');
    await engine.generateSpec(session.id);
    await engine.approveSpec(session.id);
    await expect(engine.generatePlan(session.id)).rejects.toThrow('requires a non-empty description');
  });
});

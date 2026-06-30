import { describe, expect, it } from 'vitest';
import type { Message } from '@hyscode/ai-providers';
import { ContextManager } from './context-manager';

describe('ContextManager protocol framing', () => {
  it('always reserves the current user turn before optional context', () => {
    const context = new ContextManager();
    context.addSource({
      id: 'large',
      type: 'context_chip',
      priority: 'high',
      content: 'x'.repeat(20_000),
      tokenEstimate: 5_000,
      origin: 'explicit',
    });
    context.setHistory([
      { role: 'user', content: [{ type: 'text', text: 'old'.repeat(4_000) }] },
      { role: 'assistant', content: [{ type: 'text', text: 'answer'.repeat(4_000) }] },
      { role: 'user', content: [{ type: 'text', text: 'CURRENT REQUEST' }] },
    ]);

    const snapshot = context.buildSnapshot([], 500, 100);
    expect(snapshot.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'CURRENT REQUEST' }]);
    expect(snapshot.entries.find((entry) => entry.id === 'large')).toMatchObject({
      included: false,
      reason: 'budget',
    });
  });

  it('deduplicates a gathered file while its read_file protocol frame is present', () => {
    const context = new ContextManager();
    context.addGatheredFile('src/a.ts', 'const value = 1;', 0.5, 'read');
    context.setHistory([
      { role: 'user', content: [{ type: 'text', text: 'inspect' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', id: 'read-1', name: 'read_file', input: { path: 'src/a.ts' } },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolCallId: 'read-1', output: 'const value = 1;' }],
      },
      { role: 'user', content: [{ type: 'text', text: 'continue' }] },
    ]);

    const snapshot = context.buildSnapshot([], 2_000, 100);
    expect(snapshot.entries.find((entry) => entry.id === 'gathered:src/a.ts')).toMatchObject({
      included: false,
      reason: 'duplicate',
    });
    expect(snapshot.tokenBreakdown.deduplicated).toBeGreaterThan(0);
  });

  it('expires turn-scoped automatic sources', () => {
    const context = new ContextManager();
    context.beginTurn();
    context.addSource({
      id: 'hint',
      type: 'search_results',
      priority: 'low',
      content: 'a.ts',
      tokenEstimate: 1,
      origin: 'automatic',
      expiresAfterTurn: 1,
    });
    context.beginTurn();
    context.setHistory([{ role: 'user', content: [{ type: 'text', text: 'next' }] }]);
    expect(context.buildSnapshot([], 1_000, 100).entries.some((entry) => entry.id === 'hint')).toBe(
      false,
    );
  });

  it('never retains an orphan tool result when truncating history', () => {
    const context = new ContextManager();
    const history: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'start' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'x'.repeat(12_000) },
          { type: 'tool_call', id: 'call-1', name: 'read_file', input: { path: 'a.ts' } },
        ],
      },
      { role: 'tool', content: [{ type: 'tool_result', toolCallId: 'call-1', output: 'ok' }] },
      { role: 'user', content: [{ type: 'text', text: 'continue' }] },
    ];
    context.setHistory(history);
    const snapshot = context.buildSnapshot([], 1_000, 100);
    const roles = snapshot.messages.map((message) => message.role);
    expect(roles[0]).toBe('user');
    expect(roles).not.toContain('tool');
    expect(context.getDroppedMessageCount()).toBeGreaterThan(0);
  });

  it('clears conversation-scoped sources, history, and gathered files', () => {
    const context = new ContextManager();
    context.setHistory([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]);
    context.addSource({
      id: 'file',
      type: 'context_chip',
      priority: 'high',
      content: 'x',
      tokenEstimate: 1,
    });
    context.addGatheredFile('a.ts', 'const a = 1;', 1, 'test');
    context.clearConversationContext();
    expect(context.getHistory()).toEqual([]);
    expect(context.getGatheredFiles()).toEqual([]);
    expect(context.buildSnapshot([], 1_000, 100).messages).toEqual([]);
  });
});

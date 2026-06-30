import { describe, expect, it } from 'vitest';
import type { Message } from '@hyscode/ai-providers';
import { ContextManager } from './context-manager';

describe('ContextManager protocol framing', () => {
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
    context.addSource({ id: 'file', type: 'context_chip', priority: 'high', content: 'x', tokenEstimate: 1 });
    context.addGatheredFile('a.ts', 'const a = 1;', 1, 'test');
    context.clearConversationContext();
    expect(context.getHistory()).toEqual([]);
    expect(context.getGatheredFiles()).toEqual([]);
    expect(context.buildSnapshot([], 1_000, 100).messages).toEqual([]);
  });
});

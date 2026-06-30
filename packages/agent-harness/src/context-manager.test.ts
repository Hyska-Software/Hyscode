import { describe, expect, it } from 'vitest';
import type { Message } from '@hyscode/ai-providers';
import { ContextManager } from './context-manager';

describe('ContextManager protocol framing', () => {
  it('reserves the complete configured output budget', () => {
    const context = new ContextManager();
    context.setHistory([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]);
    const snapshot = context.buildSnapshot([], 32_000, 8_000);
    expect(snapshot.budget.reserved.responseBuffer).toBe(8_000);
    expect(snapshot.budget.available).toBeLessThanOrEqual(24_000);
  });

  it('places volatile context after reusable history and before the current turn', () => {
    const context = new ContextManager();
    context.addSource({ id: 'explicit', type: 'context_chip', priority: 'high', content: 'EXPLICIT', tokenEstimate: 2, origin: 'explicit' });
    context.addSource({ id: 'memory', type: 'context_chip', priority: 'high', content: 'VOLATILE MEMORY', tokenEstimate: 4, origin: 'memory' });
    context.setHistory([
      { role: 'user', content: [{ type: 'text', text: 'OLD USER' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'OLD ANSWER' }] },
    ]);
    context.addMessage({ role: 'user', content: [{ type: 'text', text: 'CURRENT USER' }] });
    const text = context.buildSnapshot([], 32_000, 4_000).messages.map((message) => message.content.map((item) => item.type === 'text' ? item.text : '').join('')).join('|');
    expect(text.indexOf('EXPLICIT')).toBeLessThan(text.indexOf('OLD USER'));
    expect(text.indexOf('OLD ANSWER')).toBeLessThan(text.indexOf('VOLATILE MEMORY'));
    expect(text.indexOf('VOLATILE MEMORY')).toBeLessThan(text.indexOf('CURRENT USER'));
  });

  it('drops environment previews after an authoritative tool result supersedes them', () => {
    const context = new ContextManager();
    context.addSource({
      id: 'env-active-file', type: 'active_file', priority: 'high', content: 'STALE PREVIEW',
      tokenEstimate: 4, origin: 'environment', metadata: { filePath: 'src/a.ts' },
    });
    context.setHistory([]);
    context.addMessage({ role: 'user', content: [{ type: 'text', text: 'inspect a.ts' }] });
    context.addMessage({ role: 'assistant', content: [{ type: 'tool_call', id: 'read', name: 'read_file', input: { path: 'src/a.ts' } }] });
    context.addMessage({ role: 'tool', content: [{ type: 'tool_result', toolCallId: 'read', output: 'fresh content' }] });
    const snapshot = context.buildSnapshot([], 8_000, 1_000);
    expect(snapshot.entries.find((entry) => entry.id === 'env-active-file')).toMatchObject({ included: false, reason: 'superseded' });
  });
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

import { describe, expect, it } from 'vitest';
import type { Message } from '@hyscode/ai-providers';
import { mapPersistedAgentMessage } from './agent-message-persistence';
import { normalizeAgentHistory } from './agent-history';

const assistantToolCall: Message = {
  role: 'assistant',
  content: [
    {
      type: 'tool_call',
      id: 'call-1',
      name: 'read_file',
      input: { path: 'README.md' },
    },
  ],
};

const toolResult: Message = {
  role: 'tool',
  content: [{ type: 'tool_result', toolCallId: 'call-1', output: 'file content' }],
};

describe('agent history protocol safety', () => {
  it('preserves a complete assistant tool-call frame', () => {
    expect(normalizeAgentHistory([{ role: 'user', content: [{ type: 'text', text: 'Read it' }] }, assistantToolCall, toolResult])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Read it' }] },
      assistantToolCall,
      toolResult,
    ]);
  });

  it('removes incomplete tool frames without losing assistant text', () => {
    const incompleteAssistant: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will inspect the file.' },
        ...assistantToolCall.content,
        {
          type: 'tool_call',
          id: 'call-2',
          name: 'list_files',
          input: {},
        },
      ],
    };

    expect(normalizeAgentHistory([incompleteAssistant, toolResult, { role: 'user', content: [{ type: 'text', text: 'Continue' }] }])).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'I will inspect the file.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
    ]);
  });

  it('drops orphan tool results', () => {
    expect(normalizeAgentHistory([toolResult, { role: 'user', content: [{ type: 'text', text: 'Next' }] }])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Next' }] },
    ]);
  });

  it('hydrates persisted tool messages as tool protocol messages', () => {
    expect(
      mapPersistedAgentMessage({
        id: 'message-1',
        role: 'tool',
        content: '',
        tool_calls: null,
        blocks: JSON.stringify(toolResult.content),
        turn_summary: null,
        created_at: '2026-08-11 12:00:00',
      }),
    ).toMatchObject({
      id: 'message-1',
      role: 'tool',
      blocks: toolResult.content,
    });
  });
});

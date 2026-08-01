import { describe, expect, it } from 'vitest';
import { resolveSubAgentState } from './sub-agent-tab';
import type { SubAgentState } from '@/stores/agent-store';

function subAgent(id: string): SubAgentState {
  return {
    id,
    task: 'Review module',
    mode: 'review',
    status: 'done',
    output: 'ok',
    toolCalls: [],
    startedAt: 1,
  };
}

type FakeAgentState = {
  conversationId: string;
  subAgents: SubAgentState[];
  tabStates: Record<string, { subAgents: SubAgentState[] }>;
};

describe('resolveSubAgentState', () => {
  it('finds the sub-agent in the active conversation flat state', () => {
    const state: FakeAgentState = {
      conversationId: 'conv-a',
      subAgents: [subAgent('a1')],
      tabStates: {},
    };

    expect(resolveSubAgentState(state as never, 'conv-a', 'a1')?.id).toBe('a1');
  });

  it('falls back to the cached tab state for inactive conversations', () => {
    const state: FakeAgentState = {
      conversationId: 'conv-b',
      subAgents: [],
      tabStates: { 'conv-a': { subAgents: [subAgent('a1')] } },
    };

    expect(resolveSubAgentState(state as never, 'conv-a', 'a1')?.id).toBe('a1');
    expect(resolveSubAgentState(state as never, 'conv-a', 'missing')).toBeUndefined();
  });

  it('returns undefined when the conversation is gone entirely', () => {
    const state: FakeAgentState = { conversationId: 'conv-b', subAgents: [], tabStates: {} };

    expect(resolveSubAgentState(state as never, 'conv-a', 'a1')).toBeUndefined();
  });
});

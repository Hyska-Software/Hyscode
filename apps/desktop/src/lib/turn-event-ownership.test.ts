import { describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@hyscode/agent-harness';
import { eventBelongsToOwner, type ActiveTurnOwner } from './turn-event-ownership';

const owner: ActiveTurnOwner = {
  tabId: 'tab-a',
  conversationId: 'conversation-a',
  turnId: 'turn-a',
};

describe('eventBelongsToOwner', () => {
  it('accepts an event from the owning turn and tab', () => {
    const event = {
      type: 'turn_start',
      turnId: 'turn-a',
      conversationId: 'conversation-a',
      iteration: 1,
    } satisfies HarnessEvent;
    expect(eventBelongsToOwner(event, owner, 'tab-a')).toBe(true);
  });

  it('rejects stale turn, conversation, and tab identities', () => {
    const base = {
      type: 'stream_chunk',
      chunk: { type: 'text_delta', text: 'late' },
    } as HarnessEvent;
    expect(eventBelongsToOwner({ ...base, turnId: 'turn-b' }, owner, 'tab-a')).toBe(false);
    expect(eventBelongsToOwner({ ...base, conversationId: 'conversation-b' }, owner, 'tab-a')).toBe(
      false,
    );
    expect(eventBelongsToOwner(base, owner, 'tab-b')).toBe(false);
  });
});

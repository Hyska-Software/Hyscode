import { describe, expect, it } from 'vitest';

import type { TerminalSession } from '@/stores/terminal-store';
import { selectAgentSession } from './terminal-session-policy';

function session(overrides: Partial<TerminalSession>): TerminalSession {
  return {
    id: 'term-1',
    name: 'Agent Terminal 1',
    ptyId: null,
    isAgentSession: true,
    location: 'panel',
    cwd: null,
    lastCommand: null,
    commandHistory: [],
    isDead: false,
    ownerConversationId: null,
    activeToolCallId: null,
    awaitingInput: false,
    outputSequence: 0,
    ...overrides,
  };
}

const baseRequest = {
  conversationId: 'conversation-a',
  toolCallId: 'tool-1',
  forceNew: false,
};

describe('selectAgentSession', () => {
  it('reuses a healthy session owned by the same conversation', () => {
    const sessions = [
      session({ id: 'term-a', ownerConversationId: 'conversation-a', ptyId: 'pty-a' }),
      session({ id: 'term-b', ownerConversationId: 'conversation-b', ptyId: 'pty-b' }),
    ];
    expect(selectAgentSession(sessions, baseRequest)?.id).toBe('term-a');
  });

  it('never reuses a session owned by another conversation', () => {
    const sessions = [session({ id: 'term-b', ownerConversationId: 'conversation-b', ptyId: 'pty-b' })];
    expect(selectAgentSession(sessions, baseRequest)).toBeNull();
  });

  it('isolates sub-agents through the owner id', () => {
    const sessions = [session({ id: 'term-a', ownerConversationId: 'conversation-a', ptyId: 'pty-a' })];
    const child = selectAgentSession(sessions, {
      ...baseRequest,
      ownerId: 'sub-agent-1',
    });
    expect(child).toBeNull();
  });

  it('skips dead and PTY-less sessions', () => {
    const sessions = [
      session({ id: 'term-dead', ownerConversationId: 'conversation-a', ptyId: 'pty-a', isDead: true }),
      session({ id: 'term-nopty', ownerConversationId: 'conversation-a', ptyId: null }),
    ];
    expect(selectAgentSession(sessions, baseRequest)).toBeNull();
  });

  it('respects forceNew', () => {
    const sessions = [session({ id: 'term-a', ownerConversationId: 'conversation-a', ptyId: 'pty-a' })];
    expect(selectAgentSession(sessions, { ...baseRequest, forceNew: true })).toBeNull();
  });

  it('returns null while another tool call owns the session', () => {
    const sessions = [
      session({
        id: 'term-a',
        ownerConversationId: 'conversation-a',
        ptyId: 'pty-a',
        activeToolCallId: 'tool-other',
      }),
    ];
    expect(selectAgentSession(sessions, baseRequest)).toBeNull();
    expect(selectAgentSession(sessions, { ...baseRequest, toolCallId: 'tool-other' })?.id).toBe(
      'term-a',
    );
  });

  it('matches a named session within the same conversation', () => {
    const sessions = [
      session({ id: 'term-a', name: 'dev server', ownerConversationId: 'conversation-a', ptyId: 'pty-a' }),
    ];
    expect(selectAgentSession(sessions, { ...baseRequest, sessionName: 'dev server' })?.id).toBe(
      'term-a',
    );
    expect(selectAgentSession(sessions, { ...baseRequest, sessionName: 'other' })).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';

import { canUserWriteToTerminal, useTerminalStore } from './terminal-store';

describe('terminal conversation ownership', () => {
  beforeEach(() => {
    useTerminalStore.setState({ sessions: [], activeSessionId: null, nextIndex: 1 });
  });

  it('creates independent sessions per conversation', () => {
    const firstId = useTerminalStore
      .getState()
      .createAgentSession({ conversationId: 'conversation-a' });
    const secondId = useTerminalStore
      .getState()
      .createAgentSession({ conversationId: 'conversation-b' });

    expect(secondId).not.toBe(firstId);
    expect(useTerminalStore.getState().sessions).toHaveLength(2);
  });

  it('retains a dead PTY id so buffered output remains readable', () => {
    const sessionId = useTerminalStore.getState().createAgentSession();
    useTerminalStore.getState().setPtyId(sessionId, 'pty-dead');
    useTerminalStore.getState().markPtyDead(sessionId);

    expect(useTerminalStore.getState().sessions[0]).toMatchObject({
      ptyId: 'pty-dead',
      isDead: true,
      activeToolCallId: null,
    });
  });

  it('allows manual input only for waiting agent terminals outside auto-approve', () => {
    const session = {
      isAgentSession: true,
      activeToolCallId: null,
      awaitingInput: true,
    };
    expect(canUserWriteToTerminal(session, 'manual')).toBe(true);
    expect(canUserWriteToTerminal(session, 'smart')).toBe(true);
    expect(canUserWriteToTerminal(session, 'yolo')).toBe(false);
    expect(canUserWriteToTerminal({ ...session, activeToolCallId: 'tool-1' }, 'manual')).toBe(
      false,
    );
  });
});

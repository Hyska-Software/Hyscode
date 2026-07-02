import { beforeEach, describe, expect, it } from 'vitest';

import { canUserWriteToTerminal, useTerminalStore } from './terminal-store';

describe('terminal conversation ownership', () => {
  beforeEach(() => {
    useTerminalStore.setState({ sessions: [], activeSessionId: null, nextIndex: 1 });
  });

  it('never reuses an agent terminal owned by another conversation', () => {
    const firstId = useTerminalStore.getState().ensureAgentSession({
      conversationId: 'conversation-a',
      reuseHealthy: false,
    });
    useTerminalStore.getState().setPtyId(firstId, 'pty-a');

    const secondId = useTerminalStore.getState().ensureAgentSession({
      conversationId: 'conversation-b',
    });

    expect(secondId).not.toBe(firstId);
    expect(useTerminalStore.getState().findHealthyAgentSession('conversation-b')).toBeUndefined();
  });

  it('retains a dead PTY id so buffered output remains readable', () => {
    const sessionId = useTerminalStore.getState().ensureAgentSession({ reuseHealthy: false });
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

import { beforeEach, describe, expect, it } from 'vitest';

import { canUserWriteToTerminal, useTerminalStore } from './terminal-store';

function createUserSession(name?: string) {
  return useTerminalStore.getState().createSession(name);
}

describe('terminal store — user sessions', () => {
  beforeEach(() => {
    useTerminalStore.setState({ sessions: [], activeSessionId: null, nextIndex: 1 });
  });

  it('creates a session with defaults and activates it', () => {
    const id = createUserSession();
    const session = useTerminalStore.getState().sessions[0];
    expect(session).toMatchObject({
      id,
      name: 'Terminal 1',
      ptyId: null,
      isAgentSession: false,
      location: 'panel',
      cwd: null,
      isDead: false,
      activeToolCallId: null,
      awaitingInput: false,
      outputSequence: 0,
    });
    expect(useTerminalStore.getState().activeSessionId).toBe(id);
  });

  it('increments the default name counter', () => {
    createUserSession();
    createUserSession();
    const names = useTerminalStore.getState().sessions.map((s) => s.name);
    expect(names).toEqual(['Terminal 1', 'Terminal 2']);
  });

  it('renames sessions and switches the active session', () => {
    const first = createUserSession();
    const second = createUserSession();
    useTerminalStore.getState().renameSession(first, 'dev server');
    useTerminalStore.getState().setActiveSession(second);

    expect(useTerminalStore.getState().sessions[0].name).toBe('dev server');
    expect(useTerminalStore.getState().activeSessionId).toBe(second);
  });

  it('closes a session and activates the adjacent one', () => {
    const first = createUserSession();
    createUserSession();
    useTerminalStore.getState().closeSession(first);

    const state = useTerminalStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).not.toBe(first);
  });

  it('nulls the active session when the last one closes', () => {
    const id = createUserSession();
    useTerminalStore.getState().closeSession(id);
    const state = useTerminalStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.activeSessionId).toBeNull();
  });

  it('tracks the PTY id and last command', () => {
    const id = createUserSession();
    useTerminalStore.getState().setPtyId(id, 'pty-1');
    useTerminalStore.getState().setLastCommand(id, 'npm test', 'pass', 0, 'user');

    const session = useTerminalStore.getState().sessions[0];
    expect(session.ptyId).toBe('pty-1');
    expect(session.isDead).toBe(false);
    expect(session.lastCommand).toMatchObject({
      command: 'npm test',
      output: 'pass',
      exitCode: 0,
      source: 'user',
    });
  });

  it('caps the rolling command history at 50 entries', () => {
    const id = createUserSession();
    for (let i = 0; i < 60; i++) {
      useTerminalStore
        .getState()
        .appendCommandHistory(id, { command: `cmd ${i}`, output: '', exitCode: 0, timestamp: i, source: 'user' });
    }
    const history = useTerminalStore.getState().sessions[0].commandHistory;
    expect(history).toHaveLength(50);
    expect(history[0].command).toBe('cmd 10');
    expect(history[49].command).toBe('cmd 59');
  });

  it('marks a dead PTY and clears agent activity', () => {
    const id = createUserSession();
    useTerminalStore.getState().setPtyId(id, 'pty-1');
    useTerminalStore.getState().setAgentActivity(id, 'tool-9');
    useTerminalStore.getState().markPtyDead(id);

    expect(useTerminalStore.getState().sessions[0]).toMatchObject({
      ptyId: 'pty-1',
      isDead: true,
      activeToolCallId: null,
      awaitingInput: false,
    });
  });

  it('tracks awaiting input and output sequence monotonically', () => {
    const id = createUserSession();
    useTerminalStore.getState().setAwaitingInput(id, true);
    useTerminalStore.getState().setOutputSequence(id, 5);
    useTerminalStore.getState().setOutputSequence(id, 3);

    const session = useTerminalStore.getState().sessions[0];
    expect(session.awaitingInput).toBe(true);
    expect(session.outputSequence).toBe(5);
  });

  it('removes agent sessions and fixes up the active session', () => {
    const first = createUserSession();
    createUserSession();
    useTerminalStore.getState().setActiveSession(first);
    useTerminalStore.getState().removeAgentSession(first);

    const state = useTerminalStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).not.toBe(first);
  });

  it('clears all project sessions and returns PTYs that require termination', () => {
    const first = createUserSession();
    const second = useTerminalStore.getState().createAgentSession({ conversationId: 'old-project' });
    useTerminalStore.getState().setPtyId(first, 'pty-user');
    useTerminalStore.getState().setPtyId(second, 'pty-agent');

    const ptyIds = useTerminalStore.getState().clearSessions();

    expect(ptyIds).toEqual(['pty-user', 'pty-agent']);
    expect(useTerminalStore.getState().sessions).toEqual([]);
    expect(useTerminalStore.getState().activeSessionId).toBeNull();
    expect(useTerminalStore.getState().nextIndex).toBe(1);
  });
});

describe('terminal store — agent sessions', () => {
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
    const sessions = useTerminalStore.getState().sessions;
    expect(sessions[0].ownerConversationId).toBe('conversation-a');
    expect(sessions[1].ownerConversationId).toBe('conversation-b');
  });

  it('names agent sessions with a counter by default', () => {
    useTerminalStore.getState().createAgentSession();
    useTerminalStore.getState().createAgentSession();
    const names = useTerminalStore.getState().sessions.map((s) => s.name);
    expect(names).toEqual(['Agent Terminal 1', 'Agent Terminal 2']);
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
    expect(canUserWriteToTerminal({ ...session, awaitingInput: false }, 'manual')).toBe(false);
  });
});

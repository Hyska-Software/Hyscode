import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTerminalStore } from '@/stores/terminal-store';

const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, (payload: Record<string, unknown>) => void>(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: Record<string, unknown> }) => void) => {
    listeners.set(event, (payload) => handler({ payload }));
    return () => listeners.delete(event);
  }),
}));

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(
    async (_cmd: string, _args?: Record<string, unknown>): Promise<unknown> => undefined,
  ),
}));
vi.mock('./tauri-invoke', () => ({
  tauriInvokeRaw: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

import { DesktopTerminalRuntime } from './terminal-runtime';

const runtime = new DesktopTerminalRuntime();

function seedSession(ptyId = 'pty-1'): string {
  useTerminalStore.setState({ sessions: [], activeSessionId: null, nextIndex: 1 });
  const sessionId = useTerminalStore
    .getState()
    .createAgentSession({ conversationId: 'conversation-a' });
  useTerminalStore.getState().setPtyId(sessionId, ptyId);
  return sessionId;
}

function fireData(payload: Record<string, unknown>) {
  listeners.get('pty:data')?.(payload);
}

function fireExit(payload: Record<string, unknown>) {
  listeners.get('pty:exit')?.(payload);
}

describe('DesktopTerminalRuntime', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' });
    useTerminalStore.setState({ sessions: [], activeSessionId: null, nextIndex: 1 });
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('acquire', () => {
    it('reuses a healthy session and its live PTY', async () => {
      const sessionId = seedSession();
      invokeMock.mockImplementation(async (cmd: string) => (cmd === 'pty_exists' ? true : undefined));

      const binding = await runtime.acquire({
        conversationId: 'conversation-a',
        toolCallId: 'tool-1',
        cwd: 'C:/workspace',
        forceNew: false,
        background: false,
      });

      expect(binding).toEqual({
        terminalId: sessionId,
        ptyId: 'pty-1',
        persistent: true,
        frameLanguage: 'bash',
      });
      expect(invokeMock).not.toHaveBeenCalledWith('pty_spawn', expect.anything());
      expect(useTerminalStore.getState().sessions[0].activeToolCallId).toBe('tool-1');
    });

    it('spawns a fresh PTY when the stored one died', async () => {
      const sessionId = seedSession();
      invokeMock.mockImplementation(async (cmd: string) =>
        cmd === 'pty_exists' ? false : cmd === 'pty_spawn' ? 'pty-new' : undefined,
      );

      const binding = await runtime.acquire({
        conversationId: 'conversation-a',
        toolCallId: 'tool-1',
        cwd: 'C:/workspace',
        forceNew: false,
        background: false,
      });

      expect(binding.terminalId).toBe(sessionId);
      expect(binding.ptyId).toBe('pty-new');
      expect(useTerminalStore.getState().sessions[0].ptyId).toBe('pty-new');
      expect(useTerminalStore.getState().sessions[0].isDead).toBe(false);
    });

    it('creates a session when none is available and spawns its PTY', async () => {
      invokeMock.mockImplementation(async (cmd: string) =>
        cmd === 'pty_spawn' ? 'pty-fresh' : undefined,
      );

      const binding = await runtime.acquire({
        conversationId: 'conversation-a',
        toolCallId: 'tool-1',
        cwd: 'C:/workspace',
        forceNew: false,
        background: false,
      });

      const session = useTerminalStore.getState().sessions[0];
      expect(session).toMatchObject({ isAgentSession: true, ownerConversationId: 'conversation-a' });
      expect(binding.terminalId).toBe(session.id);
      expect(binding.ptyId).toBe('pty-fresh');
    });

    it('forces a fresh session when forceNew is set', async () => {
      const sessionId = seedSession();
      invokeMock.mockImplementation(async (cmd: string) =>
        cmd === 'pty_spawn' ? 'pty-other' : undefined,
      );

      const binding = await runtime.acquire({
        conversationId: 'conversation-a',
        toolCallId: 'tool-1',
        cwd: 'C:/workspace',
        forceNew: true,
        background: false,
      });

      expect(binding.terminalId).not.toBe(sessionId);
      expect(useTerminalStore.getState().sessions).toHaveLength(2);
    });
  });

  describe('snapshot / write / interrupt', () => {
    it('maps the native snapshot and advances the output sequence', async () => {
      const sessionId = seedSession();
      invokeMock.mockImplementation(async (cmd: string) =>
        cmd === 'pty_snapshot'
          ? {
              data: 'out',
              from_sequence: 2,
              to_sequence: 7,
              truncated: false,
              alive: true,
              exit_code: 0,
            }
          : undefined,
      );

      const snapshot = await runtime.snapshot(sessionId);
      expect(snapshot).toEqual({
        data: 'out',
        fromSequence: 2,
        toSequence: 7,
        truncated: false,
        alive: true,
        exitCode: 0,
      });
      expect(useTerminalStore.getState().sessions[0].outputSequence).toBe(7);
    });

    it('writes and interrupts through the PTY id', async () => {
      const sessionId = seedSession();
      await runtime.write(sessionId, 'data');
      await runtime.interrupt(sessionId);
      expect(invokeMock).toHaveBeenCalledWith('pty_write', { ptyId: 'pty-1', data: 'data' });
      expect(invokeMock).toHaveBeenCalledWith('pty_interrupt', { ptyId: 'pty-1' });
    });

    it('throws for unknown sessions', async () => {
      await expect(runtime.write('ghost', 'x')).rejects.toThrow('Unknown terminal');
    });
  });

  describe('kill / release', () => {
    it('kills the PTY and clears activity state', async () => {
      const sessionId = seedSession();
      useTerminalStore.getState().setAgentActivity(sessionId, 'tool-9');

      await runtime.kill(sessionId);
      expect(invokeMock).toHaveBeenCalledWith('pty_kill', { ptyId: 'pty-1' });
      expect(useTerminalStore.getState().sessions[0]).toMatchObject({
        isDead: true,
        activeToolCallId: null,
      });
    });

    it('release only clears the lock for the owning tool call', () => {
      const sessionId = seedSession();
      useTerminalStore.getState().setAgentActivity(sessionId, 'tool-9');

      runtime.release(sessionId, 'tool-other');
      expect(useTerminalStore.getState().sessions[0].activeToolCallId).toBe('tool-9');

      runtime.release(sessionId, 'tool-9');
      expect(useTerminalStore.getState().sessions[0].activeToolCallId).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('replays buffered output, drains queued events and dedupes by sequence', async () => {
      const sessionId = seedSession();
      const snapshotResolvers: Array<(value: unknown) => void> = [];
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === 'pty_snapshot') {
          return await new Promise((resolve) => {
            snapshotResolvers.push(resolve);
          });
        }
        return undefined;
      });

      const received: Array<{ data: string; sequence: number }> = [];
      const unsubscribePromise = runtime.subscribe(sessionId, (data, sequence) => {
        received.push({ data, sequence });
      }, vi.fn());

      await vi.waitFor(() => expect(snapshotResolvers).toHaveLength(1));
      fireData({ pty_id: 'pty-1', sequence: 6, data: 'queued' });
      fireData({ pty_id: 'pty-1', sequence: 4, data: 'stale' });
      snapshotResolvers[0]({
        data: 'old',
        from_sequence: 1,
        to_sequence: 5,
        truncated: false,
        alive: true,
        exit_code: null,
      });

      await unsubscribePromise;
      expect(received).toEqual([
        { data: 'old', sequence: 5 },
        { data: 'queued', sequence: 6 },
      ]);

      const secondSubscribe = runtime.subscribe(sessionId, vi.fn(), vi.fn());
      await vi.waitFor(() => expect(snapshotResolvers).toHaveLength(2));
      snapshotResolvers[1]({
        data: '',
        from_sequence: 0,
        to_sequence: 0,
        truncated: false,
        alive: true,
        exit_code: null,
      });
      const unsubscribe = await secondSubscribe;
      unsubscribe();
      expect(listeners.size).toBe(0);
    });

    it('notifies the exit callback when the snapshot shows a dead PTY', async () => {
      const sessionId = seedSession();
      invokeMock.mockImplementation(async (cmd: string) =>
        cmd === 'pty_snapshot'
          ? {
              data: 'bye',
              from_sequence: 1,
              to_sequence: 2,
              truncated: false,
              alive: false,
              exit_code: 1,
            }
          : undefined,
      );

      const onExit = vi.fn();
      await runtime.subscribe(sessionId, vi.fn(), onExit);
      expect(onExit).toHaveBeenCalledWith(1);
    });

    it('delivers live exit events for the subscribed PTY only', async () => {
      const sessionId = seedSession();
      invokeMock.mockImplementation(async (cmd: string) =>
        cmd === 'pty_snapshot'
          ? { data: '', from_sequence: 0, to_sequence: 0, truncated: false, alive: true, exit_code: null }
          : undefined,
      );

      const onExit = vi.fn();
      await runtime.subscribe(sessionId, vi.fn(), onExit);
      fireExit({ pty_id: 'pty-other', code: 3 });
      fireExit({ pty_id: 'pty-1', code: 2 });
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onExit).toHaveBeenCalledWith(2);
    });
  });

  describe('focus / snapshotActive', () => {
    it('focuses a session and snapshots the active one', async () => {
      const sessionId = seedSession();
      useTerminalStore.getState().setActiveSession(sessionId);
      invokeMock.mockImplementation(async (cmd: string) =>
        cmd === 'pty_snapshot'
          ? {
              data: '\u001b[31mred\u001b[0m\nclean line',
              from_sequence: 1,
              to_sequence: 3,
              truncated: false,
              alive: true,
              exit_code: null,
            }
          : undefined,
      );

      runtime.focus(sessionId);
      const active = await runtime.snapshotActive(16_000);
      expect(active).toMatchObject({ terminalId: sessionId, output: 'red\nclean line' });

      useTerminalStore.getState().setActiveSession('ghost');
      await expect(runtime.snapshotActive()).rejects.toThrow('No active terminal session');
    });
  });
});

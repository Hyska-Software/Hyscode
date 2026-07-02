import { listen } from '@tauri-apps/api/event';

import type {
  TerminalAcquireRequest,
  TerminalBinding,
  TerminalRuntimeAdapter,
  TerminalSnapshot,
} from '@hyscode/agent-harness';
import { useTerminalStore } from '@/stores/terminal-store';

import { tauriInvokeRaw } from './tauri-invoke';

type NativeSnapshot = {
  data: string;
  from_sequence: number;
  to_sequence: number;
  truncated: boolean;
  alive: boolean;
  exit_code: number | null;
};

const terminalLocks = new Map<string, string>();

function normalizeTerminalOutput(output: string, maxChars: number): string {
  const normalized = output
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !line.includes('__HYSCODE_BEGIN_') && !line.includes('__HYSCODE_END_'))
    .join('\n')
    .trim();
  return normalized.length <= maxChars ? normalized : normalized.slice(-maxChars);
}

export class DesktopTerminalRuntime implements TerminalRuntimeAdapter {
  async acquire(request: TerminalAcquireRequest): Promise<TerminalBinding> {
    const store = useTerminalStore.getState();
    let session = request.forceNew
      ? undefined
      : request.sessionName
        ? store.sessions.find(
            (item) =>
              item.isAgentSession &&
              item.name === request.sessionName &&
              item.ownerConversationId === request.conversationId,
          )
        : store.findHealthyAgentSession(request.conversationId);

    if (session?.activeToolCallId && session.activeToolCallId !== request.toolCallId) {
      session = undefined;
    }
    if (!session) {
      const sessionId = store.ensureAgentSession({
        name: request.sessionName,
        reuseHealthy: false,
        conversationId: request.conversationId,
        cwd: request.cwd,
      });
      session = useTerminalStore.getState().sessions.find((item) => item.id === sessionId);
    }
    if (!session) throw new Error('Failed to create agent terminal session.');

    let ptyId = session.ptyId;
    if (ptyId) {
      const alive = await tauriInvokeRaw<boolean>('pty_exists', { ptyId }).catch(() => false);
      if (!alive) {
        useTerminalStore.getState().markPtyDead(session.id);
        ptyId = null;
      }
    }
    if (!ptyId) {
      ptyId = await tauriInvokeRaw<string>('pty_spawn', {
        shell: null,
        cwd: request.cwd,
        env: null,
      });
      useTerminalStore.getState().setPtyId(session.id, ptyId);
    }

    terminalLocks.set(session.id, request.toolCallId);
    useTerminalStore.getState().setAgentActivity(session.id, request.toolCallId);
    return { terminalId: session.id, ptyId, persistent: true };
  }

  async snapshot(terminalId: string, afterSequence?: number): Promise<TerminalSnapshot> {
    const session = this.getSession(terminalId);
    if (!session.ptyId) throw new Error(`Terminal ${terminalId} has no PTY.`);
    const snapshot = await tauriInvokeRaw<NativeSnapshot>('pty_snapshot', {
      ptyId: session.ptyId,
      afterSequence,
    });
    useTerminalStore.getState().setOutputSequence(terminalId, snapshot.to_sequence);
    return {
      data: snapshot.data,
      fromSequence: snapshot.from_sequence,
      toSequence: snapshot.to_sequence,
      truncated: snapshot.truncated,
      alive: snapshot.alive,
      exitCode: snapshot.exit_code,
    };
  }

  async write(terminalId: string, data: string): Promise<void> {
    const session = this.getSession(terminalId);
    if (!session.ptyId) throw new Error(`Terminal ${terminalId} has no PTY.`);
    await tauriInvokeRaw('pty_write', { ptyId: session.ptyId, data });
  }

  async interrupt(terminalId: string): Promise<void> {
    const session = this.getSession(terminalId);
    if (session.ptyId) await tauriInvokeRaw('pty_interrupt', { ptyId: session.ptyId });
  }

  async kill(terminalId: string): Promise<void> {
    const session = this.getSession(terminalId);
    if (session.ptyId) await tauriInvokeRaw('pty_kill', { ptyId: session.ptyId });
    terminalLocks.delete(terminalId);
    useTerminalStore.getState().markPtyDead(terminalId);
    useTerminalStore.getState().setAgentActivity(terminalId, null);
  }

  release(terminalId: string, toolCallId: string): void {
    if (terminalLocks.get(terminalId) !== toolCallId) return;
    terminalLocks.delete(terminalId);
    useTerminalStore.getState().setAgentActivity(terminalId, null);
  }

  async snapshotActive(maxChars = 16_000): Promise<{
    terminalId: string;
    name: string;
    output: string;
    sequence: number;
  }> {
    const state = useTerminalStore.getState();
    const session = state.sessions.find((item) => item.id === state.activeSessionId);
    if (!session) throw new Error('No active terminal session.');
    const snapshot = await this.snapshot(session.id);
    return {
      terminalId: session.id,
      name: session.name,
      output: normalizeTerminalOutput(snapshot.data, maxChars),
      sequence: snapshot.toSequence,
    };
  }

  focus(terminalId: string): void {
    this.getSession(terminalId);
    useTerminalStore.getState().setActiveSession(terminalId);
  }

  async subscribe(
    terminalId: string,
    onData: (data: string, sequence: number) => void,
    onExit: (exitCode: number | null) => void,
  ): Promise<() => void> {
    const session = this.getSession(terminalId);
    if (!session.ptyId) throw new Error(`Terminal ${terminalId} has no PTY.`);
    const ptyId = session.ptyId;
    const queued: Array<{ data: string; sequence: number }> = [];
    let replayComplete = false;
    let appliedSequence = 0;
    const unlistenData = await listen<{ pty_id: string; sequence: number; data: string }>(
      'pty:data',
      (event) => {
        if (event.payload.pty_id !== ptyId) return;
        const chunk = { data: event.payload.data, sequence: event.payload.sequence };
        if (!replayComplete) queued.push(chunk);
        else if (chunk.sequence > appliedSequence) {
          appliedSequence = chunk.sequence;
          onData(chunk.data, chunk.sequence);
        }
      },
    );
    const unlistenExit = await listen<{ pty_id: string; code: number | null }>(
      'pty:exit',
      (event) => {
        if (event.payload.pty_id === ptyId) onExit(event.payload.code);
      },
    );
    const snapshot = await this.snapshot(terminalId);
    appliedSequence = snapshot.toSequence;
    if (snapshot.data) onData(snapshot.data, snapshot.toSequence);
    replayComplete = true;
    for (const chunk of queued) {
      if (chunk.sequence <= appliedSequence) continue;
      appliedSequence = chunk.sequence;
      onData(chunk.data, chunk.sequence);
    }
    if (!snapshot.alive) onExit(snapshot.exitCode);
    return () => {
      unlistenData();
      unlistenExit();
    };
  }

  private getSession(terminalId: string) {
    const session = useTerminalStore.getState().sessions.find((item) => item.id === terminalId);
    if (!session) throw new Error(`Unknown terminal: ${terminalId}`);
    return session;
  }
}

export const desktopTerminalRuntime = new DesktopTerminalRuntime();

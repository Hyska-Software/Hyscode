import { listen } from '@tauri-apps/api/event';

import {
  normalizeTerminalOutput,
  type TerminalAccess,
  type TerminalAcquireRequest,
  type TerminalBinding,
  type TerminalRuntimeAdapter,
  type TerminalSnapshot,
} from '@hyscode/agent-harness';
import { useTerminalStore } from '@/stores/terminal-store';

import { detectFrameLanguage, selectAgentSession } from './terminal-session-policy';
import { tauriInvokeRaw } from './tauri-invoke';

type NativeSnapshot = {
  data: string;
  from_sequence: number;
  to_sequence: number;
  truncated: boolean;
  alive: boolean;
  exit_code: number | null;
};

export class DesktopTerminalRuntime implements TerminalRuntimeAdapter {
  async acquire(request: TerminalAcquireRequest): Promise<TerminalBinding> {
    const store = useTerminalStore.getState();
    const frameLanguage = detectFrameLanguage();
    let session = selectAgentSession(store.sessions, request);
    if (!session) {
      const isolationKey = request.ownerId ?? request.conversationId;
      const sessionId = store.createAgentSession({
        name: request.sessionName,
        conversationId: isolationKey,
        cwd: request.cwd,
      });
      session = useTerminalStore.getState().sessions.find((item) => item.id === sessionId) ?? null;
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

    useTerminalStore.getState().setAgentActivity(session.id, request.toolCallId);
    return { terminalId: session.id, ptyId, persistent: true, frameLanguage };
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

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const session = this.getSession(terminalId);
    if (session.ptyId) await tauriInvokeRaw('pty_resize', { ptyId: session.ptyId, cols, rows });
  }

  authorize(terminalId: string, access: TerminalAccess): void {
    const session = this.getSession(terminalId);
    const isolationKey = access.ownerId ?? access.conversationId;
    if (access.source === 'agent') {
      if (!session.isAgentSession || session.ownerConversationId !== isolationKey) {
        throw new Error(`Terminal "${terminalId}" belongs to another terminal owner.`);
      }
      if (access.toolCallId && session.activeToolCallId && session.activeToolCallId !== access.toolCallId) {
        throw new Error(`Terminal "${terminalId}" is controlled by another tool.`);
      }
      return;
    }
    if (session.isAgentSession) {
      if (session.ownerConversationId !== access.conversationId) {
        throw new Error(`Terminal "${terminalId}" belongs to another conversation.`);
      }
      if (session.activeToolCallId || !session.awaitingInput) {
        throw new Error(`Terminal "${terminalId}" is owned by the Harness.`);
      }
    }
  }

  async interrupt(terminalId: string): Promise<void> {
    const session = this.getSession(terminalId);
    if (session.ptyId) await tauriInvokeRaw('pty_interrupt', { ptyId: session.ptyId });
  }

  async kill(terminalId: string): Promise<void> {
    const session = this.getSession(terminalId);
    if (session.ptyId) await tauriInvokeRaw('pty_kill', { ptyId: session.ptyId });
    useTerminalStore.getState().markPtyDead(terminalId);
    useTerminalStore.getState().setAgentActivity(terminalId, null);
  }

  release(terminalId: string, toolCallId: string): void {
    const session = useTerminalStore.getState().sessions.find((item) => item.id === terminalId);
    if (!session || session.activeToolCallId !== toolCallId) return;
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
    let exited = false;
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
        if (event.payload.pty_id !== ptyId || exited) return;
        exited = true;
        onExit(event.payload.code ?? null);
      },
    );
    const snapshot = await this.snapshot(terminalId);
    appliedSequence = snapshot.toSequence;
    if (snapshot.data) onData(snapshot.data, snapshot.toSequence);
    replayComplete = true;
    for (const chunk of queued.sort((left, right) => left.sequence - right.sequence)) {
      if (chunk.sequence <= appliedSequence) continue;
      appliedSequence = chunk.sequence;
      onData(chunk.data, chunk.sequence);
    }
    if (!snapshot.alive && !exited) {
      exited = true;
      onExit(snapshot.exitCode);
    }
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

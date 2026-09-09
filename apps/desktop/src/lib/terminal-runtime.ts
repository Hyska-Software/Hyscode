import { listen } from '@tauri-apps/api/event';

import {
  asTerminalRuntimeFailure,
  isTerminalRecord,
  TerminalValidationError,
  validateTerminalExitEvent,
  validateTerminalFailure,
  validateTerminalSnapshot,
  validateTerminalStopResult,
  validateTerminalSequence,
  validateTerminalString,
  withTerminalDeadline,
  TERMINAL_ADAPTER_CALL_TIMEOUT_MS,
  TERMINAL_STOP_CALL_TIMEOUT_MS,
  normalizeTerminalOutput,
} from '@hyscode/agent-harness';
import type {
  TerminalAccess,
  TerminalAcquireRequest,
  TerminalBinding,
  TerminalRuntimeAdapter,
  TerminalRuntimeFailure,
  TerminalShell,
  TerminalSnapshot,
  TerminalStopResult,
} from '@hyscode/agent-harness';
import { useTerminalStore } from '@/stores/terminal-store';
import { useSettingsStore } from '@/stores/settings-store';

import { resolveDesktopShell, selectAgentSession } from './terminal-session-policy';
import { tauriInvokeRaw } from './tauri-invoke';

type NativeSnapshotWire = {
  data: unknown;
  from_sequence: unknown;
  to_sequence: unknown;
  truncated: unknown;
  alive: unknown;
  exit_code: unknown;
  failure: unknown;
};

type QueuedData = {
  data: string;
  sequence: number;
};

export class DesktopTerminalRuntime implements TerminalRuntimeAdapter {
  private readonly shellContracts = new Map<string, TerminalShell>();
  private readonly stopPromises = new Map<string, Promise<TerminalStopResult>>();
  private readonly quarantinePromises = new Map<string, Promise<void>>();

  async acquire(request: TerminalAcquireRequest): Promise<TerminalBinding> {
    const store = useTerminalStore.getState();
    const configuredShell = useSettingsStore.getState().terminalShell.trim() || null;
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
    if (!session) throw new TerminalValidationError({
      operation: 'acquire',
      message: 'Failed to create agent terminal session.',
    });

    let shell = this.shellContracts.get(session.id) ?? resolveDesktopShell(configuredShell);
    let ptyId = session.ptyId;
    if (ptyId) {
      let alive: boolean;
      try {
        const result = await withTerminalDeadline(
          'acquire',
          () => tauriInvokeRaw<unknown>('pty_exists', { ptyId }),
          undefined,
          TERMINAL_ADAPTER_CALL_TIMEOUT_MS,
        );
        if (typeof result !== 'boolean') throw new Error('pty_exists returned a non-boolean result.');
        alive = result;
      } catch (error) {
        const failure = asTerminalRuntimeFailure(error, 'acquire');
        await this.quarantineTerminal(session.id, ptyId, failure);
        throw new TerminalValidationError(failure);
      }
      if (!alive) {
        const staleSessionId = session.id;
        this.markSessionDeadIfCurrent(staleSessionId, ptyId, null, null);
        this.shellContracts.delete(staleSessionId);
        const isolationKey = request.ownerId ?? request.conversationId;
        const replacementId = useTerminalStore.getState().createAgentSession({
          name: request.sessionName,
          conversationId: isolationKey,
          cwd: request.cwd,
        });
        session = useTerminalStore.getState().sessions.find((item) => item.id === replacementId) ?? null;
        if (!session) throw new TerminalValidationError({
          operation: 'acquire',
          message: 'Failed to create replacement agent terminal session.',
        });
        shell = resolveDesktopShell(configuredShell);
        ptyId = null;
      }
    }
    const spawningSessionId = session.id;

    if (!ptyId) {
        const spawned = await withTerminalDeadline(
          'acquire',
          () => tauriInvokeRaw<unknown>('pty_spawn', {
            shell: shell.command,
            cwd: request.cwd,
            env: null,
            cols: 120,
            rows: 32,
            interactive: false,
          }),
          (latePtyId) => {
            if (typeof latePtyId !== 'string') {
              console.error('[terminal-runtime] Late acquire returned an invalid PTY id.', latePtyId);
              return;
            }
            const lateFailure: TerminalRuntimeFailure = {
              operation: 'acquire',
              message: 'PTY acquisition completed after its deadline.',
            };
            const current = useTerminalStore.getState().sessions.find(
              (item) => item.id === spawningSessionId,
            );
            if (current && current.ptyId === null) {
              useTerminalStore.getState().setPtyId(spawningSessionId, latePtyId);
              void this.quarantineTerminal(spawningSessionId, latePtyId, lateFailure);
              return;
            }
            void withTerminalDeadline(
              'kill',
              () => tauriInvokeRaw<unknown>('pty_kill', { ptyId: latePtyId }),
              undefined,
              TERMINAL_STOP_CALL_TIMEOUT_MS,
            )
              .then((rawStop) => {
                const stop = validateTerminalStopResult(rawStop);
                if (stop.status !== 'stopped') {
                  console.error(`[terminal-runtime] Late acquire cleanup was not confirmed (${stop.status}).`, stop.failures);
                }
              })
              .catch((error: unknown) => {
                console.error('[terminal-runtime] Late acquire cleanup failed.', error);
              });
          },
          TERMINAL_ADAPTER_CALL_TIMEOUT_MS,
        );
        ptyId = validateTerminalString(spawned, 'pty_id', 'acquire');
        useTerminalStore.getState().setPtyId(session.id, ptyId);
        this.quarantinePromises.delete(session.id);
        shell = resolveDesktopShell(configuredShell);
    }

    this.shellContracts.set(session.id, shell);
    useTerminalStore.getState().setAgentActivity(session.id, request.toolCallId);
    return { terminalId: session.id, ptyId, persistent: true, frameLanguage: shell.frameLanguage };
  }

  async spawnUserTerminal(
    sessionId: string,
    cwd: string,
    cols = 120,
    rows = 32,
    interactive = true,
  ): Promise<string> {
    const session = this.getSession(sessionId);
    const shell = this.shellContracts.get(sessionId)
      ?? resolveDesktopShell(useSettingsStore.getState().terminalShell.trim() || null);
    try {
      const spawned = await withTerminalDeadline(
        'acquire',
        () => tauriInvokeRaw<unknown>('pty_spawn', {
          shell: shell.command,
          cwd,
          env: null,
          cols,
          rows,
          interactive,
        }),
        (latePtyId) => {
          if (typeof latePtyId !== 'string') {
            console.error('[terminal-runtime] Late user terminal spawn returned an invalid PTY id.', latePtyId);
            return;
          }
          const lateFailure: TerminalRuntimeFailure = {
            operation: 'acquire',
            message: 'User terminal spawn completed after its deadline.',
          };
          const current = useTerminalStore.getState().sessions.find((item) => item.id === sessionId);
          if (current && current.ptyId === null) {
            useTerminalStore.getState().setPtyId(sessionId, latePtyId);
            void this.quarantineTerminal(sessionId, latePtyId, lateFailure);
            return;
          }
          void withTerminalDeadline(
            'kill',
            () => tauriInvokeRaw<unknown>('pty_kill', { ptyId: latePtyId }),
            undefined,
            TERMINAL_STOP_CALL_TIMEOUT_MS,
          ).catch((error: unknown) => {
            console.error('[terminal-runtime] Late user terminal cleanup failed.', error);
          });
        },
        TERMINAL_ADAPTER_CALL_TIMEOUT_MS,
      );
      const ptyId = validateTerminalString(spawned, 'pty_id', 'acquire');
      useTerminalStore.getState().setPtyId(session.id, ptyId);
      this.shellContracts.set(sessionId, shell);
      return ptyId;
    } catch (error) {
      throw new TerminalValidationError(asTerminalRuntimeFailure(error, 'acquire'));
    }
  }

  async snapshot(terminalId: string, afterSequence?: number): Promise<TerminalSnapshot> {
    const session = this.getSession(terminalId);
    if (!session.ptyId) throw new TerminalValidationError({
      operation: 'snapshot',
      message: `Terminal ${terminalId} has no PTY.`,
    });
    let snapshot: TerminalSnapshot;
    try {
      snapshot = await withTerminalDeadline(
        'snapshot',
        () => tauriInvokeRaw<unknown>('pty_snapshot', {
          ptyId: session.ptyId,
          afterSequence,
        }),
        undefined,
        TERMINAL_ADAPTER_CALL_TIMEOUT_MS,
      ).then((value) => normalizeNativeSnapshot(value));
    } catch (error) {
      const failure = asTerminalRuntimeFailure(error, 'snapshot');
      this.quarantineTerminal(terminalId, session.ptyId, failure);
      throw new TerminalValidationError(failure);
    }
    const current = useTerminalStore.getState().sessions.find((item) => item.id === terminalId);
    if (current?.ptyId === session.ptyId) {
      useTerminalStore.getState().setOutputSequence(terminalId, snapshot.toSequence);
      if (!snapshot.alive || snapshot.failure) {
        this.markSessionDeadIfCurrent(
          terminalId,
          session.ptyId,
          snapshot.exitCode,
          snapshot.failure,
        );
      }
    }
    return snapshot;
  }
  async write(terminalId: string, data: string): Promise<void> {
    const session = this.getSession(terminalId);
    if (!session.ptyId) throw new TerminalValidationError({
      operation: 'write',
      message: `Terminal ${terminalId} has no PTY.`,
    });
    try {
      await withTerminalDeadline(
        'write',
        () => tauriInvokeRaw('pty_write', { ptyId: session.ptyId, data }),
        undefined,
        TERMINAL_ADAPTER_CALL_TIMEOUT_MS,
      );
    } catch (error) {
      const failure = asTerminalRuntimeFailure(error, 'write');
      this.markSessionDeadIfCurrent(terminalId, session.ptyId, session.exitCode, failure);
      throw new TerminalValidationError(failure);
    }
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const session = this.getSession(terminalId);
    if (!session.ptyId) return;
    try {
      await withTerminalDeadline(
        'event',
        () => tauriInvokeRaw('pty_resize', { ptyId: session.ptyId, cols, rows }),
        undefined,
        TERMINAL_ADAPTER_CALL_TIMEOUT_MS,
      );
    } catch (error) {
      const failure = asTerminalRuntimeFailure(error, 'event');
      this.markSessionDeadIfCurrent(terminalId, session.ptyId, session.exitCode, failure);
      throw new TerminalValidationError(failure);
    }
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
    if (!session.ptyId) return;
    try {
      await withTerminalDeadline(
        'interrupt',
        () => tauriInvokeRaw('pty_interrupt', { ptyId: session.ptyId }),
        undefined,
        TERMINAL_STOP_CALL_TIMEOUT_MS,
      );
    } catch (error) {
      const failure = asTerminalRuntimeFailure(error, 'interrupt');
      this.markSessionDeadIfCurrent(terminalId, session.ptyId, session.exitCode, failure);
      throw new TerminalValidationError(failure);
    }
  }

  async kill(terminalId: string): Promise<TerminalStopResult> {
    const existing = this.stopPromises.get(terminalId);
    if (existing) return existing;
    const promise = this.killInternal(terminalId);
    this.stopPromises.set(terminalId, promise);
    try {
      return await promise;
    } finally {
      if (this.stopPromises.get(terminalId) === promise) this.stopPromises.delete(terminalId);
    }
  }

  private async killInternal(terminalId: string): Promise<TerminalStopResult> {
    const session = this.getSession(terminalId);
    const ptyId = session.ptyId;
    if (!ptyId) return { status: 'stopped', failures: [] };
    const expectedToolCallId = session.activeToolCallId ?? undefined;
    try {
      const raw = await withTerminalDeadline(
        'kill',
        () => tauriInvokeRaw<unknown>('pty_kill', { ptyId }),
        undefined,
        TERMINAL_STOP_CALL_TIMEOUT_MS,
      );
      const stop = validateTerminalStopResult(raw);
      const failure = stop.failures[0] ?? (
        stop.status === 'stopped'
          ? null
          : {
              operation: 'kill' as const,
              message: `Terminal stop was not confirmed (${stop.status}).`,
            }
      );
      this.markSessionDeadIfCurrent(terminalId, ptyId, null, failure, expectedToolCallId);
      return stop;
    } catch (error) {
      const failure = asTerminalRuntimeFailure(error, 'kill');
      this.markSessionDeadIfCurrent(terminalId, ptyId, null, failure, expectedToolCallId);
      return { status: 'unknown', failures: [failure] };
    }
  }

  release(terminalId: string, toolCallId: string): void {
    const session = useTerminalStore.getState().sessions.find((item) => item.id === terminalId);
    if (!session || session.activeToolCallId !== toolCallId) return;
    useTerminalStore.getState().clearAgentActivityIfOwned(terminalId, toolCallId);
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
    onExit: (exitCode: number | null, failure?: TerminalRuntimeFailure | null) => void,
  ): Promise<() => void> {
    const session = this.getSession(terminalId);
    if (!session.ptyId) throw new TerminalValidationError({
      operation: 'subscribe',
      message: `Terminal ${terminalId} has no PTY.`,
    });
    const ptyId = session.ptyId;
    const queued: QueuedData[] = [];
    let replayComplete = false;
    let appliedSequence = 0;
    let exited = false;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    const reportFailure = (error: unknown): void => {
      const failure = asTerminalRuntimeFailure(error, 'event');
      this.quarantineTerminal(terminalId, ptyId, failure);
      if (exited) return;
      exited = true;
      try {
        onExit(null, failure);
      } catch (callbackError) {
        console.error('[terminal-runtime] Terminal exit callback failed.', callbackError);
      }
    };
    const handleData = (event: { payload: unknown }): void => {
      const payload = event.payload;
      if (!isTerminalRecord(payload) || payload.pty_id !== ptyId || exited) return;
      try {
        const normalized = {
          data: validateTerminalString(payload.data, 'data', 'event'),
          sequence: validateTerminalSequence(payload.sequence, 'sequence', 'event'),
        };
        const chunk = { data: normalized.data, sequence: normalized.sequence };
        if (!replayComplete) queued.push(chunk);
        else if (chunk.sequence > appliedSequence) {
          appliedSequence = chunk.sequence;
          onData(chunk.data, chunk.sequence);
        }
      } catch (error) {
        reportFailure(error);
      }
    };
    const handleExit = (event: { payload: unknown }): void => {
      const payload = event.payload;
      if (!isTerminalRecord(payload) || payload.pty_id !== ptyId || exited) return;
      try {
        const normalized = validateTerminalExitEvent(payload);
        exited = true;
        this.markSessionDeadIfCurrent(terminalId, ptyId, normalized.code, normalized.failure);
        try {
          onExit(normalized.code, normalized.failure);
        } catch (error) {
          console.error('[terminal-runtime] Terminal exit callback failed.', error);
        }
      } catch (error) {
        reportFailure(error);
      }
    };

    try {
      unlistenData = await withTerminalDeadline(
        'subscribe',
        () => listen<unknown>('pty:data', handleData),
        (lateUnlisten) => {
          try {
            lateUnlisten();
          } catch (error) {
            console.error('[terminal-runtime] Late data subscription cleanup failed.', error);
          }
        },
        TERMINAL_ADAPTER_CALL_TIMEOUT_MS,
      );
      unlistenExit = await withTerminalDeadline(
        'subscribe',
        () => listen<unknown>('pty:exit', handleExit),
        (lateUnlisten) => {
          try {
            lateUnlisten();
          } catch (error) {
            console.error('[terminal-runtime] Late exit subscription cleanup failed.', error);
          }
        },
        TERMINAL_ADAPTER_CALL_TIMEOUT_MS,
      );
      const snapshot = await withTerminalDeadline(
        'snapshot',
        () => this.snapshot(terminalId),
        undefined,
        TERMINAL_ADAPTER_CALL_TIMEOUT_MS,
      );
      appliedSequence = snapshot.toSequence;
      if (snapshot.data) onData(snapshot.data, snapshot.toSequence);
      replayComplete = true;
      for (const chunk of queued.sort((left, right) => left.sequence - right.sequence)) {
        if (chunk.sequence <= appliedSequence) continue;
        appliedSequence = chunk.sequence;
        onData(chunk.data, chunk.sequence);
      }
      if ((!snapshot.alive || snapshot.failure) && !exited) {
        exited = true;
        onExit(snapshot.exitCode, snapshot.failure);
      }
    } catch (error) {
      let cleanupError: unknown = null;
      reportFailure(error);
      try {
        unlistenData?.();
      } catch (unsubscribeError) {
        cleanupError = unsubscribeError;
      }
      try {
        unlistenExit?.();
      } catch (unsubscribeError) {
        cleanupError ??= unsubscribeError;
      }
      unlistenData = null;
      unlistenExit = null;
      if (cleanupError) {
        const failure = asTerminalRuntimeFailure(error, 'subscribe');
        const cleanupFailure = asTerminalRuntimeFailure(cleanupError, 'subscribe');
        throw new TerminalValidationError({
          operation: failure.operation,
          message: `${failure.message} Cleanup: ${cleanupFailure.message}`,
        });
      }
      throw error;
    }
    return () => {
      let firstError: unknown = null;
      try {
        unlistenData?.();
      } catch (error) {
        firstError = error;
      }
      try {
        unlistenExit?.();
      } catch (error) {
        firstError ??= error;
      }
      unlistenData = null;
      unlistenExit = null;
      if (firstError) throw firstError;
    };
  }

  private getSession(terminalId: string) {
    const session = useTerminalStore.getState().sessions.find((item) => item.id === terminalId);
    if (!session) throw new Error(`Unknown terminal: ${terminalId}`);
    return session;
  }

  private quarantineTerminal(
    terminalId: string,
    ptyId: string,
    failure: TerminalRuntimeFailure,
  ): Promise<void> {
    this.markSessionDeadIfCurrent(terminalId, ptyId, null, failure);
    const existing = this.quarantinePromises.get(terminalId);
    if (existing) return existing;
    const cleanup = this.kill(terminalId)
      .then((stop) => {
        if (stop.status !== 'stopped') {
          console.error(`[terminal-runtime] Terminal quarantine was not confirmed (${stop.status}).`, stop.failures);
        }
      })
      .catch((error: unknown) => {
        console.error('[terminal-runtime] Terminal quarantine failed.', error);
      });
    this.quarantinePromises.set(terminalId, cleanup);
    return cleanup;
  }


  private markSessionDeadIfCurrent(
    terminalId: string,
    expectedPtyId: string,
    exitCode: number | null,
    failure: TerminalRuntimeFailure | null,
    expectedToolCallId?: string,
  ): void {
    const session = useTerminalStore.getState().sessions.find((item) => item.id === terminalId);
    if (!session || session.ptyId !== expectedPtyId) return;
    useTerminalStore.getState().markPtyDead(
      terminalId,
      exitCode,
      failure,
      expectedToolCallId ?? session.activeToolCallId ?? undefined,
    );
  }
}

function normalizeNativeSnapshot(raw: unknown): TerminalSnapshot {
  if (!isTerminalRecord(raw)) throw new TerminalValidationError({
    operation: 'snapshot',
    message: 'PTY snapshot must be an object.',
  });
  if (!('failure' in raw) || raw.failure === undefined) throw new TerminalValidationError({
    operation: 'snapshot',
    message: 'PTY snapshot failure field is missing.',
  });
  const native = raw as NativeSnapshotWire;
  return validateTerminalSnapshot({
    data: native.data,
    fromSequence: native.from_sequence,
    toSequence: native.to_sequence,
    truncated: native.truncated,
    alive: native.alive,
    exitCode: native.exit_code,
    failure: validateTerminalFailure(native.failure, 'snapshot'),
  });
}

export const desktopTerminalRuntime = new DesktopTerminalRuntime();

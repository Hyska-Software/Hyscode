import type {
  TerminalAccess,
  TerminalBinding,
  TerminalFailureOperation,
  TerminalProgress,
  TerminalRuntimeAdapter,
  TerminalRuntimeFailure,
  TerminalSnapshot,
  TerminalStopResult,
  ToolExecutionContext,
  ToolResult,
} from './types';
import { CommandWatch } from './command-watch';
import {
  buildTerminalFrame,
  isSensitiveTerminalPrompt,
  looksLikeTerminalPrompt,
  parseTerminalFrame,
} from './terminal-protocol';
import {
  TerminalValidationError,
  asTerminalRuntimeFailure,
  isTerminalRecord,
  validateTerminalDataEvent,
  validateTerminalExitEvent,
  validateTerminalSnapshot,
  validateTerminalStopResult,
} from './terminal-runtime-validation';
import { resolveAuthorizedPath } from './path-policy';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
export const TERMINAL_ADAPTER_CALL_TIMEOUT_MS = 5_000;
export const TERMINAL_STOP_CALL_TIMEOUT_MS = 2_000;
const ADAPTER_CALL_TIMEOUT_MS = TERMINAL_ADAPTER_CALL_TIMEOUT_MS;
const STOP_CALL_TIMEOUT_MS = TERMINAL_STOP_CALL_TIMEOUT_MS;
const INTERRUPT_GRACE_MS = 750;
const POLL_MS = 50;
const SNAPSHOT_RECONCILE_MS = 250;
const EXIT_DRAIN_GRACE_MS = 1_000;

type SuspendedCommand = {
  binding: TerminalBinding;
  command: string;
  cwd: string;
  nonce: string;
  conversationId: string;
  ownerId?: string;
  toolCallId: string;
};

type FinalProgressState = Extract<TerminalProgress['state'], 'complete' | 'error' | 'cancelled' | 'background'>;

type CleanupState = {
  binding: TerminalBinding | null;
  unsubscribes: Array<() => void>;
  commandSent: boolean;
  suspended: boolean;
  finalStateEmitted: boolean;
  stopPromise: Promise<TerminalStopResult> | null;
  stopResult: TerminalStopResult | null;
  terminalExited: boolean;
  runtimeFailure: boolean;
};

type RunState = {
  result: ToolResult | null;
  progressState: TerminalProgress['state'];
  failure: TerminalRuntimeFailure | null;
  sequence: number;
  timedOut: boolean;
};

/** Interrupt and escalate a terminal owned by the current command runner. */
async function stopOwnedCommand(
  adapter: TerminalRuntimeAdapter,
  terminalId: string,
  access: TerminalAccess,
): Promise<TerminalStopResult> {
  return stopCommandInternal(adapter, terminalId, access, false);
}

/** Interrupt a command and escalate to killing an unresponsive PTY. */
export async function stopCommand(
  adapter: TerminalRuntimeAdapter,
  terminalId: string,
  access?: TerminalAccess,
): Promise<TerminalStopResult> {
  return stopCommandInternal(adapter, terminalId, access, true);
}

async function stopCommandInternal(
  adapter: TerminalRuntimeAdapter,
  terminalId: string,
  access: TerminalAccess | undefined,
  enforceAuthorization: boolean,
): Promise<TerminalStopResult> {
  const failures: TerminalRuntimeFailure[] = [];
  if (enforceAuthorization) {
    try {
      await withTerminalDeadline(
        'authorize',
        () => authorizeTerminal(adapter, terminalId, access),
        undefined,
        ADAPTER_CALL_TIMEOUT_MS,
      );
    } catch (error) {
      failures.push(asTerminalRuntimeFailure(error, 'authorize'));
      return { status: 'unknown', failures };
    }
  }

  try {
    await withTerminalDeadline(
      'interrupt',
      () => adapter.interrupt(terminalId),
      undefined,
      STOP_CALL_TIMEOUT_MS,
    );
  } catch (error) {
    failures.push(asTerminalRuntimeFailure(error, 'interrupt'));
  }
  await delay(INTERRUPT_GRACE_MS);

  let snapshot: TerminalSnapshot | null = null;
  try {
    const currentSnapshot = await withTerminalDeadline(
      'snapshot',
      () => adapter.snapshot(terminalId).then((value) => validateTerminalSnapshot(value)),
      undefined,
      STOP_CALL_TIMEOUT_MS,
    );
    snapshot = currentSnapshot;
    if (currentSnapshot.failure) failures.push(currentSnapshot.failure);
  } catch (error) {
    failures.push(asTerminalRuntimeFailure(error, 'snapshot'));
  }

  if (snapshot && !snapshot.alive && !snapshot.failure) return { status: 'stopped', failures };

  try {
    const kill = await withTerminalDeadline(
      'kill',
      () => adapter.kill(terminalId).then((value) => validateTerminalStopResult(value)),
      (lateStop) => {
        if (lateStop.status !== 'stopped' || lateStop.failures.length > 0) {
          console.error('[terminal-runtime] Late terminal stop was not cleanly confirmed.', lateStop);
        }
      },
      STOP_CALL_TIMEOUT_MS,
    );
    failures.push(...kill.failures);
    return { status: kill.status, failures };
  } catch (error) {
    failures.push(asTerminalRuntimeFailure(error, 'kill'));
    return { status: 'unknown', failures };
  }
}

export class TerminalCommandRunner {
  private readonly interactiveCommands = new Map<string, SuspendedCommand>();

  invalidateInteractive(terminalId: string, access?: TerminalAccess): boolean {
    const interactive = this.interactiveCommands.get(terminalId);
    if (!interactive) return false;
    if (
      access
      && (interactive.conversationId !== access.conversationId || interactive.ownerId !== access.ownerId)
    ) return false;
    this.interactiveCommands.delete(terminalId);
    return true;
  }

  async run(input: TerminalCommandInput, ctx: ToolExecutionContext): Promise<ToolResult> {
    const adapter = ctx.terminal;
    if (!adapter) return { success: false, output: '', error: 'Terminal runtime is unavailable.' };
    if (!adapter.subscribe && !ctx.listen) {
      return { success: false, output: '', error: 'Terminal event listener is unavailable.' };
    }
    if (ctx.signal.aborted) return { success: false, output: '', error: 'Command cancelled.' };

    const command = input.command;
    const cwd = input.cwd
      ? resolveAuthorizedPath(input.cwd, ctx.workspacePath, ctx.externalPathAccess)
      : ctx.workspacePath;
    const background = Boolean(input.background);
    const cleanup: CleanupState = {
      binding: null,
      unsubscribes: [],
      commandSent: false,
      suspended: false,
      finalStateEmitted: false,
      stopPromise: null,
      stopResult: null,
      terminalExited: false,
      runtimeFailure: false,
    };
    const state: RunState = {
      result: null,
      progressState: 'error',
      failure: null,
      sequence: 0,
      timedOut: false,
    };
    let watch: CommandWatch | null = null;
    let abortHandler: (() => void) | null = null;
    let commandNotified = false;
    let operation: TerminalFailureOperation = 'acquire';

    const startStop = (): Promise<TerminalStopResult> => {
      if (!cleanup.binding) {
        return Promise.resolve({
          status: 'unknown',
          failures: [{ operation: 'kill', message: 'No terminal binding was acquired.' }],
        });
      }
      cleanup.stopPromise ??= stopOwnedCommand(adapter, cleanup.binding.terminalId, terminalAccess(ctx))
        .then((stop) => {
          cleanup.stopResult = stop;
          return stop;
        });
      return cleanup.stopPromise;
    };

    const reconcileSnapshot = async (): Promise<void> => {
      if (!cleanup.binding || !watch) return;
      operation = 'snapshot';
      const snapshot = await withTerminalDeadline(
        'snapshot',
        () => adapter.snapshot(cleanup.binding!.terminalId).then((value) => validateTerminalSnapshot(value)),
        undefined,
        ADAPTER_CALL_TIMEOUT_MS,
      );
      watch.syncFullSnapshot(snapshot);
    };

    const subscribeToStream = async (): Promise<void> => {
      if (!cleanup.binding || !watch) return;
      const binding = cleanup.binding;
      if (adapter.subscribe) {
        operation = 'subscribe';
        const unsubscribe = await withTerminalDeadline(
          'subscribe',
          () => adapter.subscribe!(
            binding.terminalId,
            (data, sequence) => {
              if (!watch) return;
              if (watch.pushData(sequence, data)) {
                emitProgress(ctx, binding, 'running', data, sequence);
              }
            },
            (code, failure) => watch?.pushExit(code, failure),
          ),
          (lateUnsubscribe) => {
            try {
              lateUnsubscribe();
            } catch (error) {
              console.error('[terminal-runtime] Late adapter subscription cleanup failed.', error);
            }
          },
          ADAPTER_CALL_TIMEOUT_MS,
        );
        cleanup.unsubscribes.push(unsubscribe);
        return;
      }

      const listen = ctx.listen;
      if (!listen) throw new Error('Terminal event listener is unavailable.');
      operation = 'subscribe';
      const unlistenData = await withTerminalDeadline(
        'subscribe',
        () => listen('pty:data', (payload) => {
          if (!isTerminalRecord(payload) || payload.pty_id !== binding.ptyId) return;
          try {
            const event = validateTerminalDataEvent(payload);
            if (watch?.pushData(event.sequence, event.data)) {
              emitProgress(ctx, binding, 'running', event.data, event.sequence);
            }
          } catch (error) {
            watch?.pushFailure(asTerminalRuntimeFailure(error, 'event'));
          }
        }),
        (lateUnsubscribe) => {
          try {
            lateUnsubscribe();
          } catch (error) {
            console.error('[terminal-runtime] Late data subscription cleanup failed.', error);
          }
        },
        ADAPTER_CALL_TIMEOUT_MS,
      );
      cleanup.unsubscribes.push(unlistenData);
      try {
        const unlistenExit = await withTerminalDeadline(
          'subscribe',
          () => listen('pty:exit', (payload) => {
            if (!isTerminalRecord(payload) || payload.pty_id !== binding.ptyId) return;
            try {
              const event = validateTerminalExitEvent(payload);
              watch?.pushExit(event.code, event.failure);
            } catch (error) {
              watch?.pushFailure(asTerminalRuntimeFailure(error, 'event'));
            }
          }),
          (lateUnsubscribe) => {
            try {
              lateUnsubscribe();
            } catch (error) {
              console.error('[terminal-runtime] Late exit subscription cleanup failed.', error);
            }
          },
          ADAPTER_CALL_TIMEOUT_MS,
        );
        cleanup.unsubscribes.push(unlistenExit);
      } catch (error) {
        try {
          unlistenData();
        } catch (cleanupError) {
          const failure = asTerminalRuntimeFailure(error, 'subscribe');
          const cleanupFailure = asTerminalRuntimeFailure(cleanupError, 'subscribe');
          throw new TerminalValidationError({
            operation: failure.operation,
            message: `${failure.message} Cleanup: ${cleanupFailure.message}`,
          });
        }
        throw error;
      }
    };

    try {
      operation = 'acquire';
      cleanup.binding = await withTerminalDeadline(
        'acquire',
        () => adapter.acquire({
          conversationId: ctx.conversationId,
          toolCallId: ctx.toolCallId,
          cwd,
          forceNew: Boolean(input.forceNew) || background,
          sessionName: input.sessionName,
          background,
          ownerId: ctx.ownerId,
        }),
        (lateBinding) => {
          void withTerminalDeadline(
            'kill',
            () => adapter.kill(lateBinding.terminalId).then((value) => validateTerminalStopResult(value)),
            (lateStop) => {
              if (lateStop.status !== 'stopped' || lateStop.failures.length > 0) {
                console.error('[terminal-runtime] Late acquire cleanup was not cleanly confirmed.', lateStop);
              }
            },
            STOP_CALL_TIMEOUT_MS,
          )
            .catch((error: unknown) => {
              console.error('[terminal-runtime] Late acquire cleanup failed.', error);
            });
        },
        ADAPTER_CALL_TIMEOUT_MS,
      );
      if (ctx.signal.aborted) {
        throw new TerminalValidationError({ operation: 'timeout', message: 'Command cancelled.' });
      }

      const access = terminalAccess(ctx);
      operation = 'authorize';
      await withTerminalDeadline(
        'authorize',
        () => authorizeTerminal(adapter, cleanup.binding!.terminalId, access),
        undefined,
        ADAPTER_CALL_TIMEOUT_MS,
      );
      if (ctx.signal.aborted) {
        throw new TerminalValidationError({ operation: 'timeout', message: 'Command cancelled.' });
      }
      const nonce = crypto.randomUUID().replace(/-/g, '');
      watch = new CommandWatch({
        nonce,
        background,
        readyPattern: input.readyPattern ? new RegExp(input.readyPattern) : null,
        startedAt: Date.now(),
      });
      abortHandler = () => {
        void startStop().catch((error: unknown) => {
          console.error('[terminal-runtime] Abort cleanup failed.', error);
        });
      };
      ctx.signal.addEventListener('abort', abortHandler, { once: true });
      emitProgress(ctx, cleanup.binding, 'started');
      await subscribeToStream();
      watch.markCommandBaseline();
      const commandBaselineSequence = watch.sequence;
      if (ctx.signal.aborted) {
        throw new TerminalValidationError({ operation: 'timeout', message: 'Command cancelled.' });
      }

      operation = 'write';
      await withTerminalDeadline(
        'write',
        () => adapter.write(cleanup.binding!.terminalId, buildTerminalFrame(command, cleanup.binding!.frameLanguage, nonce)),
        () => {
          void startStop().catch((error: unknown) => {
            console.error('[terminal-runtime] Late write cleanup failed.', error);
          });
        },
        ADAPTER_CALL_TIMEOUT_MS,
      );
      cleanup.commandSent = true;
      await reconcileSnapshot();
      const waitLimit = background
        ? (input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)
        : (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const startedAt = Date.now();
      let lastSnapshotAt = Date.now();
      let exitDrainStartedAt: number | null = null;

      while (!state.result) {
        if (ctx.signal.aborted) break;
        const now = Date.now();
        if (watch.hasExited) {
          exitDrainStartedAt ??= now;
          if (now - exitDrainStartedAt >= EXIT_DRAIN_GRACE_MS) break;
        } else if (now - startedAt >= waitLimit) {
          state.timedOut = true;
          break;
        }
        if (now - lastSnapshotAt >= SNAPSHOT_RECONCILE_MS || watch.hasExited) {
          await reconcileSnapshot();
          lastSnapshotAt = Date.now();
        }
        const outcome = watch.evaluate(Date.now());
        state.sequence = 'sequence' in outcome ? outcome.sequence : watch.sequence;
        if (outcome.kind === 'complete') {
          cleanup.suspended = false;
          state.progressState = outcome.exitCode === 0 ? 'complete' : 'error';
          state.failure = null;
          state.result = {
            success: outcome.exitCode === 0,
            output: outcome.output || `Command completed with exit code ${outcome.exitCode}`,
            error: outcome.exitCode !== 0 ? `Exit code: ${outcome.exitCode}` : undefined,
            metadata: {
              cwd,
              exitCode: outcome.exitCode,
              terminalId: cleanup.binding.terminalId,
              background,
              sequence: outcome.sequence,
              commandBaselineSequence,
            },
          };
          break;
        }
        if (outcome.kind === 'error') {
          const canDrain = watch.hasExited
            && !watch.commandFailure
            && !watch.parsed().protocolError
            && exitDrainStartedAt !== null
            && Date.now() - exitDrainStartedAt < EXIT_DRAIN_GRACE_MS;
          if (!canDrain) {
            state.progressState = 'error';
            state.failure = outcome.failure;
            state.result = {
              success: false,
              output: outcome.output,
              error: outcome.failure.message,
              metadata: {
                cwd,
                terminalId: cleanup.binding.terminalId,
                exitCode: outcome.exitCode,
                background,
                sequence: outcome.sequence,
                commandBaselineSequence,
              },
            };
            break;
          }
        }
        if (watch.hasExited) {
          await delay(POLL_MS);
          continue;
        }
        if (outcome.kind === 'awaiting_input') {
          cleanup.suspended = true;
          this.interactiveCommands.set(cleanup.binding.terminalId, {
            binding: cleanup.binding,
            command,
            cwd,
            nonce,
            conversationId: ctx.conversationId,
            ...(ctx.ownerId ? { ownerId: ctx.ownerId } : {}),
            toolCallId: ctx.toolCallId,
          });
          state.progressState = 'awaiting_input';
          state.result = {
            success: true,
            output: `${outcome.output}\n\nCommand is waiting for terminal input. Ask for approval before responding.`,
            metadata: {
              cwd,
              terminalId: cleanup.binding.terminalId,
              sequence: outcome.sequence,
              awaitingInput: true,
            },
          };
          break;
        }
        if (outcome.kind === 'background_ready') {
          state.progressState = 'background';
          state.result = {
            success: true,
            output: outcome.output || 'Background process started.',
            metadata: {
              cwd,
              exitCode: null,
              terminalId: cleanup.binding.terminalId,
              background: true,
              sequence: outcome.sequence,
              commandBaselineSequence,
            },
          };
          break;
        }
        await delay(POLL_MS);
      }

      if (!state.result) {
        const parsed = watch.parsed();
        const output = parsed.output;
        if (ctx.signal.aborted) {
          const stop = await startStop();
          cleanup.stopResult = stop;
          state.sequence = watch.sequence;
          if (stop.status === 'stopped') {
            state.progressState = 'cancelled';
            state.result = {
              success: false,
              output,
              error: 'Command cancelled.',
              metadata: {
                terminalId: cleanup.binding.terminalId,
                cancelled: true,
                stopStatus: stop.status,
                stopFailures: stop.failures,
              },
            };
          } else {
            state.progressState = 'error';
            state.failure = stop.failures[0] ?? {
              operation: 'kill',
              message: `Cancellation cleanup was not confirmed (${stop.status}).`,
            };
            state.result = {
              success: false,
              output,
              error: `Command cancellation was not confirmed: ${state.failure.message}`,
              metadata: {
                terminalId: cleanup.binding.terminalId,
                cancelled: true,
                cancellationPartial: true,
                stopStatus: stop.status,
                stopFailures: stop.failures,
              },
            };
          }
        } else {
          const exitedBeforeCompletion = watch.hasExited && !parsed.complete;
          if (state.timedOut || !watch.hasExited || watch.commandFailure) {
            const stop = await startStop();
            cleanup.stopResult = stop;
            if (stop.status !== 'stopped') {
              state.failure = stop.failures[0] ?? {
                operation: 'kill',
                message: `Terminal cleanup was not confirmed (${stop.status}).`,
              };
            }
          }
          state.progressState = 'error';
          state.sequence = watch.sequence;
          const baseError = watch.commandFailure?.message
            ?? (watch.truncated
              ? 'Terminal output was truncated before the command frame completed.'
              : exitedBeforeCompletion
                ? `Terminal process exited before the completion marker${watch.exitCode === null ? '.' : ` (exit code: ${watch.exitCode}).`}`
                : background
                  ? `Background process did not become ready within ${Math.round(waitLimit / 1000)}s.`
                  : `Command timed out after ${Math.round(waitLimit / 1000)}s.`);
          const terminalFailure = watch.commandFailure ?? (
            watch.truncated
              ? { operation: 'protocol' as const, message: baseError }
              : exitedBeforeCompletion
                ? { operation: 'wait' as const, message: baseError }
                : { operation: 'timeout' as const, message: baseError }
          );
          state.result = {
            success: false,
            output,
            error: state.failure
              ? `${baseError} Cleanup: ${state.failure.message}`
              : baseError,
            metadata: {
              cwd,
              terminalId: cleanup.binding.terminalId,
              timedOut: state.timedOut,
              exitedBeforeCompletion,
              failure: terminalFailure,
              ...(cleanup.stopResult
                ? { stopStatus: cleanup.stopResult.status, stopFailures: cleanup.stopResult.failures }
                : {}),
            },
          };
        }
      }
    } catch (error) {
      cleanup.runtimeFailure = !ctx.signal.aborted;
      if (ctx.signal.aborted) {
        const stop = await startStop();
        cleanup.stopResult = stop;
        const stopFailure = stop.status === 'stopped'
          ? null
          : stop.failures[0] ?? {
              operation: 'kill' as const,
              message: `Cancellation cleanup was not confirmed (${stop.status}).`,
            };
        state.progressState = stop.status === 'stopped' ? 'cancelled' : 'error';
        state.failure = stopFailure;
        state.result = {
          success: false,
          output: watch?.parsed().output ?? '',
          error: stopFailure ? `Command cancellation was not confirmed: ${stopFailure.message}` : 'Command cancelled.',
          metadata: {
            ...(cleanup.binding ? { terminalId: cleanup.binding.terminalId } : {}),
            cancelled: true,
            stopStatus: stop.status,
            stopFailures: stop.failures,
            ...(stopFailure ? { cancellationPartial: true, failure: stopFailure } : {}),
          },
        };
      } else {
        state.progressState = 'error';
        state.failure = asTerminalRuntimeFailure(error, operation);
        state.result = {
          success: false,
          output: watch?.parsed().output ?? '',
          error: state.failure.message,
          metadata: {
            ...(cleanup.binding ? { terminalId: cleanup.binding.terminalId } : {}),
            failure: state.failure,
          },
        };
        if (cleanup.binding) {
          const stop = await startStop();
          cleanup.stopResult = stop;
          if (stop.status !== 'stopped') {
            state.failure = stop.failures[0] ?? {
              operation: 'kill',
              message: `Terminal cleanup was not confirmed (${stop.status}).`,
            };
            state.result = {
              ...state.result,
              error: `${state.result.error} Cleanup: ${state.failure.message}`,
              metadata: {
                ...state.result.metadata,
                stopStatus: stop.status,
                stopFailures: stop.failures,
              },
            };
          }
        }
      }
    }

    cleanup.terminalExited = watch?.hasExited ?? false;
    cleanup.runtimeFailure = cleanup.runtimeFailure || (watch?.commandFailure ?? null) !== null;
    await cleanupRun(adapter, cleanup, state, ctx, background, abortHandler);
    if (cleanup.binding && state.result) {
      commandNotified = finalizeRunOutcome(
        ctx,
        cleanup.binding,
        command,
        cwd,
        background,
        watch,
        cleanup,
        state,
        commandNotified,
      );
    }
    return state.result ?? {
      success: false,
      output: '',
      error: 'Terminal command did not produce an outcome.',
    };
  }

  async respond(
    terminalId: string,
    response: string,
    timeoutMs: number,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    let baselineOutput = '';
    const interactive = this.interactiveCommands.get(terminalId);
    const adapter = ctx.terminal;
    if (!adapter) return { success: false, output: '', error: 'Terminal runtime is unavailable.' };
    if (!interactive) return { success: false, output: '', error: 'Terminal is not waiting for agent input.' };
    if (!adapter.subscribe && !ctx.listen) {
      return { success: false, output: '', error: 'Terminal event listener is unavailable.' };
    }
    if (interactive.conversationId !== ctx.conversationId || interactive.ownerId !== ctx.ownerId) {
      return { success: false, output: '', error: 'Terminal input belongs to another conversation or agent.' };
    }
    if (ctx.signal.aborted) {
      this.interactiveCommands.delete(terminalId);
      const stop = await stopOwnedCommand(adapter, terminalId, terminalAccess(ctx));
      const stopFailure = stop.status === 'stopped'
        ? null
        : stop.failures[0] ?? {
            operation: 'kill' as const,
            message: `Cancellation cleanup was not confirmed (${stop.status}).`,
          };
      return {
        success: false,
        output: '',
        error: stopFailure ? `Command cancellation was not confirmed: ${stopFailure.message}` : 'Command cancelled.',
        metadata: {
          terminalId,
          cancelled: true,
          stopStatus: stop.status,
          stopFailures: stop.failures,
          ...(stopFailure ? { cancellationPartial: true, failure: stopFailure } : {}),
        },
      };
    }


    const access = terminalAccess(ctx);
    let watch: CommandWatch | null = null;
    let unsubscribes: Array<() => void> = [];
    let stopPromise: Promise<TerminalStopResult> | null = null;
    let abortHandler: (() => void) | null = null;
    let result: ToolResult | null = null;
    let progressState: TerminalProgress['state'] = 'error';
    let failure: TerminalRuntimeFailure | null = null;
    let sequence = 0;
    let preserveInteractive = false;
    let operation: TerminalFailureOperation = 'authorize';

    const startStop = (): Promise<TerminalStopResult> => {
      stopPromise ??= stopOwnedCommand(adapter, terminalId, access);
      return stopPromise;
    };

    try {
      operation = 'authorize';
      await withTerminalDeadline(
        'authorize',
        () => authorizeTerminal(adapter, terminalId, access),
        undefined,
        ADAPTER_CALL_TIMEOUT_MS,
      );
      if (ctx.signal.aborted) {
        throw new TerminalValidationError({ operation: 'timeout', message: 'Command cancelled.' });
      }
      operation = 'snapshot';
      const baseline = await withTerminalDeadline(
        'snapshot',
        () => adapter.snapshot(terminalId).then((value) => validateTerminalSnapshot(value)),
        undefined,
        ADAPTER_CALL_TIMEOUT_MS,
      );
      const current = parseTerminalFrame(baseline.data, interactive.nonce);
      baselineOutput = current.output;
      if (!baseline.alive || baseline.failure || current.protocolError || !looksLikeTerminalPrompt(current.output)) {
        this.interactiveCommands.delete(terminalId);
        throw new TerminalValidationError(
          baseline.failure
            ?? {
              operation: current.protocolError ? 'protocol' : 'event',
              message: current.protocolError ?? 'Terminal is no longer waiting for input.',
            },
        );
      }
      if (ctx.signal.aborted) {
        throw new TerminalValidationError({ operation: 'timeout', message: 'Command cancelled.' });
      }
      if (isSensitiveTerminalPrompt(current.output)) {
        this.interactiveCommands.delete(terminalId);

        return {
          success: false,
          output: current.output,
          error: 'Sensitive terminal prompts must be answered directly by the user.',
        };
      }

      watch = new CommandWatch({
        nonce: interactive.nonce,
        background: false,
        readyPattern: null,
        startedAt: Date.now(),
      });
      watch.syncFullSnapshot(baseline);
      watch.markCommandBaseline({ preserveOutput: true });
      const baselineChars = watch.output().length;
      let lastSequence = baseline.toSequence;
      const onData = (data: string, nextSequence: number): void => {
        if (!watch || nextSequence <= lastSequence) return;
        lastSequence = nextSequence;
        if (watch.pushData(nextSequence, data)) {
          emitProgress(ctx, interactive.binding, 'running', data, nextSequence);
        }
      };
      const onExit = (code: number | null, exitFailure?: TerminalRuntimeFailure | null): void => {
        watch?.pushExit(code, exitFailure);
      };
      const subscribe = async (): Promise<void> => {
        if (adapter.subscribe) {
          operation = 'subscribe';
          const unsubscribe = await withTerminalDeadline(
            'subscribe',
            () => adapter.subscribe!(terminalId, onData, onExit),
            (lateUnsubscribe) => {
              try {
                lateUnsubscribe();
              } catch (error) {
                console.error('[terminal-runtime] Late adapter subscription cleanup failed.', error);
              }
            },
            ADAPTER_CALL_TIMEOUT_MS,
          );
          unsubscribes.push(unsubscribe);
          return;
        }
        const listen = ctx.listen;
        if (!listen) throw new Error('Terminal event listener is unavailable.');
        operation = 'subscribe';
        const unlistenData = await withTerminalDeadline(
          'subscribe',
          () => listen('pty:data', (payload) => {
            if (!isTerminalRecord(payload) || payload.pty_id !== interactive.binding.ptyId) return;
            try {
              const event = validateTerminalDataEvent(payload);
              onData(event.data, event.sequence);
            } catch (error) {
              watch?.pushFailure(asTerminalRuntimeFailure(error, 'event'));
            }
          }),
          (lateUnsubscribe) => {
            try {
              lateUnsubscribe();
            } catch (error) {
              console.error('[terminal-runtime] Late data subscription cleanup failed.', error);
            }
          },
          ADAPTER_CALL_TIMEOUT_MS,
        );
        unsubscribes.push(unlistenData);
        const unlistenExit = await withTerminalDeadline(
          'subscribe',
          () => listen('pty:exit', (payload) => {
            if (!isTerminalRecord(payload) || payload.pty_id !== interactive.binding.ptyId) return;
            try {
              const event = validateTerminalExitEvent(payload);
              onExit(event.code, event.failure);
            } catch (error) {
              watch?.pushFailure(asTerminalRuntimeFailure(error, 'event'));
            }
          }),
          (lateUnsubscribe) => {
            try {
              lateUnsubscribe();
            } catch (error) {
              console.error('[terminal-runtime] Late exit subscription cleanup failed.', error);
            }
          },
          ADAPTER_CALL_TIMEOUT_MS,
        );
        unsubscribes.push(unlistenExit);
      };

      abortHandler = () => {
        void startStop().catch((error: unknown) => {
          console.error('[terminal-runtime] Abort cleanup failed.', error);
        });
      };
      ctx.signal.addEventListener('abort', abortHandler, { once: true });
      emitProgress(ctx, interactive.binding, 'running', '', baseline.toSequence);
      await subscribe();
      if (ctx.signal.aborted) {
        throw new TerminalValidationError({ operation: 'timeout', message: 'Command cancelled.' });
      }
      operation = 'write';
      await withTerminalDeadline(
        'write',
        () => adapter.write(terminalId, `${response}\r\n`),
        () => {
          void startStop().catch((error: unknown) => {
            console.error('[terminal-runtime] Late response cleanup failed.', error);
          });
        },
        ADAPTER_CALL_TIMEOUT_MS,
      );
      const startedAt = Date.now();
      let exitDrainStartedAt: number | null = null;
      while (!result && !ctx.signal.aborted) {
        const now = Date.now();
        if (watch.hasExited) {
          exitDrainStartedAt ??= now;
          if (now - exitDrainStartedAt >= EXIT_DRAIN_GRACE_MS) break;
        } else if (now - startedAt >= timeoutMs) {
          break;
        }
        operation = 'snapshot';
        const snapshot = await withTerminalDeadline(
          'snapshot',
          () => adapter.snapshot(terminalId).then((value) => validateTerminalSnapshot(value)),
          undefined,
          ADAPTER_CALL_TIMEOUT_MS,
        );
        watch.syncFullSnapshot(snapshot);
        sequence = watch.sequence;
        const outcome = watch.evaluate(Date.now(), baselineChars);
        if (outcome.kind === 'complete') {
          this.interactiveCommands.delete(terminalId);
          progressState = outcome.exitCode === 0 ? 'complete' : 'error';
          result = {
            success: outcome.exitCode === 0,
            output: outcome.output,
            error: outcome.exitCode !== 0 ? `Exit code: ${outcome.exitCode}` : undefined,
            metadata: { terminalId, exitCode: outcome.exitCode, awaitingInput: false, sequence },
          };
          break;
        }
        if (outcome.kind === 'error') {
          const canDrain = watch.hasExited
            && !watch.commandFailure
            && !watch.parsed().protocolError
            && exitDrainStartedAt !== null
            && Date.now() - exitDrainStartedAt < EXIT_DRAIN_GRACE_MS;
          if (!canDrain) {
            this.interactiveCommands.delete(terminalId);
            progressState = 'error';
            failure = outcome.failure;
            result = {
              success: false,
              output: outcome.output,
              error: outcome.failure.message,
              metadata: { terminalId, timedOut: false, exitedBeforeCompletion: watch.hasExited, failure: outcome.failure },
            };
            break;
          }
        }
        if (outcome.kind === 'awaiting_input') {
          preserveInteractive = true;
          progressState = 'awaiting_input';
          result = {
            success: true,
            output: `${watch.output().slice(baselineChars)}\n\nCommand is waiting for more terminal input.`,
            metadata: { terminalId, sequence, awaitingInput: true },
          };
          break;
        }
        await delay(POLL_MS);
      }

      if (!result) {
        this.interactiveCommands.delete(terminalId);
        const output = watch.output();
        if (ctx.signal.aborted) {
          const stop = await startStop();
          progressState = stop.status === 'stopped' ? 'cancelled' : 'error';
          failure = stop.status === 'stopped'
            ? null
            : stop.failures[0] ?? { operation: 'kill', message: `Cancellation cleanup was not confirmed (${stop.status}).` };
          result = {
            success: false,
            output,
            error: failure ? `Command cancellation was not confirmed: ${failure.message}` : 'Command cancelled.',
            metadata: {
              terminalId,
              cancelled: true,
              ...(failure ? { cancellationPartial: true, failure } : {}),
              stopStatus: stop.status,
              stopFailures: stop.failures,
            },
          };
        } else if (watch.hasExited || watch.commandFailure) {
          const parsed = watch.parsed();
          progressState = 'error';
          failure = watch.commandFailure ?? {
            operation: 'event',
            message: `Terminal process exited before the completion marker${watch.exitCode === null ? '.' : ` (exit code: ${watch.exitCode}).`}`,
          };
          result = {
            success: false,
            output: parsed.output,
            error: failure.message,
            metadata: { terminalId, timedOut: false, exitedBeforeCompletion: true, failure },
          };
        } else {
          preserveInteractive = true;
          progressState = 'awaiting_input';
          result = {
            success: true,
            output: 'Input was sent. The command is still running.',
            metadata: { terminalId, sequence: lastSequence, awaitingInput: true },
          };
        }
      }
    } catch (error) {
      this.interactiveCommands.delete(terminalId);
      const output = watch?.parsed().output ?? baselineOutput;
      if (ctx.signal.aborted) {
        const stop = await startStop();
        const stopFailure = stop.status === 'stopped'
          ? null
          : stop.failures[0] ?? { operation: 'kill' as const, message: `Cancellation cleanup was not confirmed (${stop.status}).` };
        progressState = stop.status === 'stopped' ? 'cancelled' : 'error';
        failure = stopFailure;
        result = {
          success: false,
          output,
          error: stopFailure ? `Command cancellation was not confirmed: ${stopFailure.message}` : 'Command cancelled.',
          metadata: {
            terminalId,
            cancelled: true,
            stopStatus: stop.status,
            stopFailures: stop.failures,
            ...(stopFailure ? { cancellationPartial: true, failure: stopFailure } : {}),
          },
        };
      } else {
        progressState = 'error';
        failure = asTerminalRuntimeFailure(error, operation);
        result = {
          success: false,
          output,
          error: failure.message,
          metadata: { terminalId, failure },
        };
        if (!preserveInteractive) {
          const stop = await startStop();
          if (stop.status !== 'stopped') {
            failure = stop.failures[0] ?? { operation: 'kill', message: `Terminal cleanup was not confirmed (${stop.status}).` };
            result = {
              ...result,
              error: `${result.error} Cleanup: ${failure.message}`,
            };
          }
          result = {
            ...result,
            metadata: { ...result.metadata, stopStatus: stop.status, stopFailures: stop.failures },
          };
        }
      }
    } finally {
      for (const unsubscribe of unsubscribes.splice(0).reverse()) {
        try {
          unsubscribe();
        } catch (error) {
          failure ??= asTerminalRuntimeFailure(error, 'subscribe');
        }
      }
      if (abortHandler) ctx.signal.removeEventListener('abort', abortHandler);
      if (failure && preserveInteractive) {
        this.interactiveCommands.delete(terminalId);
        preserveInteractive = false;
      }
      if (!preserveInteractive) {
        try {
          adapter.release?.(terminalId, interactive.toolCallId);
        } catch (error) {
          failure ??= asTerminalRuntimeFailure(error, 'release');
        }
      }
      if (failure && !preserveInteractive && !watch?.hasExited) {
        try {
          const stop = await startStop();
          if (stop.status !== 'stopped') {
            failure ??= stop.failures[0]
              ?? { operation: 'kill', message: `Terminal cleanup was not confirmed (${stop.status}).` };
          }
        } catch (error) {
          failure ??= asTerminalRuntimeFailure(error, 'kill');
        }
      }
    }

    if (failure && result) {
      result = {
        ...result,
        success: false,
        error: result.error ?? failure.message,
      };
      progressState = 'error';
    }
    if (result) {
      const existingMetadata = result.metadata ?? {};
      result = {
        ...result,
        metadata: {
          ...existingMetadata,
          terminalId,
          terminalState: progressState,
          ...(failure ? { failure, awaitingInput: false } : {}),
        },
      };
      if (progressState === 'awaiting_input') {
        emitProgress(ctx, interactive.binding, 'awaiting_input', '', sequence);
      } else {
        emitProgress(ctx, interactive.binding, progressState as FinalProgressState, '', sequence, failure);
      }
    }
    return result ?? { success: false, output: '', error: 'Terminal response did not produce an outcome.' };
  }
}

export type TerminalCommandInput = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  forceNew?: boolean;
  sessionName?: string;
  background?: boolean;
  readyPattern?: string;
  startupTimeoutMs?: number;
};

function emitProgress(
  ctx: ToolExecutionContext,
  binding: TerminalBinding,
  state: TerminalProgress['state'],
  chunk = '',
  sequence = 0,
  failure?: TerminalRuntimeFailure | null,
): void {
  try {
    ctx.onTerminalProgress?.({
      toolCallId: ctx.toolCallId,
      terminalId: binding.terminalId,
      sequence,
      chunk,
      state,
      ...(failure ? { failure } : {}),
    });
  } catch (error) {
    console.error('[terminal-runtime] Terminal progress callback failed.', error);
  }
}

function isFinalProgressState(state: TerminalProgress['state']): state is FinalProgressState {
  return state === 'complete' || state === 'error' || state === 'cancelled' || state === 'background';
}

function safeTerminalCommand(
  ctx: ToolExecutionContext,
  command: string,
  output: string,
  exitCode: number | null,
): void {
  try {
    ctx.onTerminalCommand?.(command, output, exitCode);
  } catch (error) {
    console.error('[terminal-runtime] Terminal command notification failed.', error);
  }
}
function finalizeRunOutcome(
  ctx: ToolExecutionContext,
  binding: TerminalBinding,
  command: string,
  cwd: string,
  background: boolean,
  watch: CommandWatch | null,
  cleanup: CleanupState,
  state: RunState,
  commandNotified: boolean,
): boolean {
  if (!state.result) return commandNotified;
  state.sequence = watch?.sequence ?? state.sequence;
  if (state.failure) {
    state.result = {
      ...state.result,
      success: false,
      error: state.result.error ?? state.failure.message,
    };
    state.progressState = 'error';
  }
  const existingMetadata = state.result.metadata ?? {};
  state.result = {
    ...state.result,
    metadata: {
      ...existingMetadata,
      terminalId: binding.terminalId,
      terminalState: state.progressState,
      cwd,
      background,
      ...(!Object.prototype.hasOwnProperty.call(existingMetadata, 'exitCode')
        ? { exitCode: watch?.exitCode ?? null }
        : {}),
      ...(state.failure ? { failure: state.failure } : {}),
      ...(cleanup.stopResult
        ? { stopStatus: cleanup.stopResult.status, stopFailures: cleanup.stopResult.failures }
        : {}),
    },
  };
  if (cleanup.commandSent && state.progressState !== 'awaiting_input' && !commandNotified) {
    safeTerminalCommand(ctx, command, watch?.parsed().output ?? '', watch?.exitCode ?? null);
    commandNotified = true;
  }
  if (isFinalProgressState(state.progressState) && !cleanup.finalStateEmitted) {
    cleanup.finalStateEmitted = true;
    emitProgress(ctx, binding, state.progressState, '', state.sequence, state.failure);
  } else if (state.progressState === 'awaiting_input') {
    emitProgress(ctx, binding, 'awaiting_input', '', state.sequence);
  }
  return commandNotified;
}

async function cleanupRun(
  adapter: TerminalRuntimeAdapter,
  cleanup: CleanupState,
  state: RunState,
  ctx: ToolExecutionContext,
  background: boolean,
  abortHandler: (() => void) | null,
): Promise<void> {
  for (const unsubscribe of cleanup.unsubscribes.splice(0).reverse()) {
    try {
      unsubscribe();
    } catch (error) {
      appendCleanupFailure(state, asTerminalRuntimeFailure(error, 'subscribe'));
    }
  }
  if (abortHandler) ctx.signal.removeEventListener('abort', abortHandler);
  if (!cleanup.binding) return;
  const needsFailureStop = (cleanup.runtimeFailure || state.timedOut)
    && !cleanup.suspended
    && cleanup.stopResult?.status !== 'stopped';
  const needsForegroundKill = !cleanup.binding.persistent
    && !background
    && !cleanup.suspended
    && !cleanup.terminalExited;
  if (needsFailureStop && !cleanup.stopPromise) {
    cleanup.stopPromise = stopOwnedCommand(adapter, cleanup.binding.terminalId, terminalAccess(ctx))
      .then((stop) => {
        cleanup.stopResult = stop;
        return stop;
      });
  }
  const needsExistingStop = cleanup.stopPromise !== null;
  if (needsFailureStop || needsForegroundKill || needsExistingStop) {
    try {
      const stop = await (cleanup.stopPromise ?? withTerminalDeadline(
        'kill',
        () => adapter.kill(cleanup.binding!.terminalId).then((value) => validateTerminalStopResult(value)),
        (lateStop) => {
          if (lateStop.status !== 'stopped' || lateStop.failures.length > 0) {
            console.error('[terminal-runtime] Late cleanup stop was not cleanly confirmed.', lateStop);
          }
        },
        STOP_CALL_TIMEOUT_MS,
      ));
      cleanup.stopResult = stop;
      if (stop.status !== 'stopped') {
        appendCleanupFailure(
          state,
          stop.failures[0] ?? { operation: 'kill', message: `Terminal cleanup was not confirmed (${stop.status}).` },
        );
      }
    } catch (error) {
      appendCleanupFailure(state, asTerminalRuntimeFailure(error, 'kill'));
    }
  }
  try {
    adapter.release?.(cleanup.binding.terminalId, ctx.toolCallId);
  } catch (error) {
    appendCleanupFailure(state, asTerminalRuntimeFailure(error, 'release'));
  }
}

function appendCleanupFailure(state: RunState, failure: TerminalRuntimeFailure): void {
  state.failure ??= failure;
}

function terminalAccess(ctx: ToolExecutionContext): TerminalAccess {
  return {
    conversationId: ctx.conversationId,
    ...(ctx.ownerId ? { ownerId: ctx.ownerId } : {}),
    ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
    source: 'agent',
  };
}

async function authorizeTerminal(
  adapter: TerminalRuntimeAdapter,
  terminalId: string,
  access?: TerminalAccess,
): Promise<void> {
  await adapter.authorize?.(terminalId, access ?? {
    conversationId: '',
    source: 'agent',
  });
}

export function withTerminalDeadline<T>(
  operation: TerminalFailureOperation,
  task: () => Promise<T> | T,
  onLate: ((value: T) => void | Promise<void>) | undefined,
  timeoutMs: number,
): Promise<T> {
  let timedOut = false;
  let settled = false;
  const operationPromise = Promise.resolve().then(task);
  operationPromise.then(
    (value) => {
      if (timedOut && onLate) {
        void Promise.resolve(onLate(value)).catch((error: unknown) => {
          console.error(`[terminal-runtime] Late ${operation} cleanup failed.`, error);
        });
      }
    },
    (error: unknown) => {
      if (timedOut) {
        console.error(`[terminal-runtime] Late ${operation} operation failed.`, error);
      }
    },
  );
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      settled = true;
      reject(new TerminalValidationError({
        operation: 'timeout',
        message: `Terminal ${operation} operation timed out after ${timeoutMs}ms.`,
      }));
    }, timeoutMs);
    operationPromise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}


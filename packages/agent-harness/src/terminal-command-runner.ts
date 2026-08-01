import type {
  TerminalBinding,
  TerminalProgress,
  TerminalRuntimeAdapter,
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
import { resolveWorkspacePath } from './path-policy';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const INTERRUPT_GRACE_MS = 750;
const POLL_MS = 50;

type SuspendedCommand = {
  binding: TerminalBinding;
  command: string;
  cwd: string;
  nonce: string;
};

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

type PtyData = { pty_id: string; sequence?: number; data: string };
type PtyExit = { pty_id: string; sequence?: number; code: number | null };

function emitProgress(
  ctx: ToolExecutionContext,
  binding: TerminalBinding,
  state: TerminalProgress['state'],
  chunk = '',
  sequence = 0,
): void {
  ctx.onTerminalProgress?.({
    toolCallId: ctx.toolCallId,
    terminalId: binding.terminalId,
    sequence,
    chunk,
    state,
  });
}

/** Interrupt a command and escalate to killing an unresponsive PTY (ADR-0002/0004). */
export async function stopCommand(
  adapter: TerminalRuntimeAdapter,
  terminalId: string,
): Promise<void> {
  await adapter.interrupt(terminalId).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, INTERRUPT_GRACE_MS));
  const snapshot = await adapter.snapshot(terminalId).catch(() => null);
  if (snapshot?.alive) await adapter.kill(terminalId).catch(() => undefined);
}

export class TerminalCommandRunner {
  private readonly interactiveCommands = new Map<string, SuspendedCommand>();

  async run(input: TerminalCommandInput, ctx: ToolExecutionContext): Promise<ToolResult> {
    const adapter = ctx.terminal;
    if (!adapter) {
      return { success: false, output: '', error: 'Terminal runtime is unavailable.' };
    }
    if (!ctx.listen) {
      return { success: false, output: '', error: 'Terminal event listener is unavailable.' };
    }

    const command = input.command;
    const cwd = input.cwd ? resolveWorkspacePath(input.cwd, ctx.workspacePath) : ctx.workspacePath;
    const background = Boolean(input.background);
    const binding = await adapter.acquire({
      conversationId: ctx.conversationId,
      toolCallId: ctx.toolCallId,
      cwd,
      forceNew: Boolean(input.forceNew) || background,
      sessionName: input.sessionName,
      background,
      ownerId: ctx.ownerId,
    });
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const frame = buildTerminalFrame(command, binding.frameLanguage, nonce);
    const startedAt = Date.now();
    const watch = new CommandWatch({
      nonce,
      background,
      readyPattern: input.readyPattern ? new RegExp(input.readyPattern) : null,
      startedAt,
    });
    let suspended = false;
    const unsubscribes: Array<() => void> = [];
    const abort = () => void stopCommand(adapter, binding.terminalId);
    ctx.signal.addEventListener('abort', abort, { once: true });
    const listen = ctx.listen;

    // Prefer the adapter's replay-capable stream; fall back to raw events for
    // adapters that only expose the generic event bus.
    const subscribeToStream = async (): Promise<void> => {
      if (adapter.subscribe) {
        unsubscribes.push(
          await adapter.subscribe(
            binding.terminalId,
            (data, sequence) => {
              watch.pushData(sequence, data);
              emitProgress(ctx, binding, 'running', data, sequence);
            },
            (code) => watch.pushExit(code),
          ),
        );
        return;
      }
      const unlistenData = await listen('pty:data', (payload) => {
        const event = payload as PtyData;
        if (event.pty_id !== binding.ptyId) return;
        const sequence = event.sequence ?? watch.sequence + 1;
        watch.pushData(sequence, event.data);
        emitProgress(ctx, binding, 'running', event.data, sequence);
      });
      const unlistenExit = await listen('pty:exit', (payload) => {
        const event = payload as PtyExit;
        if (event.pty_id !== binding.ptyId) return;
        watch.pushExit(event.code);
      });
      unsubscribes.push(unlistenData, unlistenExit);
    };

    try {
      emitProgress(ctx, binding, 'started');
      await subscribeToStream();
      await adapter.write(binding.terminalId, frame);
      const waitLimit = background
        ? (input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)
        : (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      while (Date.now() - startedAt < waitLimit && !ctx.signal.aborted) {
        const outcome = watch.evaluate(Date.now());
        if (outcome.kind === 'complete') {
          this.interactiveCommands.delete(binding.terminalId);
          ctx.onTerminalCommand?.(command, outcome.output, outcome.exitCode);
          emitProgress(ctx, binding, outcome.exitCode === 0 ? 'complete' : 'error');
          return {
            success: outcome.exitCode === 0,
            output: outcome.output || `Command completed with exit code ${outcome.exitCode}`,
            error: outcome.exitCode !== 0 ? `Exit code: ${outcome.exitCode}` : undefined,
            metadata: {
              cwd,
              exitCode: outcome.exitCode,
              terminalId: binding.terminalId,
              background: false,
            },
          };
        }
        if (outcome.kind === 'awaiting_input') {
          suspended = true;
          this.interactiveCommands.set(binding.terminalId, {
            binding,
            command,
            cwd,
            nonce,
          });
          emitProgress(ctx, binding, 'awaiting_input', '', outcome.sequence);
          return {
            success: true,
            output: `${outcome.output}\n\nCommand is waiting for terminal input. Ask for approval before responding.`,
            metadata: {
              cwd,
              terminalId: binding.terminalId,
              sequence: outcome.sequence,
              awaitingInput: true,
            },
          };
        }
        if (outcome.kind === 'background_ready') {
          ctx.onTerminalCommand?.(command, outcome.output, null);
          emitProgress(ctx, binding, 'background');
          return {
            success: true,
            output: outcome.output || 'Background process started.',
            metadata: {
              cwd,
              exitCode: null,
              terminalId: binding.terminalId,
              background: true,
              sequence: outcome.sequence,
            },
          };
        }
        if (watch.hasExited) break;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }

      const parsed = watch.parsed();
      if (ctx.signal.aborted) {
        emitProgress(ctx, binding, 'cancelled');
        ctx.onTerminalCommand?.(command, parsed.output, null);
        return { success: false, output: parsed.output, error: 'Command cancelled.' };
      }

      await stopCommand(adapter, binding.terminalId);
      emitProgress(ctx, binding, 'error');
      ctx.onTerminalCommand?.(command, parsed.output, watch.exitCode);
      return {
        success: false,
        output: parsed.output,
        error: background
          ? `Background process did not become ready within ${Math.round(waitLimit / 1000)}s.`
          : `Command timed out after ${Math.round(waitLimit / 1000)}s.`,
        metadata: { cwd, terminalId: binding.terminalId, timedOut: !watch.hasExited },
      };
    } catch (error) {
      emitProgress(ctx, binding, 'error');
      return { success: false, output: '', error: String(error) };
    } finally {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      ctx.signal.removeEventListener('abort', abort);
      adapter.release?.(binding.terminalId, ctx.toolCallId);
      if (!binding.persistent && !background && !suspended) {
        await adapter.kill(binding.terminalId).catch(() => undefined);
      }
    }
  }

  async respond(
    terminalId: string,
    response: string,
    timeoutMs: number,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const interactive = this.interactiveCommands.get(terminalId);
    const adapter = ctx.terminal;
    if (!adapter) {
      return { success: false, output: '', error: 'Terminal runtime is unavailable.' };
    }
    if (!interactive) {
      return { success: false, output: '', error: 'Terminal is not waiting for agent input.' };
    }
    if (!ctx.listen) {
      return { success: false, output: '', error: 'Terminal event listener is unavailable.' };
    }

    const baseline = await adapter.snapshot(terminalId);
    const current = parseTerminalFrame(baseline.data, interactive.nonce);
    if (!looksLikeTerminalPrompt(current.output)) {
      this.interactiveCommands.delete(terminalId);
      return { success: false, output: '', error: 'Terminal is no longer waiting for input.' };
    }
    if (isSensitiveTerminalPrompt(current.output)) {
      return {
        success: false,
        output: current.output,
        error: 'Sensitive terminal prompts must be answered directly by the user.',
      };
    }

    const baselineChars = baseline.data.length;
    const watch = new CommandWatch({
      nonce: interactive.nonce,
      background: false,
      readyPattern: null,
      startedAt: Date.now(),
    });
    watch.syncSnapshot(baseline.data, baseline.toSequence);
    let lastSequence = baseline.toSequence;
    const unlistenData = await ctx.listen('pty:data', (payload) => {
      const event = payload as PtyData;
      if (event.pty_id !== interactive.binding.ptyId) return;
      lastSequence = event.sequence ?? lastSequence + 1;
      emitProgress(ctx, interactive.binding, 'running', event.data, lastSequence);
    });
    const unlistenExit = await ctx.listen('pty:exit', (payload) => {
      const event = payload as PtyExit;
      if (event.pty_id !== interactive.binding.ptyId) return;
      watch.pushExit(event.code);
    });

    try {
      emitProgress(ctx, interactive.binding, 'running', '', lastSequence);
      await adapter.write(terminalId, `${response}\r\n`);
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs && !ctx.signal.aborted) {
        const snapshot = await adapter.snapshot(terminalId);
        watch.syncSnapshot(snapshot.data, snapshot.toSequence);
        const outcome = watch.evaluate(Date.now(), baselineChars);
        if (outcome.kind === 'complete') {
          this.interactiveCommands.delete(terminalId);
          emitProgress(ctx, interactive.binding, outcome.exitCode === 0 ? 'complete' : 'error');
          ctx.onTerminalCommand?.(interactive.command, outcome.output, outcome.exitCode);
          return {
            success: outcome.exitCode === 0,
            output: outcome.output,
            error: outcome.exitCode !== 0 ? `Exit code: ${outcome.exitCode}` : undefined,
            metadata: { terminalId, exitCode: outcome.exitCode, awaitingInput: false },
          };
        }
        if (outcome.kind === 'awaiting_input') {
          const newOutput = watch.output().slice(baselineChars);
          emitProgress(ctx, interactive.binding, 'awaiting_input', '', outcome.sequence);
          return {
            success: true,
            output: `${newOutput}\n\nCommand is waiting for more terminal input.`,
            metadata: { terminalId, sequence: outcome.sequence, awaitingInput: true },
          };
        }
        if (watch.hasExited) break;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      if (ctx.signal.aborted) return { success: false, output: '', error: 'Command cancelled.' };
      emitProgress(ctx, interactive.binding, 'awaiting_input', '', lastSequence);
      return {
        success: true,
        output: 'Input was sent. The command is still running.',
        metadata: { terminalId, sequence: lastSequence, awaitingInput: true },
      };
    } finally {
      unlistenData();
      unlistenExit();
    }
  }
}

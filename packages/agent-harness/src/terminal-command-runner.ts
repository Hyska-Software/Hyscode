import type {
  TerminalBinding,
  TerminalProgress,
  TerminalRuntimeAdapter,
  TerminalSnapshot,
  ToolExecutionContext,
  ToolResult,
} from './types';
import { resolveWorkspacePath } from './path-policy';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const INTERRUPT_GRACE_MS = 750;
const MAX_CAPTURE_CHARS = 1024 * 1024;
const PROMPT_IDLE_MS = 400;

type InteractiveCommand = {
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

function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
}

function appendBounded(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length <= MAX_CAPTURE_CHARS ? next : next.slice(-MAX_CAPTURE_CHARS);
}

export function looksLikeTerminalPrompt(output: string): boolean {
  const line = stripAnsi(output)
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) return false;
  return /(?:\?|:\s*$|\[(?:y\/n|Y\/n|yes\/no)\]\s*$|\((?:y\/n|yes\/no)\)\s*$|password\s*:|passphrase\s*:|press (?:enter|return)|select (?:an? )?(?:option|choice)|enter (?:a )?(?:value|choice|number|name))/i.test(
    line,
  );
}

export function isSensitiveTerminalPrompt(output: string): boolean {
  const tail = stripAnsi(output).slice(-1_000);
  return /(?:password|passphrase|secret|api[_ -]?key|access[_ -]?token|mfa|one[- ]time|verification code|captcha)/i.test(
    tail,
  );
}

export function buildTerminalFrame(command: string, windows: boolean, nonce: string): string {
  const begin = `__HYSCODE_BEGIN_${nonce}__`;
  const end = `__HYSCODE_END_${nonce}__`;
  if (windows) {
    return (
      `$global:LASTEXITCODE = 0; Write-Output '${begin}'; & { ${command} }; ` +
      `$hysOk = $?; $hysCode = if ($hysOk) { [int]$LASTEXITCODE } ` +
      `elseif ($LASTEXITCODE -ne 0) { [int]$LASTEXITCODE } else { 1 }; ` +
      `Write-Output (\"${end}:{0}\" -f $hysCode)\r\n`
    );
  }
  return `printf '\\n${begin}\\n'; ${command}; hys_code=$?; printf '\\n${end}:%s\\n' \"$hys_code\"\n`;
}

export type ParsedTerminalFrame = {
  complete: boolean;
  output: string;
  exitCode: number | null;
  started: boolean;
};

export function parseTerminalFrame(raw: string, nonce: string): ParsedTerminalFrame {
  const begin = `__HYSCODE_BEGIN_${nonce}__`;
  const end = `__HYSCODE_END_${nonce}__`;
  const lines = stripAnsi(raw).split('\n');
  const beginIndex = lines.findIndex((line) => line.trim() === begin);
  if (beginIndex < 0) return { complete: false, output: '', exitCode: null, started: false };

  const endPattern = new RegExp(`^${end}:(-?\\d+)$`);
  for (let index = beginIndex + 1; index < lines.length; index++) {
    const match = lines[index].trim().match(endPattern);
    if (!match) continue;
    return {
      complete: true,
      output: lines
        .slice(beginIndex + 1, index)
        .join('\n')
        .trim(),
      exitCode: Number.parseInt(match[1], 10),
      started: true,
    };
  }
  return {
    complete: false,
    output: lines
      .slice(beginIndex + 1)
      .join('\n')
      .trim(),
    exitCode: null,
    started: true,
  };
}

function fallbackAdapter(ctx: ToolExecutionContext): TerminalRuntimeAdapter {
  const ptyByTerminal = new Map<string, string>();
  return {
    async acquire(request) {
      const preferred = !request.forceNew ? ctx.agentTerminalPtyId : undefined;
      const preferredAlive = preferred
        ? await ctx.invoke<boolean>('pty_exists', { ptyId: preferred }).catch(() => false)
        : false;
      const ptyId = preferredAlive
        ? preferred!
        : await ctx.invoke<string>('pty_spawn', { cwd: request.cwd });
      ptyByTerminal.set(ptyId, ptyId);
      return { terminalId: ptyId, ptyId, persistent: preferredAlive };
    },
    async snapshot(terminalId, afterSequence) {
      const snapshot = await ctx.invoke<{
        data: string;
        from_sequence: number;
        to_sequence: number;
        truncated: boolean;
        alive: boolean;
        exit_code: number | null;
      }>('pty_snapshot', { ptyId: ptyByTerminal.get(terminalId) ?? terminalId, afterSequence });
      return {
        data: snapshot.data,
        fromSequence: snapshot.from_sequence,
        toSequence: snapshot.to_sequence,
        truncated: snapshot.truncated,
        alive: snapshot.alive,
        exitCode: snapshot.exit_code,
      };
    },
    async write(terminalId, data) {
      await ctx.invoke('pty_write', {
        ptyId: ptyByTerminal.get(terminalId) ?? terminalId,
        data,
      });
    },
    async interrupt(terminalId) {
      await ctx.invoke('pty_interrupt', { ptyId: ptyByTerminal.get(terminalId) ?? terminalId });
    },
    async kill(terminalId) {
      await ctx.invoke('pty_kill', { ptyId: ptyByTerminal.get(terminalId) ?? terminalId });
    },
  };
}

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

async function stopCommand(adapter: TerminalRuntimeAdapter, terminalId: string): Promise<void> {
  await adapter.interrupt(terminalId).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, INTERRUPT_GRACE_MS));
  const snapshot = await adapter.snapshot(terminalId).catch(() => null);
  if (snapshot?.alive) await adapter.kill(terminalId).catch(() => undefined);
}

export class TerminalCommandRunner {
  private readonly interactiveCommands = new Map<string, InteractiveCommand>();

  async run(input: TerminalCommandInput, ctx: ToolExecutionContext): Promise<ToolResult> {
    if (!ctx.listen) {
      return { success: false, output: '', error: 'Terminal event listener is unavailable.' };
    }

    const command = input.command;
    const cwd = input.cwd ? resolveWorkspacePath(input.cwd, ctx.workspacePath) : ctx.workspacePath;
    const background = Boolean(input.background);
    const adapter = ctx.terminal ?? fallbackAdapter(ctx);
    const binding = await adapter.acquire({
      conversationId: ctx.conversationId,
      toolCallId: ctx.toolCallId,
      cwd,
      forceNew: Boolean(input.forceNew) || background,
      sessionName: input.sessionName,
      background,
    });
    const windows = typeof navigator !== 'undefined' && navigator.userAgent?.includes('Win');
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const frame = buildTerminalFrame(command, windows, nonce);
    let rawOutput = '';
    let exited = false;
    let processExitCode: number | null = null;
    let sequence = 0;
    let lastOutputAt = Date.now();
    let awaitingInput = false;
    emitProgress(ctx, binding, 'started');

    const unlistenData = await ctx.listen('pty:data', (payload) => {
      const event = payload as PtyData;
      if (event.pty_id !== binding.ptyId) return;
      sequence = event.sequence ?? sequence + 1;
      rawOutput = appendBounded(rawOutput, event.data);
      lastOutputAt = Date.now();
      emitProgress(ctx, binding, 'running', event.data, sequence);
    });
    const unlistenExit = await ctx.listen('pty:exit', (payload) => {
      const event = payload as PtyExit;
      if (event.pty_id !== binding.ptyId) return;
      exited = true;
      processExitCode = event.code;
    });
    const abort = () => void stopCommand(adapter, binding.terminalId);
    ctx.signal.addEventListener('abort', abort, { once: true });

    try {
      await ctx.invoke('pty_write', { ptyId: binding.ptyId, data: frame });
      const startedAt = Date.now();
      const waitLimit = background
        ? (input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)
        : (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const readyPattern = input.readyPattern ? new RegExp(input.readyPattern) : null;

      while (Date.now() - startedAt < waitLimit && !ctx.signal.aborted) {
        const parsed = parseTerminalFrame(rawOutput, nonce);
        if (parsed.complete) {
          this.interactiveCommands.delete(binding.terminalId);
          ctx.onTerminalCommand?.(command, parsed.output, parsed.exitCode);
          emitProgress(ctx, binding, parsed.exitCode === 0 ? 'complete' : 'error');
          return {
            success: parsed.exitCode === 0,
            output: parsed.output || `Command completed with exit code ${parsed.exitCode}`,
            error: parsed.exitCode !== 0 ? `Exit code: ${parsed.exitCode}` : undefined,
            metadata: {
              cwd,
              exitCode: parsed.exitCode,
              terminalId: binding.terminalId,
              background: false,
            },
          };
        }
        if (
          parsed.started &&
          looksLikeTerminalPrompt(parsed.output) &&
          Date.now() - lastOutputAt >= PROMPT_IDLE_MS
        ) {
          this.interactiveCommands.set(binding.terminalId, {
            binding,
            command,
            cwd,
            nonce,
          });
          awaitingInput = true;
          emitProgress(ctx, binding, 'awaiting_input', '', sequence);
          return {
            success: true,
            output: `${parsed.output}\n\nCommand is waiting for terminal input. Ask for approval before responding.`,
            metadata: {
              cwd,
              terminalId: binding.terminalId,
              sequence,
              awaitingInput: true,
            },
          };
        }
        if (background && parsed.started) {
          const ready = readyPattern ? readyPattern.test(parsed.output) : true;
          if (ready && Date.now() - startedAt >= 500) {
            ctx.onTerminalCommand?.(command, parsed.output, null);
            emitProgress(ctx, binding, 'background');
            return {
              success: true,
              output: parsed.output || 'Background process started.',
              metadata: {
                cwd,
                exitCode: null,
                terminalId: binding.terminalId,
                background: true,
                sequence,
              },
            };
          }
        }
        if (exited) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const parsed = parseTerminalFrame(rawOutput, nonce);
      if (ctx.signal.aborted) {
        emitProgress(ctx, binding, 'cancelled');
        ctx.onTerminalCommand?.(command, parsed.output, null);
        return { success: false, output: parsed.output, error: 'Command cancelled.' };
      }

      await stopCommand(adapter, binding.terminalId);
      emitProgress(ctx, binding, 'error');
      ctx.onTerminalCommand?.(command, parsed.output, processExitCode);
      return {
        success: false,
        output: parsed.output,
        error: background
          ? `Background process did not become ready within ${Math.round(waitLimit / 1000)}s.`
          : `Command timed out after ${Math.round(waitLimit / 1000)}s.`,
        metadata: { cwd, terminalId: binding.terminalId, timedOut: !exited },
      };
    } catch (error) {
      emitProgress(ctx, binding, 'error');
      return { success: false, output: '', error: String(error) };
    } finally {
      unlistenData();
      unlistenExit();
      ctx.signal.removeEventListener('abort', abort);
      adapter.release?.(binding.terminalId, ctx.toolCallId);
      if (!binding.persistent && !background && !awaitingInput) {
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
    const adapter = ctx.terminal ?? fallbackAdapter(ctx);
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
    let lastSequence = baseline.toSequence;
    let lastOutputAt = Date.now();
    let exited = false;
    const unlistenData = await ctx.listen('pty:data', (payload) => {
      const event = payload as PtyData;
      if (event.pty_id !== interactive.binding.ptyId) return;
      lastSequence = event.sequence ?? lastSequence + 1;
      lastOutputAt = Date.now();
      emitProgress(ctx, interactive.binding, 'running', event.data, lastSequence);
    });
    const unlistenExit = await ctx.listen('pty:exit', (payload) => {
      const event = payload as PtyExit;
      if (event.pty_id === interactive.binding.ptyId) exited = true;
    });

    try {
      emitProgress(ctx, interactive.binding, 'running', '', lastSequence);
      await adapter.write(terminalId, `${response}\r\n`);
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs && !ctx.signal.aborted) {
        const snapshot = await adapter.snapshot(terminalId);
        const parsed = parseTerminalFrame(snapshot.data, interactive.nonce);
        if (parsed.complete) {
          this.interactiveCommands.delete(terminalId);
          emitProgress(ctx, interactive.binding, parsed.exitCode === 0 ? 'complete' : 'error');
          ctx.onTerminalCommand?.(interactive.command, parsed.output, parsed.exitCode);
          return {
            success: parsed.exitCode === 0,
            output: parsed.output,
            error: parsed.exitCode !== 0 ? `Exit code: ${parsed.exitCode}` : undefined,
            metadata: { terminalId, exitCode: parsed.exitCode, awaitingInput: false },
          };
        }
        const newOutput = normalizeTerminalSnapshot(
          { ...snapshot, data: snapshot.data.slice(baseline.data.length) },
          MAX_CAPTURE_CHARS,
        );
        if (
          snapshot.toSequence > baseline.toSequence &&
          looksLikeTerminalPrompt(newOutput) &&
          Date.now() - lastOutputAt >= PROMPT_IDLE_MS
        ) {
          emitProgress(ctx, interactive.binding, 'awaiting_input', '', snapshot.toSequence);
          return {
            success: true,
            output: `${newOutput}\n\nCommand is waiting for more terminal input.`,
            metadata: { terminalId, sequence: snapshot.toSequence, awaitingInput: true },
          };
        }
        if (exited) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
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

export function normalizeTerminalSnapshot(snapshot: TerminalSnapshot, maxChars: number): string {
  const normalized = stripAnsi(snapshot.data)
    .split('\n')
    .filter((line) => !line.includes('__HYSCODE_BEGIN_') && !line.includes('__HYSCODE_END_'))
    .join('\n')
    .trim();
  return normalized.length <= maxChars ? normalized : normalized.slice(-maxChars);
}

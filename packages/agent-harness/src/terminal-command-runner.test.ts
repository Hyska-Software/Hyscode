import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalRuntimeAdapter, ToolExecutionContext } from './types';

import { TerminalCommandRunner } from './terminal-command-runner';
import {
  buildTerminalFrame,
  isSensitiveTerminalPrompt,
  looksLikeTerminalPrompt,
  parseTerminalFrame,
} from './terminal-protocol';
import { CommandWatch } from './command-watch';

function mockBinding(terminalId: string, ptyId: string) {
  return { terminalId, ptyId, persistent: true, frameLanguage: 'bash' as const };
}

function contextWith(
  adapter: TerminalRuntimeAdapter,
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    workspacePath: 'C:/workspace',
    conversationId: 'conversation-1',
    toolCallId: 'tool-1',
    signal: new AbortController().signal,
    terminal: adapter,
    onTerminalProgress: () => undefined,
    listen: async () => () => undefined,
    invoke: async () => undefined as never,
    ...overrides,
  };
}

function staticAdapter(overrides: Partial<TerminalRuntimeAdapter> = {}): TerminalRuntimeAdapter {
  return {
    acquire: vi.fn(async () => mockBinding('terminal-e', 'pty-e')),
    snapshot: vi.fn(async () => ({
      data: '',
      fromSequence: 0,
      toSequence: 0,
      truncated: false,
      alive: true,
      exitCode: null,
    })),
    write: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('terminal command framing', () => {
  it('does not complete from the echoed wrapper and waits for the standalone end marker', () => {
    const nonce = 'abc123';
    const echoed = buildTerminalFrame('echo hello', 'bash', nonce);
    expect(parseTerminalFrame(echoed, nonce).complete).toBe(false);

    const raw = `${echoed}\r\n__HYSCODE_BEGIN_${nonce}__\r\nhel`;
    expect(parseTerminalFrame(raw, nonce)).toMatchObject({ started: true, complete: false });
    expect(parseTerminalFrame(`${raw}lo\r\n__HYSCODE_END_${nonce}__:7\r\n`, nonce)).toEqual({
      started: true,
      complete: true,
      output: 'hello',
      exitCode: 7,
    });
  });

  it('returns only real command output and the reported non-zero exit code', async () => {
    let onDataHandler: ((data: string, sequence: number) => void) | null = null;
    let sequenceCounter = 0;
    const adapter: TerminalRuntimeAdapter = {
      acquire: vi.fn(async () => mockBinding('terminal-1', 'pty-1')),
      snapshot: vi.fn(async () => ({
        data: '',
        fromSequence: 0,
        toSequence: 0,
        truncated: false,
        alive: true,
        exitCode: null,
      })),
      write: vi.fn(async (_terminalId, data) => {
        const frame = String(data);
        const nonce = frame.match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1] ?? '';
        queueMicrotask(() => {
          sequenceCounter += 1;
          onDataHandler?.(
            `${frame}\r\n__HYSCODE_BEGIN_${nonce}__\r\nactual output\r\n__HYSCODE_END_${nonce}__:7\r\n`,
            sequenceCounter,
          );
        });
      }),
      interrupt: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
      subscribe: vi.fn(async (_terminalId, onData) => {
        onDataHandler = onData;
        return () => {
          onDataHandler = null;
        };
      }),
    };
    const progress = vi.fn();
    const context: ToolExecutionContext = {
      workspacePath: 'C:/workspace',
      conversationId: 'conversation-1',
      toolCallId: 'tool-1',
      signal: new AbortController().signal,
      terminal: adapter,
      onTerminalProgress: progress,
      listen: async () => () => undefined,
      invoke: async () => undefined as never,
    };

    const result = await new TerminalCommandRunner().run(
      { command: 'failing-command', timeoutMs: 1_000 },
      context,
    );

    expect(result).toMatchObject({
      success: false,
      output: 'actual output',
      error: 'Exit code: 7',
    });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ state: 'running' }));
  });

  it('reconciles a completed command from the authoritative snapshot when live output is missed', async () => {
    let completed = false;
    let output = '';
    const adapter: TerminalRuntimeAdapter = {
      acquire: vi.fn(async () => mockBinding('terminal-snapshot', 'pty-snapshot')),
      snapshot: vi.fn(async () => ({
        data: completed ? output : '',
        fromSequence: completed ? 1 : 0,
        toSequence: completed ? 1 : 0,
        truncated: false,
        alive: true,
        exitCode: null,
      })),
      write: vi.fn(async (_terminalId, data) => {
        const frame = String(data);
        const nonce = frame.match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1] ?? '';
        output = `__HYSCODE_BEGIN_${nonce}__\nsnapshot output\n__HYSCODE_END_${nonce}__:0\n`;
        completed = true;
      }),
      interrupt: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => () => undefined),
    };

    const result = await new TerminalCommandRunner().run(
      { command: 'snapshot-only-completion', timeoutMs: 100 },
      contextWith(adapter),
    );

    expect(result).toMatchObject({
      success: true,
      output: 'snapshot output',
      metadata: { exitCode: 0 },
    });
    expect(adapter.snapshot).toHaveBeenCalled();
  });

  it('removes ANSI control sequences without removing command output', () => {
    const nonce = 'ansi';
    const raw = `__HYSCODE_BEGIN_${nonce}__\n\u001b[31mfailed\u001b[0m\n__HYSCODE_END_${nonce}__:1\n`;
    expect(parseTerminalFrame(raw, nonce)).toEqual({
      started: true,
      complete: true,
      output: 'failed',
      exitCode: 1,
    });
  });

  it('emits a valid PowerShell exit-code expression', () => {
    const frame = buildTerminalFrame('Get-ChildItem', 'powershell', 'powershell');
    expect(frame).toContain('$LASTEXITCODE');
    expect(frame).not.toContain('$$LASTEXITCODE');
    expect(frame).toContain('__HYSCODE_END_powershell__:{0}');
  });

  it('detects interactive prompts but reserves sensitive prompts for the user', () => {
    expect(looksLikeTerminalPrompt('Continue installation? [Y/n]')).toBe(true);
    expect(looksLikeTerminalPrompt('Choose an option:')).toBe(true);
    expect(looksLikeTerminalPrompt('building package 42/100')).toBe(false);
    expect(isSensitiveTerminalPrompt('Password:')).toBe(true);
    expect(isSensitiveTerminalPrompt('Continue installation? [Y/n]')).toBe(false);
  });

  it('suspends at a prompt and resumes the same terminal after approved input', async () => {
    let output = '';
    let sequence = 0;
    let nonce = '';
    let pushData: ((data: string) => void) | null = null;
    const adapter: TerminalRuntimeAdapter = {
      acquire: vi.fn(async () => mockBinding('terminal-i', 'pty-i')),
      snapshot: vi.fn(async () => ({
        data: output,
        fromSequence: output ? 1 : 0,
        toSequence: sequence,
        truncated: false,
        alive: true,
        exitCode: null,
      })),
      write: vi.fn(async (_terminalId, data) => {
        const nonceMatch = String(data).match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i);
        if (nonceMatch) {
          nonce = nonceMatch[1];
          output = `${data}\n__HYSCODE_BEGIN_${nonce}__\nContinue? [Y/n]\n`;
          sequence += 1;
          queueMicrotask(() => pushData?.(output));
          return;
        }
        output += `${data}accepted\n__HYSCODE_END_${nonce}__:0\n`;
        sequence += 1;
        pushData?.(`${data}accepted\n`);
      }),
      interrupt: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
      subscribe: vi.fn(async (_terminalId, onData) => {
        pushData = (chunk: string) => {
          sequence += 1;
          onData(chunk, sequence);
        };
        return () => {
          pushData = null;
        };
      }),
    };
    const context: ToolExecutionContext = {
      workspacePath: 'C:/workspace',
      conversationId: 'conversation-i',
      toolCallId: 'tool-i',
      signal: new AbortController().signal,
      terminal: adapter,
      listen: async () => () => undefined,
      invoke: async () => undefined as never,
    };
    const runner = new TerminalCommandRunner();
    const waiting = await runner.run({ command: 'installer', timeoutMs: 2_000 }, context);
    expect(waiting.metadata).toMatchObject({ terminalId: 'terminal-i', awaitingInput: true });

    const resumed = await runner.respond('terminal-i', 'Y', 1_000, {
      ...context,
      toolCallId: 'tool-response',
    });
    expect(resumed).toMatchObject({ success: true, metadata: { awaitingInput: false } });
    expect(adapter.write).toHaveBeenCalledWith('terminal-i', 'Y\r\n');
  });
});

describe('command watch', () => {
  it('completes when the end marker arrives', () => {
    const watch = new CommandWatch({
      nonce: 'watch-1',
      background: false,
      readyPattern: null,
      startedAt: Date.now(),
    });
    watch.pushData(1, '__HYSCODE_BEGIN_watch-1__\nhello\n__HYSCODE_END_watch-1__:0\n');
    expect(watch.evaluate(Date.now())).toMatchObject({
      kind: 'complete',
      output: 'hello',
      exitCode: 0,
    });
  });

  it('suspends at an idle prompt-looking line', () => {
    const watch = new CommandWatch({
      nonce: 'watch-2',
      background: false,
      readyPattern: null,
      startedAt: Date.now(),
    });
    watch.pushData(1, '__HYSCODE_BEGIN_watch-2__\nContinue? [Y/n]\n');
    expect(watch.evaluate(Date.now()).kind).toBe('running');

    const outcome = watch.evaluate(Date.now() + 10_000);
    expect(outcome).toMatchObject({ kind: 'awaiting_input' });
  });

  it('reports background readiness after the floor when the pattern matches', () => {
    const startedAt = Date.now();
    const watch = new CommandWatch({
      nonce: 'watch-3',
      background: true,
      readyPattern: /listening/,
      startedAt,
    });
    watch.pushData(1, '__HYSCODE_BEGIN_watch-3__\nserver listening on :8080\n');
    expect(watch.evaluate(startedAt + 100).kind).toBe('running');

    const ready = watch.evaluate(startedAt + 2_000);
    expect(ready).toMatchObject({ kind: 'background_ready' });
  });

  it('keeps prompt detection scoped to output after a baseline', () => {
    const watch = new CommandWatch({
      nonce: 'watch-4',
      background: false,
      readyPattern: null,
      startedAt: Date.now(),
    });
    const baseline = '__HYSCODE_BEGIN_watch-4__\nContinue? [Y/n]\n';
    watch.syncSnapshot(baseline, 5);
    expect(watch.evaluate(Date.now() + 10_000, baseline.length).kind).toBe('running');

    watch.pushData(6, '\nPassword:\n');
    const outcome = watch.evaluate(Date.now() + 10_000, baseline.length);
    expect(outcome).toMatchObject({ kind: 'awaiting_input' });
  });
});

describe('terminal command runner — run paths', () => {
  function dataAdapter() {
    let dataHandler: ((data: string, sequence: number) => void) | null = null;
    let exitHandler: ((code: number | null) => void) | null = null;
    let lastNonce = '';
    const adapter = staticAdapter({
      subscribe: vi.fn(async (_terminalId, onData, onExit) => {
        dataHandler = onData;
        exitHandler = onExit;
        return () => {
          dataHandler = null;
          exitHandler = null;
        };
      }),
      write: vi.fn(async (_terminalId, frame) => {
        lastNonce = String(frame).match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1] ?? '';
      }),
    });
    return {
      adapter,
      nonce: () => lastNonce,
      emit: (chunk: string, sequence = 1) => dataHandler?.(chunk, sequence),
      exit: (code: number | null) => exitHandler?.(code),
    };
  }

  /** Let async subscribe/listen registration settle before emitting events. */
  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 20));
  }

  it('fails fast when the terminal runtime is missing', async () => {
    const runner = new TerminalCommandRunner();
    const result = await runner.run(
      { command: 'echo hi' },
      contextWith(undefined as never as TerminalRuntimeAdapter),
    );
    expect(result).toMatchObject({ success: false, error: 'Terminal runtime is unavailable.' });
  });

  it('fails fast when the event bus is unavailable', async () => {
    const runner = new TerminalCommandRunner();
    const result = await runner.run(
      { command: 'echo hi' },
      contextWith(staticAdapter(), { listen: undefined }),
    );
    expect(result).toMatchObject({
      success: false,
      error: 'Terminal event listener is unavailable.',
    });
  });

  it('reports background success with the ready pattern', async () => {
    const { adapter, nonce, emit } = dataAdapter();
    const runner = new TerminalCommandRunner();
    const pending = runner.run(
      { command: 'npm run dev', background: true, readyPattern: 'listening', startupTimeoutMs: 5_000 },
      contextWith(adapter),
    );
    await flush();
    expect(nonce()).toBeTruthy();
    emit(`__HYSCODE_BEGIN_${nonce()}__\nserver listening on :8080\n`, 1);

    const result = await pending;
    expect(result).toMatchObject({ success: true, metadata: { background: true, exitCode: null } });
    expect(result.output).toContain('server listening');
  });

  it('times out a background command that never becomes ready', async () => {
    const { adapter } = dataAdapter();
    const runner = new TerminalCommandRunner();
    const result = await runner.run(
      {
        command: 'slow server',
        background: true,
        readyPattern: 'listening',
        startupTimeoutMs: 300,
      },
      contextWith(adapter),
    );
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('did not become ready');
  });

  it('times out a foreground command and stops the process', async () => {
    const { adapter, nonce, emit } = dataAdapter();
    const runner = new TerminalCommandRunner();
    const pending = runner.run({ command: 'sleep 10', timeoutMs: 300 }, contextWith(adapter));
    await flush();
    emit(`__HYSCODE_BEGIN_${nonce()}__\nrunning...\n`, 1);

    const result = await pending;
    expect(result).toMatchObject({
      success: false,
      error: 'Command timed out after 0s.',
      metadata: { timedOut: true },
    });
    expect(adapter.interrupt).toHaveBeenCalled();
    expect(adapter.kill).toHaveBeenCalled();
  });

  it('reports output truncation instead of hiding it behind a timeout', async () => {
    const adapter = staticAdapter({
      snapshot: vi.fn(async () => ({
        data: '__HYSCODE_BEGIN_watch__\npartial frame\n',
        fromSequence: 4,
        toSequence: 4,
        truncated: true,
        alive: true,
        exitCode: null,
      })),
    });
    const result = await new TerminalCommandRunner().run(
      { command: 'large-output', timeoutMs: 100 },
      contextWith(adapter),
    );
    expect(result).toMatchObject({
      success: false,
      error: 'Terminal output was truncated before the command frame completed.',
    });
  });

  it('cancels through the abort signal and stops the process', async () => {
    const { adapter, nonce, emit } = dataAdapter();
    const controller = new AbortController();
    const runner = new TerminalCommandRunner();
    const pending = runner.run(
      { command: 'sleep 10', timeoutMs: 10_000 },
      contextWith(adapter, { signal: controller.signal }),
    );
    await flush();
    emit(`__HYSCODE_BEGIN_${nonce()}__\nworking...\n`, 1);
    setTimeout(() => controller.abort(), 100);

    const result = await pending;
    expect(result).toMatchObject({ success: false, error: 'Command cancelled.' });
    expect(adapter.interrupt).toHaveBeenCalled();
  });

  it('breaks out of the wait when the process exits before the frame completes', async () => {
    const { adapter, nonce, emit, exit } = dataAdapter();
    const runner = new TerminalCommandRunner();
    const pending = runner.run({ command: 'crash', timeoutMs: 10_000 }, contextWith(adapter));
    await flush();
    emit(`__HYSCODE_BEGIN_${nonce()}__\npartial\n`, 1);
    exit(1);

    const result = await pending;
    expect(result).toMatchObject({ success: false, error: 'Command timed out after 10s.' });
    expect(result.metadata).toMatchObject({ timedOut: false });
  });

  it('reconciles the final snapshot when PTY exit races the last data event', async () => {
    let completed = false;
    let output = '';
    let exitHandler: ((code: number | null) => void) | null = null;
    const adapter = staticAdapter({
      snapshot: vi.fn(async () => ({
        data: completed ? output : '',
        fromSequence: completed ? 1 : 0,
        toSequence: completed ? 1 : 0,
        truncated: false,
        alive: !completed,
        exitCode: completed ? 0 : null,
      })),
      subscribe: vi.fn(async (_terminalId, _onData, onExit) => {
        exitHandler = onExit;
        return () => {
          exitHandler = null;
        };
      }),
      write: vi.fn(async (_terminalId, data) => {
        const nonce = String(data).match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1] ?? '';
        setTimeout(() => {
          output = `__HYSCODE_BEGIN_${nonce}__\nfinal output\n__HYSCODE_END_${nonce}__:0\n`;
          completed = true;
          exitHandler?.(0);
        }, 10);
      }),
    });

    const result = await new TerminalCommandRunner().run(
      { command: 'exit-race', timeoutMs: 2_000 },
      contextWith(adapter),
    );

    expect(result).toMatchObject({ success: true, output: 'final output' });
    expect(adapter.snapshot).toHaveBeenCalled();
  });

  it('falls back to the raw event bus when the adapter has no subscribe', async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const adapter = staticAdapter({
      write: vi.fn(async (_terminalId, frame) => {
        const nonce = String(frame).match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1] ?? '';
        queueMicrotask(() =>
          listeners.get('pty:data')?.({
            pty_id: 'pty-e',
            sequence: 1,
            data: `__HYSCODE_BEGIN_${nonce}__\nfallback output\n__HYSCODE_END_${nonce}__:0\n`,
          }),
        );
      }),
    });
    const runner = new TerminalCommandRunner();
    const result = await runner.run(
      { command: 'echo fb' },
      contextWith(adapter, {
        listen: async (event, handler) => {
          listeners.set(event, handler);
          return () => listeners.delete(event);
        },
      }),
    );
    expect(result).toMatchObject({ success: true, output: 'fallback output' });
  });

  it('propagates write failures as errors and still releases the session', async () => {
    const release = vi.fn();
    const adapter = staticAdapter({
      write: vi.fn(async () => {
        throw new Error('PTY closed');
      }),
      release,
    });
    const runner = new TerminalCommandRunner();
    const result = await runner.run({ command: 'echo hi' }, contextWith(adapter));
    expect(result).toMatchObject({ success: false, error: 'Error: PTY closed' });
    expect(release).toHaveBeenCalledWith('terminal-e', 'tool-1');
  });
});

describe('terminal command runner — respond paths', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function suspendedContext(overrides: Partial<ToolExecutionContext> = {}) {
    let output = '';
    let sequence = 0;
    let nonce = '';
    let pushData: ((data: string) => void) | null = null;
    const listeners = new Map<string, (payload: unknown) => void>();
    const adapter: TerminalRuntimeAdapter = {
      acquire: vi.fn(async () => mockBinding('terminal-i', 'pty-i')),
      snapshot: vi.fn(async () => ({
        data: output,
        fromSequence: output ? 1 : 0,
        toSequence: sequence,
        truncated: false,
        alive: true,
        exitCode: null,
      })),
      write: vi.fn(async (_terminalId, data) => {
        const nonceMatch = String(data).match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i);
        if (nonceMatch) {
          nonce = nonceMatch[1];
          output = `${data}\n__HYSCODE_BEGIN_${nonce}__\nContinue? [Y/n]\n`;
          sequence += 1;
          queueMicrotask(() => pushData?.(output));
          return;
        }
        output += `${data}\n`;
        sequence += 1;
        listeners.get('pty:data')?.({ pty_id: 'pty-i', sequence, data: `${data}\n` });
        pushData?.(`${data}\n`);
      }),
      interrupt: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
      subscribe: vi.fn(async (_terminalId, onData) => {
        pushData = (chunk: string) => {
          sequence += 1;
          onData(chunk, sequence);
        };
        return () => {
          pushData = null;
        };
      }),
    };
    const context: ToolExecutionContext = {
      workspacePath: 'C:/workspace',
      conversationId: 'conversation-i',
      toolCallId: 'tool-i',
      signal: new AbortController().signal,
      terminal: adapter,
      onTerminalProgress: () => undefined,
      listen: async (event, handler) => {
        listeners.set(event, handler);
        return () => listeners.delete(event);
      },
      invoke: async () => undefined as never,
      ...overrides,
    };
    return {
      adapter,
      context,
      emit: (chunk: string) => {
        output += chunk;
        sequence += 1;
        listeners.get('pty:data')?.({ pty_id: 'pty-i', sequence, data: chunk });
        pushData?.(chunk);
      },
      exit: (code: number | null) => listeners.get('pty:exit')?.({ pty_id: 'pty-i', code }),
      getOutput: () => output,
      setOutput: (value: string) => {
        output = value;
      },
    };
  }

  async function suspend(
    runner: TerminalCommandRunner,
    ctx: ToolExecutionContext,
  ): Promise<void> {
    const pending = runner.run({ command: 'installer', timeoutMs: 10_000 }, ctx);
    await vi.advanceTimersByTimeAsync(700);
    const waiting = await pending;
    expect(waiting.metadata).toMatchObject({ awaitingInput: true });
  }

  it('rejects responses for terminals that are not waiting', async () => {
    const runner = new TerminalCommandRunner();
    const result = await runner.respond('terminal-x', 'Y', 1_000, {
      ...contextWithPlaceholder(),
      terminal: staticAdapter(),
    });
    expect(result).toMatchObject({
      success: false,
      error: 'Terminal is not waiting for agent input.',
    });
  });

  it('rejects responses when the terminal is no longer waiting', async () => {
    vi.useFakeTimers();
    const { adapter, context, getOutput, setOutput } = suspendedContext();
    const runner = new TerminalCommandRunner();
    await suspend(runner, context);
    (adapter.write as ReturnType<typeof vi.fn>).mockClear();
    const nonce = getOutput().match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1] ?? '';
    setOutput(`__HYSCODE_BEGIN_${nonce}__\ndone\n__HYSCODE_END_${nonce}__:0\n`);

    const result = await runner.respond('terminal-i', 'Y', 1_000, context);
    expect(result).toMatchObject({
      success: false,
      error: 'Terminal is no longer waiting for input.',
    });
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('invalidates a suspended response after an owner-bound manual answer', async () => {
    vi.useFakeTimers();
    const { context } = suspendedContext();
    const runner = new TerminalCommandRunner();
    await suspend(runner, context);

    expect(runner.invalidateInteractive('terminal-i', {
      conversationId: 'conversation-other',
      source: 'user',
    })).toBe(false);
    expect(runner.invalidateInteractive('terminal-i', {
      conversationId: context.conversationId,
      source: 'user',
    })).toBe(true);

    const result = await runner.respond('terminal-i', 'Y', 1_000, context);
    expect(result).toMatchObject({
      success: false,
      error: 'Terminal is not waiting for agent input.',
    });
  });

  it('reserves sensitive prompts for the user', async () => {
    vi.useFakeTimers();
    const { adapter, context, getOutput, setOutput } = suspendedContext();
    const runner = new TerminalCommandRunner();
    await suspend(runner, context);
    (adapter.write as ReturnType<typeof vi.fn>).mockClear();
    const nonce = getOutput().match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1] ?? '';
    setOutput(`__HYSCODE_BEGIN_${nonce}__\nPassword:\n`);

    const result = await runner.respond('terminal-i', 'secret', 1_000, context);
    expect(result).toMatchObject({
      success: false,
      error: 'Sensitive terminal prompts must be answered directly by the user.',
    });
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('sends input, observes completion and clears the suspended state', async () => {
    vi.useFakeTimers();
    const { adapter, context, emit, getOutput } = suspendedContext();
    const runner = new TerminalCommandRunner();
    await suspend(runner, context);
    const nonce = getOutput().match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1] ?? '';

    const pending = runner.respond('terminal-i', 'Y', 5_000, context);
    await vi.advanceTimersByTimeAsync(100);
    emit(`Y\n__HYSCODE_END_${nonce}__:0\n`);
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;

    expect(result).toMatchObject({ success: true, metadata: { awaitingInput: false } });
    expect(adapter.write).toHaveBeenCalledWith('terminal-i', 'Y\r\n');
  });

  it('reports a second prompt as awaiting more input', async () => {
    vi.useFakeTimers();
    const { context, emit } = suspendedContext();
    const runner = new TerminalCommandRunner();
    await suspend(runner, context);

    const pending = runner.respond('terminal-i', 'Y', 5_000, context);
    await vi.advanceTimersByTimeAsync(100);
    emit('Y\nAnother? [Y/n]\n');
    await vi.advanceTimersByTimeAsync(700);
    const result = await pending;

    expect(result).toMatchObject({ success: true, metadata: { awaitingInput: true } });
    expect(result.output).toContain('waiting for more terminal input');
  });

  it('reports still-running when the command outlives the observation window', async () => {
    vi.useFakeTimers();
    const { context } = suspendedContext();
    const runner = new TerminalCommandRunner();
    await suspend(runner, context);

    const pending = runner.respond('terminal-i', 'Y', 300, context);
    await vi.advanceTimersByTimeAsync(600);
    const result = await pending;

    expect(result).toMatchObject({ success: true, metadata: { awaitingInput: true } });
    expect(result.output).toBe('Input was sent. The command is still running.');
  });

  it('cancels a pending response through the abort signal', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { context } = suspendedContext({ signal: controller.signal });
    const runner = new TerminalCommandRunner();
    await suspend(runner, context);

    const pending = runner.respond('terminal-i', 'Y', 5_000, context);
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;

    expect(result).toMatchObject({ success: false, error: 'Command cancelled.' });
  });

  it('stops waiting when the process exits mid-response', async () => {
    vi.useFakeTimers();
    const { context, exit } = suspendedContext();
    const runner = new TerminalCommandRunner();
    await suspend(runner, context);

    const pending = runner.respond('terminal-i', 'Y', 5_000, context);
    await vi.advanceTimersByTimeAsync(100);
    exit(0);
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;

    expect(result).toMatchObject({ success: true, metadata: { awaitingInput: true } });
  });
});

function contextWithPlaceholder(): ToolExecutionContext {
  return {
    workspacePath: 'C:/workspace',
    conversationId: 'conversation-x',
    toolCallId: 'tool-x',
    signal: new AbortController().signal,
    terminal: undefined as never,
    onTerminalProgress: () => undefined,
    listen: async () => () => undefined,
    invoke: async () => undefined as never,
  };
}

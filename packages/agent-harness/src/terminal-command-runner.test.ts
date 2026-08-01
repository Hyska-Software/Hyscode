import { describe, expect, it, vi } from 'vitest';
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

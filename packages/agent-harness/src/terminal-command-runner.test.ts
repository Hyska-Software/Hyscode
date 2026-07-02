import { describe, expect, it, vi } from 'vitest';
import type { TerminalRuntimeAdapter, ToolExecutionContext } from './types';

import {
  buildTerminalFrame,
  isSensitiveTerminalPrompt,
  looksLikeTerminalPrompt,
  parseTerminalFrame,
  TerminalCommandRunner,
} from './terminal-command-runner';

describe('terminal command framing', () => {
  it('does not complete from the echoed wrapper and waits for the standalone end marker', () => {
    const nonce = 'abc123';
    const echoed = buildTerminalFrame('echo hello', true, nonce);
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
    const listeners = new Map<string, (payload: unknown) => void>();
    const adapter: TerminalRuntimeAdapter = {
      acquire: vi.fn(async () => ({ terminalId: 'terminal-1', ptyId: 'pty-1', persistent: true })),
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
    };
    const progress = vi.fn();
    const context: ToolExecutionContext = {
      workspacePath: 'C:/workspace',
      conversationId: 'conversation-1',
      toolCallId: 'tool-1',
      signal: new AbortController().signal,
      terminal: adapter,
      onTerminalProgress: progress,
      listen: async (event, handler) => {
        listeners.set(event, handler);
        return () => listeners.delete(event);
      },
      invoke: async (_command, args) => {
        if (_command === 'pty_write') {
          const frame = String(args?.data);
          const nonce = frame.match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1];
          if (!nonce) throw new Error('missing nonce');
          queueMicrotask(() => {
            listeners.get('pty:data')?.({
              pty_id: 'pty-1',
              sequence: 1,
              data: `${frame}\r\n__HYSCODE_BEGIN_${nonce}__\r\nactual output\r\n__HYSCODE_END_${nonce}__:7\r\n`,
            });
          });
        }
        return undefined as never;
      },
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
    expect(listeners.size).toBe(0);
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
    const frame = buildTerminalFrame('Get-ChildItem', true, 'powershell');
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
    const listeners = new Map<string, (payload: unknown) => void>();
    let output = '';
    let sequence = 0;
    let nonce = '';
    const adapter: TerminalRuntimeAdapter = {
      acquire: vi.fn(async () => ({ terminalId: 'terminal-i', ptyId: 'pty-i', persistent: true })),
      snapshot: vi.fn(async () => ({
        data: output,
        fromSequence: output ? 1 : 0,
        toSequence: sequence,
        truncated: false,
        alive: true,
        exitCode: null,
      })),
      write: vi.fn(async (_terminalId, data) => {
        output += `${data}accepted\n__HYSCODE_END_${nonce}__:0\n`;
        sequence++;
        listeners.get('pty:data')?.({ pty_id: 'pty-i', sequence, data: 'accepted\n' });
      }),
      interrupt: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
    };
    const context: ToolExecutionContext = {
      workspacePath: 'C:/workspace',
      conversationId: 'conversation-i',
      toolCallId: 'tool-i',
      signal: new AbortController().signal,
      terminal: adapter,
      listen: async (event, handler) => {
        listeners.set(event, handler);
        return () => listeners.delete(event);
      },
      invoke: async (command, args) => {
        if (command === 'pty_write') {
          const frame = String(args?.data);
          nonce = frame.match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1] ?? '';
          output = `${frame}\n__HYSCODE_BEGIN_${nonce}__\nContinue? [Y/n]\n`;
          sequence++;
          queueMicrotask(() =>
            listeners.get('pty:data')?.({ pty_id: 'pty-i', sequence, data: output }),
          );
        }
        return undefined as never;
      },
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

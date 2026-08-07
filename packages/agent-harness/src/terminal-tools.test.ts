import { describe, expect, it, vi } from 'vitest';
import type { TerminalRuntimeAdapter, ToolExecutionContext } from './types';

import {
  readTerminalOutputTool,
  respondTerminalInputTool,
  runTerminalCommandTool,
  stopTerminalProcessTool,
} from './tools';

function contextWith(
  terminal: TerminalRuntimeAdapter | undefined,
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    workspacePath: 'C:/workspace',
    conversationId: 'conversation-1',
    toolCallId: 'tool-1',
    signal: new AbortController().signal,
    terminal,
    onTerminalProgress: () => undefined,
    listen: async () => () => undefined,
    invoke: async () => undefined as never,
    ...overrides,
  };
}

function snapshotAdapter(overrides: Partial<TerminalRuntimeAdapter> = {}): TerminalRuntimeAdapter {
  return {
    acquire: vi.fn(async () => ({
      terminalId: 'terminal-1',
      ptyId: 'pty-1',
      persistent: true,
      frameLanguage: 'bash' as const,
    })),
    snapshot: vi.fn(async () => ({
      data: '__HYSCODE_BEGIN_abc__\nreal output\n__HYSCODE_END_abc__:0\n',
      fromSequence: 1,
      toSequence: 5,
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

describe('run_terminal_command tool', () => {
  it('forwards the command through the runner and returns the result', async () => {
    const adapter = snapshotAdapter({
      subscribe: vi.fn(async () => () => undefined),
      write: vi.fn(async () => undefined),
    });
    const result = await runTerminalCommandTool.execute(
      { command: 'echo hi', timeout_ms: 250 },
      contextWith(adapter),
    );
    expect(result).toMatchObject({
      success: false,
      error: 'Command timed out after 0s.',
      metadata: { terminalId: 'terminal-1' },
    });
  });

  it('maps input fields onto the runner input', async () => {
    let dataHandler: ((data: string, sequence: number) => void) | null = null;
    const adapter = snapshotAdapter({
      subscribe: vi.fn(async (_terminalId, onData) => {
        dataHandler = onData;
        return () => {
          dataHandler = null;
        };
      }),
      write: vi.fn(async (_terminalId, frame) => {
        const nonce = String(frame).match(/__HYSCODE_BEGIN_([a-z0-9]+)__/i)?.[1] ?? '';
        queueMicrotask(() => {
          dataHandler?.(`__HYSCODE_BEGIN_${nonce}__\nok\n__HYSCODE_END_${nonce}__:0\n`, 1);
        });
      }),
    });
    const result = await runTerminalCommandTool.execute(
      { command: 'npm test', cwd: 'src', timeout_ms: 5_000 },
      contextWith(adapter),
    );
    expect(result).toMatchObject({ success: true, output: 'ok' });
    expect(adapter.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ forceNew: false, cwd: 'c:/workspace/src' }),
    );
  });

  it('reports a missing terminal runtime', async () => {
    const result = await runTerminalCommandTool.execute(
      { command: 'echo hi' },
      contextWith(undefined),
    );
    expect(result).toMatchObject({ success: false, error: 'Terminal runtime is unavailable.' });
  });
});

describe('read_terminal_output tool', () => {
  it('normalizes the snapshot and forwards sequence metadata', async () => {
    const adapter = snapshotAdapter();
    const result = await readTerminalOutputTool.execute(
      { terminal_id: 'terminal-1' },
      contextWith(adapter),
    );
    expect(result).toMatchObject({
      success: true,
      output: 'real output',
      metadata: { sequence: 5, alive: true, truncated: false, exitCode: null },
    });
    expect(adapter.snapshot).toHaveBeenCalledWith('terminal-1', undefined);
  });

  it('passes after_sequence and max_chars through', async () => {
    const adapter = snapshotAdapter();
    const result = await readTerminalOutputTool.execute(
      { terminal_id: 'terminal-1', after_sequence: 3, max_chars: 100 },
      contextWith(adapter),
    );
    expect(result.success).toBe(true);
    expect(adapter.snapshot).toHaveBeenCalledWith('terminal-1', 3);
  });

  it('authorizes reads with the current conversation and owner', async () => {
    const authorize = vi.fn();
    const adapter = snapshotAdapter({ authorize });
    const result = await readTerminalOutputTool.execute(
      { terminal_id: 'terminal-1' },
      contextWith(adapter, { ownerId: 'owner-1' }),
    );
    expect(result.success).toBe(true);
    expect(authorize).toHaveBeenCalledWith('terminal-1', {
      conversationId: 'conversation-1',
      ownerId: 'owner-1',
      toolCallId: 'tool-1',
      source: 'agent',
    });
  });

  it('surfaces runtime failures', async () => {
    const adapter = snapshotAdapter({
      snapshot: vi.fn(async () => {
        throw new Error('PTY gone');
      }),
    });
    const result = await readTerminalOutputTool.execute(
      { terminal_id: 'terminal-1' },
      contextWith(adapter),
    );
    expect(result).toMatchObject({ success: false, error: 'Error: PTY gone' });
  });

  it('reports a missing terminal runtime', async () => {
    const result = await readTerminalOutputTool.execute(
      { terminal_id: 'terminal-1' },
      contextWith(undefined),
    );
    expect(result).toMatchObject({ success: false, error: 'Terminal runtime is unavailable.' });
  });
});

describe('respond_terminal_input tool', () => {
  it('rejects when nothing is waiting on that terminal', async () => {
    const result = await respondTerminalInputTool.execute(
      { terminal_id: 'terminal-1', input: 'Y' },
      contextWith(snapshotAdapter()),
    );
    expect(result).toMatchObject({
      success: false,
      error: 'Terminal is not waiting for agent input.',
    });
  });

  it('resolves an approved response to a suspended command', async () => {
    let pushData: ((data: string) => void) | null = null;
    let output = '';
    let sequence = 0;
    let nonce = '';
    const adapter: TerminalRuntimeAdapter = {
      acquire: vi.fn(async () => ({
        terminalId: 'terminal-i',
        ptyId: 'pty-i',
        persistent: true,
        frameLanguage: 'bash' as const,
      })),
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
    const context = contextWith(adapter);
    const waiting = await runTerminalCommandTool.execute(
      { command: 'installer' },
      context,
    );
    expect(waiting.metadata).toMatchObject({ awaitingInput: true });

    const response = await respondTerminalInputTool.execute(
      { terminal_id: 'terminal-i', input: 'Y', timeout_ms: 1_000 },
      contextWith(adapter),
    );
    expect(response).toMatchObject({ success: true, metadata: { awaitingInput: false } });
  });
});

describe('stop_terminal_process tool', () => {
  it('interrupts, verifies and reports the stopped terminal', async () => {
    const authorize = vi.fn();
    const adapter = snapshotAdapter({
      authorize,
      snapshot: vi.fn(async () => ({
        data: '',
        fromSequence: 0,
        toSequence: 0,
        truncated: false,
        alive: false,
        exitCode: 0,
      })),
    });
    const result = await stopTerminalProcessTool.execute(
      { terminal_id: 'terminal-1' },
      contextWith(adapter),
    );
    expect(result).toMatchObject({ success: true, output: 'Stopped terminal terminal-1.' });
    expect(adapter.interrupt).toHaveBeenCalledWith('terminal-1');
    expect(adapter.kill).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledWith('terminal-1', expect.objectContaining({ source: 'agent' }));
  });

  it('escalates to kill when the process stays alive', async () => {
    const adapter = snapshotAdapter({
      snapshot: vi.fn(async () => ({
        data: '',
        fromSequence: 0,
        toSequence: 0,
        truncated: false,
        alive: true,
        exitCode: null,
      })),
    });
    const result = await stopTerminalProcessTool.execute(
      { terminal_id: 'terminal-1' },
      contextWith(adapter),
    );
    expect(result).toMatchObject({ success: false, error: 'Process did not stop: terminal-1' });
    expect(adapter.kill).toHaveBeenCalled();
  });

  it('reports a missing terminal runtime', async () => {
    const result = await stopTerminalProcessTool.execute(
      { terminal_id: 'terminal-1' },
      contextWith(undefined),
    );
    expect(result).toMatchObject({ success: false, error: 'Terminal runtime is unavailable.' });
  });
});

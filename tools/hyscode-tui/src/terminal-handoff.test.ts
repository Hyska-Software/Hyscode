import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { TerminalHandoff } from '@hyscode/tui-runtime';
import { runTerminalHandoff } from './terminal-handoff';

class FakeInput extends EventEmitter {
  isTTY = true;
  rawModes: boolean[] = [];
  columns = 90;
  rows = 24;

  setRawMode(value: boolean): this {
    this.rawModes.push(value);
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 90;
  rows = 24;
  writes: string[] = [];

  write(value: string): boolean {
    this.writes.push(value);
    return true;
  }
}

function fakeHandoff(): {
  handoff: TerminalHandoff;
  writes: string[];
  resizes: Array<{ cols: number; rows: number }>;
  emitData: (data: string) => void;
  emitExit: (code: number | null) => void;
} {
  let onData: ((data: string, sequence: number) => void) | null = null;
  let onExit: ((code: number | null) => void) | null = null;
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const handoff: TerminalHandoff = {
    terminalId: 'terminal-user',
    subscribe: async (dataHandler, exitHandler) => {
      onData = dataHandler;
      onExit = exitHandler;
      return () => {
        onData = null;
        onExit = null;
      };
    },
    write: async (data) => {
      writes.push(data);
    },
    resize: async (viewport) => {
      resizes.push(viewport);
    },
    detach: async () => {
      onExit?.(null);
    },
  };
  return {
    handoff,
    writes,
    resizes,
    emitData: (data) => onData?.(data, 1),
    emitExit: (code) => onExit?.(code),
  };
}

describe('TUI terminal handoff', () => {
  it('forwards raw child output and input, resizes the PTY, and restores the outer TUI on Ctrl-]', async () => {
    const stdin = new FakeInput();
    const stdout = new FakeOutput();
    const fake = fakeHandoff();
    let paused = 0;
    let resumed = 0;
    const run = runTerminalHandoff(fake.handoff, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      pauseOuter: () => { paused += 1; },
      resumeOuter: () => { resumed += 1; },
    });

    await Promise.resolve();
    fake.emitData('\u001b[2J\u001b[HPi');
    stdin.emit('data', Buffer.from('omp\r'));
    const emoji = Buffer.from('🙂');
    stdin.emit('data', emoji.subarray(0, 2));
    stdin.emit('data', emoji.subarray(2));
    stdout.columns = 120;
    stdout.rows = 40;
    stdout.emit('resize');
    await new Promise((resolve) => setTimeout(resolve, 0));
    stdin.emit('data', Buffer.from('\u001d'));
    await run;

    expect(stdout.writes.join('')).toContain('\u001b[2J\u001b[H');
    expect(stdout.writes.join('')).toContain('Pi');
    expect(fake.writes).toEqual(['omp\r', '🙂']);
    expect(fake.resizes).toContainEqual({ cols: 120, rows: 40 });
    expect(stdin.rawModes).toEqual([true, false]);
    expect(paused).toBe(1);
    expect(resumed).toBe(1);
  });
});

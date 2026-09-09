/* @vitest-environment jsdom */

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const settings = {
    themeId: 'hyscode-dark',
    terminalFontSize: 15,
    terminalFontFamily: 'Test Mono',
    terminalScrollback: 2400,
    terminalShell: 'pwsh.exe',
    terminalCursorStyle: 'underline',
    approvalMode: 'manual',
  };
  const terminalState = {
    sessions: [] as Array<{
      id: string;
      ptyId: string | null;
      isAgentSession: boolean;
      cwd: string | null;
      activeToolCallId: string | null;
      awaitingInput: boolean;
    }>,
    deadCalls: [] as unknown[][],
    setPtyId: (sessionId: string, ptyId: string | null) => {
      const session = terminalState.sessions.find((item) => item.id === sessionId);
      if (session) session.ptyId = ptyId;
    },
    markPtyDead: (...args: unknown[]) => {
      terminalState.deadCalls.push(args);
    },
    setLastCommand: () => undefined,
    appendCommandHistory: () => undefined,
    setAwaitingInput: () => undefined,
    setOutputSequence: () => undefined,
  };
  const useTerminalStore = Object.assign(
    (selector: (state: typeof terminalState) => unknown) => selector(terminalState),
    { getState: () => terminalState },
  );
  return {
    spawnUserTerminal: vi.fn(async () => 'pty-test'),
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    invoke: vi.fn(async (command: string) => command === 'pty_spawn' ? 'pty-test' : undefined),
    subscribe: vi.fn(async (
      _terminalId?: string,
      _onData?: (data: string, sequence: number) => void,
      _onExit?: (exitCode: number | null, failure?: { operation: string; message: string } | null) => void,
    ) => () => undefined),
    kill: vi.fn(async () => ({ status: 'stopped', failures: [] })),
    terminals: [] as Array<{
      options: Record<string, unknown>;
      cols: number;
      rows: number;
      onDataHandler: ((data: string) => void) | null;
    }>,
    errors: [] as string[],
    settings,
    terminalState,
    useTerminalStore,
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@xterm/xterm', () => ({
  Terminal: class FakeTerminal {
    cols = 80;
    rows = 24;
    onDataHandler: ((data: string) => void) | null = null;
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.terminals.push(this);
    }

    loadAddon(addon: { terminal?: FakeTerminal }): void {
      addon.terminal = this;
    }

    open(): void {}
    focus(): void {}
    write(): void {}
    writeln(value: string): void { mocks.errors.push(value); }
    dispose(): void {}
    onData(handler: (data: string) => void): { dispose: () => void } {
      this.onDataHandler = handler;
      return { dispose: () => { this.onDataHandler = null; } };
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FakeFitAddon {
    terminal: { cols: number; rows: number } | null = null;

    fit(): void {
      if (this.terminal) {
        this.terminal.cols = 120;
        this.terminal.rows = 32;
      }
    }
  },
}));
vi.mock('../../lib/terminal-runtime', () => ({
  desktopTerminalRuntime: {
    spawnUserTerminal: mocks.spawnUserTerminal,
    subscribe: mocks.subscribe,
    write: mocks.write,
    resize: mocks.resize,
    kill: mocks.kill,
  },
}));
vi.mock('../../lib/monaco-themes', () => ({ getXtermTheme: vi.fn(() => ({})) }));
vi.mock('../../stores/project-store', () => ({
  useProjectStore: (selector: (state: { rootPath: string }) => unknown) => selector({ rootPath: 'C:/workspace' }),
}));
vi.mock('../../stores/extension-store', () => ({
  useExtensionStore: (selector: (state: { extensionThemesVersion: number }) => unknown) => selector({ extensionThemesVersion: 0 }),
}));
vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: typeof mocks.settings) => unknown) => selector(mocks.settings),
    { getState: () => mocks.settings },
  ),
}));
vi.mock('../../stores/terminal-store', () => ({
  canUserWriteToTerminal: () => true,
  useTerminalStore: mocks.useTerminalStore,
}));

import { TerminalInstance } from './terminal-instance';

describe('TerminalInstance', () => {
  beforeEach(() => {
    mocks.invoke.mockClear();
    mocks.spawnUserTerminal.mockClear();
    mocks.subscribe.mockClear();
    mocks.write.mockClear();
    mocks.resize.mockClear();
    mocks.terminals.length = 0;
    mocks.kill.mockClear();
    mocks.terminalState.deadCalls.length = 0;
    mocks.invoke.mockImplementation(async (command: string) =>
      command === 'pty_spawn' ? 'pty-test' : undefined,
    );
    mocks.spawnUserTerminal.mockImplementation(async () => 'pty-test');
    mocks.subscribe.mockImplementation(async () => () => undefined);
    mocks.write.mockImplementation(async () => undefined);
    mocks.resize.mockImplementation(async () => undefined);
    mocks.kill.mockImplementation(async () => ({ status: 'stopped', failures: [] }));
    mocks.errors.length = 0;
    mocks.settings.terminalFontSize = 15;
    mocks.settings.terminalFontFamily = 'Test Mono';
    mocks.settings.terminalScrollback = 2400;
    mocks.settings.terminalShell = 'pwsh.exe';
    mocks.settings.terminalCursorStyle = 'underline';
    mocks.terminalState.sessions = [{
      id: 'session-1',
      ptyId: null,
      isAgentSession: false,
      cwd: 'C:/workspace',
      activeToolCallId: null,
      awaitingInput: false,
    }];
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 1200 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses persisted terminal settings and the measured viewport for a manual PTY', async () => {
    render(<TerminalInstance sessionId="session-1" isActive />);

    await waitFor(() => expect(mocks.spawnUserTerminal).toHaveBeenCalledWith(
      'session-1',
      'C:/workspace',
      120,
      32,
      true,
    ));
    if (mocks.errors.length > 0) throw new Error(mocks.errors.join('\n'));
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());
    await waitFor(() => expect(mocks.resize).toHaveBeenCalledWith('session-1', 120, 32));

    expect(mocks.terminals[0]?.options).toMatchObject({
      fontSize: 15,
      fontFamily: "Test Mono, 'Cascadia Mono', Consolas, 'Courier New', monospace",
      scrollback: 2400,
      cursorStyle: 'underline',
      letterSpacing: 0,
      lineHeight: 1,
    });
  });
  it('shows a nonzero process exit code when no runtime failure is available', async () => {
    mocks.subscribe.mockImplementation(async (
      _terminalId?: string,
      _onData?: (data: string, sequence: number) => void,
      onExit?: (exitCode: number | null, failure?: { operation: string; message: string } | null) => void,
    ) => {
      onExit?.(7, null);
      return () => undefined;
    });
    render(<TerminalInstance sessionId="session-1" isActive />);

    await waitFor(() => expect(mocks.errors.some((value) => value.includes('Process exited with code 7'))).toBe(true));
  });


  it('marks a manual terminal dead when direct PTY writes fail', async () => {
    mocks.write.mockImplementation(async () => {
      throw new Error('write unavailable');
    });
    render(<TerminalInstance sessionId="session-1" isActive />);

    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());
    mocks.terminals[0]?.onDataHandler?.('x');

    await waitFor(() => expect(mocks.terminalState.deadCalls).toHaveLength(1));
    expect(mocks.write).toHaveBeenCalledWith('session-1', 'x');
    expect(mocks.kill).toHaveBeenCalledWith('session-1');
    expect(mocks.errors.some((value) => value.includes('write unavailable'))).toBe(true);
  });

  it('surfaces spawn failures and records the failed terminal state', async () => {
    mocks.spawnUserTerminal.mockImplementation(async () => {
      throw new Error('spawn unavailable');
    });
    render(<TerminalInstance sessionId="session-1" isActive />);

    await waitFor(() => expect(mocks.terminalState.deadCalls).toHaveLength(1));
    expect(mocks.terminalState.deadCalls[0]?.[2]).toMatchObject({
      operation: 'acquire',
      message: 'spawn unavailable',
    });
    expect(mocks.errors.some((value) => value.includes('Failed to spawn terminal'))).toBe(true);
    expect(mocks.kill).toHaveBeenCalledWith('session-1');
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('applies font changes to an already mounted terminal', async () => {
    const view = render(<TerminalInstance sessionId="session-1" isActive />);

    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());

    mocks.settings.terminalFontFamily = 'Cascadia Mono';
    mocks.settings.terminalFontSize = 18;
    view.rerender(<TerminalInstance sessionId="session-1" isActive />);

    await waitFor(() => expect(mocks.terminals[0]?.options).toMatchObject({
      fontFamily: "Cascadia Mono, Consolas, 'Courier New', monospace",
      fontSize: 18,
    }));
  });
});

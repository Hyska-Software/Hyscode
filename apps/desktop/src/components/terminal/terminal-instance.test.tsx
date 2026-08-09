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
    setPtyId: (sessionId: string, ptyId: string | null) => {
      const session = terminalState.sessions.find((item) => item.id === sessionId);
      if (session) session.ptyId = ptyId;
    },
    markPtyDead: () => undefined,
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
    invoke: vi.fn(async (command: string) => command === 'pty_spawn' ? 'pty-test' : undefined),
    subscribe: vi.fn(async () => () => undefined),
    terminals: [] as Array<{ options: Record<string, unknown>; cols: number; rows: number }>,
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
    onData(): { dispose: () => void } { return { dispose: () => undefined }; }
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
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock('../../lib/terminal-runtime', () => ({ desktopTerminalRuntime: { subscribe: mocks.subscribe } }));
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
    mocks.subscribe.mockClear();
    mocks.terminals.length = 0;
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

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('pty_spawn', expect.objectContaining({
      shell: 'pwsh.exe',
      cwd: 'C:/workspace',
      cols: 120,
      rows: 32,
      interactive: true,
    })));
    if (mocks.errors.length > 0) throw new Error(mocks.errors.join('\n'));
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('pty_resize', {
      ptyId: 'pty-test',
      cols: 120,
      rows: 32,
    }));

    expect(mocks.terminals[0]?.options).toMatchObject({
      fontSize: 15,
      fontFamily: "Test Mono, 'Cascadia Mono', Consolas, 'Courier New', monospace",
      scrollback: 2400,
      cursorStyle: 'underline',
      letterSpacing: 0,
      lineHeight: 1,
    });
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

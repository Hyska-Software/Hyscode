/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalPanel } from './terminal-panel';
import { useTerminalStore, type TerminalSession } from '../../stores/terminal-store';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => {
    invokeMock(...args);
    return args[0] === 'pty_kill'
      ? Promise.resolve({ status: 'stopped', failures: [] })
      : Promise.resolve();
  },
}));

vi.mock('./terminal-instance', () => ({ TerminalInstance: () => null }));

function makeSession(overrides: Partial<TerminalSession>): TerminalSession {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: 'Terminal',
    ptyId: null,
    isAgentSession: false,
    location: 'panel',
    cwd: null,
    lastCommand: null,
    commandHistory: [],
    isDead: false,
    exitCode: null,
    failure: null,
    ownerConversationId: null,
    activeToolCallId: null,
    awaitingInput: false,
    outputSequence: 0,
    ...overrides,
  };
}

function seedSessions(sessions: TerminalSession[]) {
  const activeSessionId = sessions[0]?.id ?? null;
  useTerminalStore.setState({ sessions, activeSessionId });
}

function getTabByName(name: string): HTMLElement {
  return Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.includes(name) && button.title !== 'New Terminal',
  )!;
}

describe('TerminalPanel tab bar interactions', () => {
  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
    seedSessions([]);
  });

  beforeEach(() => {
    seedSessions([
      makeSession({ id: 'term-1', name: 'bash 1' }),
      makeSession({ id: 'term-2', name: 'bash 2' }),
      makeSession({ id: 'term-3', name: 'bash 3' }),
    ]);
  });

  it('closes a session with a middle click without killing an unowned PTY', () => {
    const { container } = render(<TerminalPanel />);

    fireEvent.mouseDown(getTabByName('bash 2'), { button: 1 });

    const state = useTerminalStore.getState();
    expect(state.sessions.map((s) => s.id)).toEqual(['term-1', 'term-3']);
    expect(invokeMock).not.toHaveBeenCalledWith('pty_kill', expect.anything());
    expect(container).toBeTruthy();
  });

  it('kills the PTY when closing a live session via middle click', async () => {
    seedSessions([
      makeSession({ id: 'term-1', name: 'bash 1' }),
      makeSession({ id: 'term-2', name: 'bash 2', ptyId: 'pty-42' }),
    ]);
    render(<TerminalPanel />);

    fireEvent.mouseDown(getTabByName('bash 2'), { button: 1 });

    await waitFor(() => {
      expect(useTerminalStore.getState().sessions.map((s) => s.id)).toEqual(['term-1']);
    });
    expect(invokeMock).toHaveBeenCalledWith('pty_kill', { ptyId: 'pty-42' });
  });

  it('refuses to close an agent-controlled session while a tool call runs', () => {
    seedSessions([
      makeSession({ id: 'term-1', name: 'bash 1' }),
      makeSession({ id: 'term-2', name: 'agent run', activeToolCallId: 'tool-1', ptyId: 'pty-9' }),
    ]);
    render(<TerminalPanel />);

    fireEvent.mouseDown(getTabByName('agent run'), { button: 1 });

    const state = useTerminalStore.getState();
    expect(state.sessions.map((s) => s.id)).toEqual(['term-1', 'term-2']);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('scrolls the tab bar horizontally from vertical wheel input once tabs overflow', () => {
    const { container } = render(<TerminalPanel />);

    const tabBar = container.querySelector<HTMLElement>('.overflow-x-auto')!;
    Object.defineProperty(tabBar, 'scrollWidth', { value: 800, configurable: true });
    Object.defineProperty(tabBar, 'clientWidth', { value: 300, configurable: true });
    tabBar.scrollLeft = 0;

    const wheelEvent = new Event('wheel', { bubbles: true, cancelable: true }) as WheelEvent;
    Object.defineProperty(wheelEvent, 'deltaY', { value: 120 });
    Object.defineProperty(wheelEvent, 'deltaX', { value: 0 });
    tabBar.dispatchEvent(wheelEvent);

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(tabBar.scrollLeft).toBe(120);
  });
});

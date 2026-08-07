import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TerminalSession } from '@/stores/terminal-store';
import { detectFrameLanguage, selectAgentSession } from './terminal-session-policy';

function session(overrides: Partial<TerminalSession>): TerminalSession {
  return {
    id: 'term-1',
    name: 'Agent Terminal 1',
    ptyId: null,
    isAgentSession: true,
    location: 'panel',
    cwd: null,
    lastCommand: null,
    commandHistory: [],
    isDead: false,
    ownerConversationId: null,
    activeToolCallId: null,
    awaitingInput: false,
    outputSequence: 0,
    ...overrides,
  };
}

const baseRequest = {
  conversationId: 'conversation-a',
  toolCallId: 'tool-1',
  forceNew: false,
  cwd: 'C:/workspace',
};

describe('selectAgentSession', () => {
  it('reuses a healthy session owned by the same conversation', () => {
    const sessions = [
      session({ id: 'term-a', ownerConversationId: 'conversation-a', cwd: 'C:/workspace', ptyId: 'pty-a' }),
      session({ id: 'term-b', ownerConversationId: 'conversation-b', cwd: 'C:/workspace', ptyId: 'pty-b' }),
    ];
    expect(selectAgentSession(sessions, baseRequest)?.id).toBe('term-a');
  });

  it('never reuses a session owned by another conversation', () => {
    const sessions = [session({ id: 'term-b', ownerConversationId: 'conversation-b', cwd: 'C:/workspace', ptyId: 'pty-b' })];
    expect(selectAgentSession(sessions, baseRequest)).toBeNull();
  });

  it('does not reuse an owned session from another cwd', () => {
    const sessions = [session({ id: 'term-other-cwd', ownerConversationId: 'conversation-a', cwd: 'C:/other', ptyId: 'pty-other' })];
    expect(selectAgentSession(sessions, baseRequest)).toBeNull();
  });

  it('isolates sub-agents through the owner id', () => {
    const sessions = [session({ id: 'term-a', ownerConversationId: 'conversation-a', cwd: 'C:/workspace', ptyId: 'pty-a' })];
    const child = selectAgentSession(sessions, {
      ...baseRequest,
      ownerId: 'sub-agent-1',
    });
    expect(child).toBeNull();
  });

  it('skips dead and PTY-less sessions', () => {
    const sessions = [
      session({ id: 'term-dead', ownerConversationId: 'conversation-a', cwd: 'C:/workspace', ptyId: 'pty-a', isDead: true }),
      session({ id: 'term-nopty', ownerConversationId: 'conversation-a', cwd: 'C:/workspace', ptyId: null }),
    ];
    expect(selectAgentSession(sessions, baseRequest)).toBeNull();
  });

  it('respects forceNew', () => {
    const sessions = [session({ id: 'term-a', ownerConversationId: 'conversation-a', cwd: 'C:/workspace', ptyId: 'pty-a' })];
    expect(selectAgentSession(sessions, { ...baseRequest, forceNew: true })).toBeNull();
  });

  it('returns null while another tool call owns the session', () => {
    const sessions = [
      session({
        id: 'term-a',
        ownerConversationId: 'conversation-a',
        cwd: 'C:/workspace',
        ptyId: 'pty-a',
        activeToolCallId: 'tool-other',
      }),
    ];
    expect(selectAgentSession(sessions, baseRequest)).toBeNull();
    expect(selectAgentSession(sessions, { ...baseRequest, toolCallId: 'tool-other' })?.id).toBe(
      'term-a',
    );
  });

  it('does not reuse a session waiting for user input', () => {
    const sessions = [
      session({
        id: 'term-awaiting',
        ownerConversationId: 'conversation-a',
        cwd: 'C:/workspace',
        ptyId: 'pty-awaiting',
        awaitingInput: true,
      }),
    ];
    expect(selectAgentSession(sessions, baseRequest)).toBeNull();
  });

  it('matches a named session within the same conversation', () => {
    const sessions = [
      session({ id: 'term-a', name: 'dev server', ownerConversationId: 'conversation-a', cwd: 'C:/workspace', ptyId: 'pty-a' }),
    ];
    expect(selectAgentSession(sessions, { ...baseRequest, sessionName: 'dev server' })?.id).toBe(
      'term-a',
    );
    expect(selectAgentSession(sessions, { ...baseRequest, sessionName: 'other' })).toBeNull();
  });

  it('rejects a named session locked by another tool call', () => {
    const sessions = [
      session({
        id: 'term-a',
        name: 'dev server',
        ownerConversationId: 'conversation-a',
        cwd: 'C:/workspace',
        ptyId: 'pty-a',
        activeToolCallId: 'tool-other',
      }),
    ];
    expect(selectAgentSession(sessions, { ...baseRequest, sessionName: 'dev server' })).toBeNull();
    expect(
      selectAgentSession(sessions, { ...baseRequest, sessionName: 'dev server', toolCallId: 'tool-other' })?.id,
    ).toBe('term-a');
  });
});

describe('detectFrameLanguage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects PowerShell on Windows', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    expect(detectFrameLanguage()).toBe('powershell');
  });

  it('falls back to bash on other platforms', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' });
    expect(detectFrameLanguage()).toBe('bash');
  });

  it('defaults to bash when navigator is unavailable', () => {
    vi.stubGlobal('navigator', undefined);
    expect(detectFrameLanguage()).toBe('bash');
  });
});

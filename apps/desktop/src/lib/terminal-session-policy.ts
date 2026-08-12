import {
  resolveTerminalShell,
  type TerminalAcquireRequest,
  type TerminalShell,
  type TerminalShellPlatform,
} from '@hyscode/agent-harness';

import type { TerminalSession } from '@/stores/terminal-store';

/**
 * Pure session-selection policy for agent terminals. The store keeps state;
 * this module decides which session (if any) satisfies an acquire request.
 */
export function selectAgentSession(
  sessions: TerminalSession[],
  request: Pick<
    TerminalAcquireRequest,
    'ownerId' | 'conversationId' | 'forceNew' | 'sessionName' | 'toolCallId' | 'cwd'
  >,
): TerminalSession | null {
  const isolationKey = request.ownerId ?? request.conversationId;
  if (request.forceNew) return null;

  let candidate: TerminalSession | null = null;
  if (request.sessionName) {
    candidate =
      sessions.find(
        (session) =>
          session.isAgentSession &&
          session.name === request.sessionName &&
          session.ownerConversationId === isolationKey &&
          !session.awaitingInput &&
          session.cwd === request.cwd,
      ) ?? null;
  } else {
    candidate =
      sessions.find(
        (session) =>
          session.isAgentSession &&
          !session.isDead &&
          !session.awaitingInput &&
          session.ptyId &&
          session.ownerConversationId === isolationKey &&
          session.cwd === request.cwd,
      ) ?? null;
  }
  if (candidate?.activeToolCallId && candidate.activeToolCallId !== request.toolCallId) {
    return null;
  }
  return candidate;
}

export function detectTerminalPlatform(): TerminalShellPlatform {
  return typeof navigator !== 'undefined' && navigator.userAgent?.includes('Win') ? 'windows' : 'posix';
}

/** Resolve the shell configured for the desktop PTY and its matching frame language. */
export function resolveDesktopShell(configuredShell?: string | null): TerminalShell {
  return resolveTerminalShell(configuredShell, detectTerminalPlatform());
}

/** Shell language the desktop runtime spawns; capture frames must match it. */
export function detectFrameLanguage(configuredShell?: string | null): 'bash' | 'powershell' {
  return resolveDesktopShell(configuredShell).frameLanguage;
}

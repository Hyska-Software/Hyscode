import type { TerminalAcquireRequest } from '@hyscode/agent-harness';

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

/** Shell language the desktop runtime spawns; capture frames must match it. */
export function detectFrameLanguage(): 'bash' | 'powershell' {
  return typeof navigator !== 'undefined' && navigator.userAgent?.includes('Win')
    ? 'powershell'
    : 'bash';
}

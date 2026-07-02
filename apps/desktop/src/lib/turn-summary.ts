import type { TurnRecord } from '@hyscode/agent-harness';
import type { AgentEditSession, TurnSummary } from '@/stores/agent-store';
import { countDiffLines } from './compute-diff';

export function buildTurnSummary(
  turnId: string,
  record: TurnRecord,
  sessions: AgentEditSession[],
): TurnSummary {
  return {
    turnId,
    status: record.stopReason,
    durationMs: record.durationMs,
    toolCallCount: record.toolCalls.length,
    files: sessions
      .filter((session) => session.turnId === turnId)
      .map((session) => {
        const counts = countDiffLines(session.hunks);
        return {
          sessionId: session.id,
          filePath: session.filePath,
          kind:
            session.originalContent === null
              ? 'created'
              : session.newContent.length === 0
                ? 'deleted'
                : 'edited',
          added: counts.added,
          removed: counts.removed,
          originalContent: session.originalContent,
          newContent: session.newContent,
          hunks: session.hunks,
          resolution:
            session.phase === 'accepted'
              ? 'kept'
              : session.phase === 'rejected'
                ? 'undone'
                : 'pending',
        };
      }),
  };
}

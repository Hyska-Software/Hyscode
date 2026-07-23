import { describe, expect, it } from 'vitest';
import type { TurnRecord } from '@hyscode/agent-harness';
import type { AgentEditSession } from '@/stores/agent-store';
import { computeDiffHunks } from './compute-diff';
import { buildTurnSummary } from './turn-summary';

function record(id: string): TurnRecord {
  return {
    id,
    conversationId: 'conversation-1',
    mode: 'build',
    iterations: 1,
    toolCalls: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    stopReason: 'complete',
    verificationPerformed: false,
    verificationForced: false,
    filesModified: [],
    durationMs: 1_500,
    timestamp: new Date(0).toISOString(),
  };
}

function session(
  turnId: string,
  originalContent: string | null,
  newContent: string,
): AgentEditSession {
  return {
    id: `${turnId}:${newContent}`,
    turnId,
    filePath: `${turnId}.ts`,
    toolName: 'write_file',
    toolCallId: `tool:${turnId}`,
    originalContent,
    newContent,
    phase: 'pending_review',
    isNewFile: originalContent === null,
    hunks: computeDiffHunks(originalContent, newContent),
    createdAt: 0,
  };
}

describe('buildTurnSummary', () => {
  it('uses the canonical turn id when the persisted record has a different id', () => {
    const summary = buildTurnSummary('turn-a', record('record-a'), [
      session('turn-a', 'one\ntwo', 'one\nchanged'),
      session('turn-b', null, 'unrelated'),
    ]);

    expect(summary.turnId).toBe('turn-a');
    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]).toMatchObject({
      kind: 'edited',
      added: 1,
      removed: 1,
      resolution: 'pending',
    });
  });

  it('returns a compact summary when no files changed', () => {
    expect(buildTurnSummary('turn-empty', record('record-empty'), []).files).toEqual([]);
  });
});

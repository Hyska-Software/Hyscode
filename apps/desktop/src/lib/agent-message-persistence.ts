import type { ChatMessage } from '@/stores/agent-store';

export type PersistedAgentMessageRow = {
  id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  blocks: string | null;
  turn_summary: string | null;
  created_at: string;
};

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/** Convert a database row without losing protocol messages used by tool calls. */
export function mapPersistedAgentMessage(row: PersistedAgentMessageRow): ChatMessage | null {
  if (row.role !== 'user' && row.role !== 'assistant' && row.role !== 'tool') return null;

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    toolCalls: parseJson<ChatMessage['toolCalls']>(row.tool_calls),
    blocks: parseJson<NonNullable<ChatMessage['blocks']>>(row.blocks),
    turnSummary: parseJson<ChatMessage['turnSummary']>(row.turn_summary),
    timestamp: Date.parse(row.created_at),
  };
}

import type { Message, MessageContent } from '@hyscode/ai-providers';

type ToolResultContent = Extract<MessageContent, { type: 'tool_result' }>;

type PendingToolFrame = {
  assistant: Message;
  expectedToolCallIds: Set<string>;
  receivedToolCallIds: Set<string>;
  toolMessages: Message[];
};

function cloneMessage(message: Message): Message {
  return { role: message.role, content: [...message.content] };
}

function assistantWithoutToolCalls(message: Message): Message | null {
  const content = message.content.filter((block) => block.type !== 'tool_call');
  return content.length > 0 ? { role: 'assistant', content } : null;
}

function toolResultsForFrame(
  message: Message,
  frame: PendingToolFrame,
): ToolResultContent[] {
  return message.content.filter(
    (block): block is ToolResultContent =>
      block.type === 'tool_result' &&
      frame.expectedToolCallIds.has(block.toolCallId) &&
      !frame.receivedToolCallIds.has(block.toolCallId),
  );
}

function toolCallIds(message: Message): string[] {
  return message.content
    .filter((block): block is Extract<MessageContent, { type: 'tool_call' }> => block.type === 'tool_call')
    .map((block) => block.id);
}

/**
 * Keep the history accepted by OpenAI-compatible providers structurally valid.
 *
 * Older sessions may contain an assistant tool-call message without every tool
 * result because the UI used to drop persisted `role: tool` rows during restore.
 * Incomplete frames are reduced to any assistant text/thinking content and their
 * partial tool results are discarded, preventing a provider-level 400 on retry.
 */
export function normalizeAgentHistory(messages: Message[]): Message[] {
  const normalized: Message[] = [];
  let pending: PendingToolFrame | null = null;

  const flushPending = (): void => {
    if (!pending) return;
    const fallback = assistantWithoutToolCalls(pending.assistant);
    if (fallback) normalized.push(fallback);
    pending = null;
  };

  for (const message of messages) {
    if (pending) {
      if (message.role === 'tool') {
        const results = toolResultsForFrame(message, pending);
        if (results.length > 0) {
          pending.toolMessages.push({ role: 'tool', content: results });
          for (const result of results) pending.receivedToolCallIds.add(result.toolCallId);
        }
        if (pending.receivedToolCallIds.size === pending.expectedToolCallIds.size) {
          normalized.push(cloneMessage(pending.assistant));
          normalized.push(...pending.toolMessages);
          pending = null;
        }
        continue;
      }

      flushPending();
    }

    if (message.role === 'assistant') {
      const ids = toolCallIds(message);
      if (ids.length > 0) {
        pending = {
          assistant: cloneMessage(message),
          expectedToolCallIds: new Set(ids),
          receivedToolCallIds: new Set(),
          toolMessages: [],
        };
        continue;
      }
    }

    // A tool result without its assistant tool-call is not valid provider history.
    if (message.role === 'tool') continue;
    normalized.push(cloneMessage(message));
  }

  flushPending();
  return normalized;
}

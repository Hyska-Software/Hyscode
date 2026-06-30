import type { Message, ToolDefinition } from './types';

/**
 * Approximate token counter using character-based estimation.
 * Ratio: ~4 characters per token (reasonable average across models).
 * This avoids heavy WASM tokenizer dependencies.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    // Overhead per message (role, formatting)
    total += 4;
    for (const content of msg.content) {
      switch (content.type) {
        case 'text':
          total += estimateTokens(content.text);
          break;
        case 'tool_call':
          total += estimateTokens(content.name);
          total += estimateTokens(JSON.stringify(content.input));
          total += 10; // overhead for tool call structure
          break;
        case 'tool_result':
          total += estimateTokens(content.output);
          total += 5; // overhead
          break;
        case 'image':
          // Images typically cost ~1000-2000 tokens depending on size
          total += 1500;
          break;
        case 'thinking':
          total += estimateTokens(content.thinking);
          break;
      }
    }
  }
  return total;
}

export function estimateToolDefinitionTokens(tools: ToolDefinition[]): number {
  let total = 0;
  for (const tool of tools) {
    total += estimateTokens(tool.name);
    total += estimateTokens(tool.description);
    total += estimateTokens(JSON.stringify(tool.inputSchema));
    total += 10; // structure overhead
  }
  return total;
}

export function estimateSystemPromptTokens(systemPrompt: string): number {
  return estimateTokens(systemPrompt) + 4; // system role overhead
}

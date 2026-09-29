import type { Message, ToolDefinition } from './types';

/**
 * Approximate token counter using character-based estimation.
 *
 * LIMITATIONS (documented):
 * - This is a heuristic (~4 chars/token for Latin scripts), NOT a real
 *   tokenizer. Real tokenizers (tiktoken, SentencePiece) split CJK text
 *   into far more tokens per character, and multimodal image cost depends
 *   on resolution/tiling. Use provider-native `countTokens` when the
 *   provider exposes it (see `estimateTokensMaybeNative`); otherwise treat
 *   these numbers as rough budgets for truncation warnings, never billing.
 * - Image cost is a flat 1500 tokens (upper bound for large images after
 *   tiling). Kept at 1500 rather than 800 so we over-estimate and truncate
 *   early instead of overflowing context.
 */
const CHARS_PER_TOKEN = 4;
/** CJK Unified Ideographs range — denser tokenization (~2.5 chars/token). */
const CJK_RE = /[\u4e00-\u9fff]/;
const CJK_CHARS_PER_TOKEN = 2.5;
/** Flat image estimate (see LIMITATIONS above). */
const IMAGE_TOKENS = 1500;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const charsPerToken = CJK_RE.test(text) ? CJK_CHARS_PER_TOKEN : CHARS_PER_TOKEN;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Prefer provider-native counting when the provider opts in via
 * `capabilities.nativeTokenCounting` and exposes `countTokens(text)`.
 * Falls back to the character heuristic otherwise.
 */
export async function estimateTokensMaybeNative(
  text: string,
  provider?: { capabilities?: { nativeTokenCounting?: boolean }; countTokens?: (t: string) => number | Promise<number> },
): Promise<number> {
  if (provider?.capabilities?.nativeTokenCounting && typeof provider.countTokens === 'function') {
    try {
      return await provider.countTokens(text);
    } catch (err) {
      console.warn('[token-counter] native countTokens failed, using heuristic fallback:', err);
    }
  }
  return estimateTokens(text);
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
          // Flat upper-bound estimate; real cost varies by resolution/tiling.
          total += IMAGE_TOKENS;
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

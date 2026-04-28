// ─── Inline Completion Service ──────────────────────────────────────────────
// Fetches AI-powered inline completions (ghost text) for the Monaco editor.
// Uses the ProviderRegistry to stream completions from the configured provider.

import { getProviderRegistry } from '@hyscode/ai-providers';
import type { Message } from '@hyscode/ai-providers';

export interface InlineCompletionContext {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
}

export interface InlineCompletionResult {
  text: string;
}

const SYSTEM_PROMPT = `You are an expert code completion engine.
Your task is to predict the code that should appear at the cursor position (<|cursor|>).
Only output the raw code that belongs at the cursor — do NOT include markdown, explanations, or the surrounding context.
Match the indentation and style of the existing code exactly.
If there is nothing meaningful to complete, output an empty string.`;

function buildUserMessage(ctx: InlineCompletionContext): string {
  return `File: ${ctx.filePath}
Language: ${ctx.language}

Complete the code at the cursor position:

<|prefix|>
${ctx.prefix}
<|cursor|>
${ctx.suffix}
<|suffix|>`;
}

/**
 * Request an inline completion from the AI provider.
 * Streams the response and returns the full completion text.
 */
export async function fetchInlineCompletion(
  ctx: InlineCompletionContext,
  options: {
    providerId?: string | null;
    modelId?: string | null;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  },
): Promise<InlineCompletionResult> {
  console.log('[InlineCompletion] fetchInlineCompletion called', {
    filePath: ctx.filePath,
    language: ctx.language,
    prefixLength: ctx.prefix.length,
    suffixLength: ctx.suffix.length,
    providerId: options.providerId,
    modelId: options.modelId,
  });

  const registry = getProviderRegistry();

  let providerId = options.providerId;
  let modelId = options.modelId;

  if (!providerId || !modelId) {
    const def = registry.getDefault();
    providerId = providerId ?? def.provider.id;
    modelId = modelId ?? def.modelId;
    console.log('[InlineCompletion] using default provider/model:', providerId, modelId);
  }

  const messages: Message[] = [
    { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT }] },
    { role: 'user', content: [{ type: 'text', text: buildUserMessage(ctx) }] },
  ];

  let completionText = '';
  let thinkingText = '';

  try {
    const stream = registry.chat({
      providerId,
      model: modelId,
      messages,
      maxTokens: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.2,
      signal: options.signal,
    });

    for await (const chunk of stream) {
      console.log('[InlineCompletion] received chunk:', chunk.type, JSON.stringify(chunk));
      if (options.signal?.aborted) {
        console.log('[InlineCompletion] aborted mid-stream');
        break;
      }
      if (chunk.type === 'text_delta') {
        completionText += chunk.text;
      } else if (chunk.type === 'thinking_delta') {
        // Accumulate separately — only used as fallback if no text_delta was produced.
        thinkingText += chunk.text;
      } else if (chunk.type === 'error') {
        console.error('[InlineCompletion] stream error:', chunk.error);
        throw new Error(chunk.error);
      }
    }

    // Some models (e.g. pure reasoning models) only emit thinking_delta with no text_delta.
    // Fall back to thinking content only when no real text output was produced.
    if (!completionText && thinkingText) {
      console.log('[InlineCompletion] no text_delta received — using thinking fallback');
      completionText = thinkingText;
    }
  } catch (err) {
    console.error('[InlineCompletion] fetch error:', err);
    throw err;
  }

  console.log('[InlineCompletion] raw completion text:', JSON.stringify(completionText));

  // Clean up the response: remove markdown code fences if present
  let cleaned = completionText.trim();
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
    cleaned = lines.join('\n');
  }

  // Remove any accidental <|cursor|> or <|prefix|> / <|suffix|> tags
  cleaned = cleaned.replace(/<\|cursor\|>/g, '').replace(/<\|prefix\|>/g, '').replace(/<\|suffix\|>/g, '');

  console.log('[InlineCompletion] cleaned completion text:', JSON.stringify(cleaned));

  return { text: cleaned };
}

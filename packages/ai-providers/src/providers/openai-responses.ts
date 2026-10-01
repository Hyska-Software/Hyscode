import type { ChatParams, FetchImpl, Message, StreamChunk, TokenUsage } from '../types';
import { ProviderError } from '../types';
import { parseSSEStream } from '../retry';
import { withOpencodeHeaders } from '../opencode-headers';

// ─── OpenAI Responses API helper ─────────────────────────────────────────────
// Shared wire-format adapter for the Responses API used by OpenCode Zen
// (https://opencode.ai/zen/v1/responses) and OpenCode Go
// (https://opencode.ai/zen/go/v1/responses) for GPT models.
//
// The Responses API uses a different wire format from chat completions:
//   - system content goes in the top-level `instructions` field (NOT input items)
//   - user content parts use `input_text` / `input_image` types
//   - assistant content parts use `output_text` types
//   - tool results and tool calls are top-level input items
//     (`function_call_output` / `function_call`), not `role: tool` messages
//   - tools are flat `{ type: 'function', name, parameters }` objects
//   - there is no `stop` parameter

interface ResponsesInput {
  instructions?: string;
  input: unknown[];
}

interface ResponsesInputOptions {
  explicitCacheBreakpoint?: boolean;
}

/**
 * Convert HysCode messages into Responses API `instructions` + `input` items.
 */
export function toResponsesInput(
  messages: Message[],
  systemPrompt?: string,
  options: ResponsesInputOptions = {},
): ResponsesInput {
  const instructionsParts: string[] = [];
  const input: unknown[] = [];

  if (systemPrompt) instructionsParts.push(systemPrompt);

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      if (text) instructionsParts.push(text);
      continue;
    }

    if (msg.role === 'tool') {
      for (const c of msg.content) {
        if (c.type === 'tool_result') {
          input.push({
            type: 'function_call_output',
            call_id: c.toolCallId,
            output: c.output,
          });
        }
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const textParts: string[] = [];
      const toolCalls: unknown[] = [];
      for (const c of msg.content) {
        if (c.type === 'text') textParts.push(c.text);
        if (c.type === 'tool_call') {
          toolCalls.push({
            type: 'function_call',
            call_id: c.id,
            name: c.name,
            arguments: JSON.stringify(c.input),
          });
        }
      }
      // Stored thinking blocks are provider-specific summaries, not the opaque
      // reasoning items returned by this API. Replaying them as Responses items
      // makes model switching invalid, so only replay visible assistant text.
      if (textParts.length) input.push({ role: 'assistant', content: textParts.join('') });
      input.push(...toolCalls);
      continue;
    }

    // user message
    const parts: unknown[] = [];
    for (const c of msg.content) {
      if (c.type === 'text') parts.push({ type: 'input_text', text: c.text });
      if (c.type === 'image') {
        parts.push({
          type: 'input_image',
          image_url: `data:${c.mediaType};base64,${c.base64}`,
        });
      }
    }
    if (parts.length) input.push({ role: 'user', content: parts });
  }

  const instructions = instructionsParts.length ? instructionsParts.join('\n\n') : undefined;
  if (options.explicitCacheBreakpoint && instructions) {
    input.unshift({
      role: 'system',
      content: [
        {
          type: 'input_text',
          text: instructions,
          prompt_cache_breakpoint: { mode: 'explicit' },
        },
      ],
    });
    return { input };
  }

  return { instructions, input };
}

export interface ResponsesAPIConfig {
  providerId: string;
  providerName: string;
  apiKey: string;
  /** Base URL without the /responses suffix (e.g. https://opencode.ai/zen/v1) */
  baseUrl: string;
  fetchImpl: FetchImpl;
  /** Whether this endpoint/model accepts the current explicit cache fields. */
  supportsExplicitPromptCaching?: boolean;
}

type ResponsesToolCallIdentity = {
  currentToolId: string;
  byItemId: Map<string, string>;
  byOutputIndex: Map<number, string>;
  activeCallIds: Set<string>;
};

/**
 * Streams a chat request through the OpenAI Responses API endpoint.
 * The Responses API uses a different wire format from chat completions.
 */
export async function* chatResponsesAPI(
  params: ChatParams,
  config: ResponsesAPIConfig,
): AsyncIterable<StreamChunk> {
  const explicitCacheRequested =
    params.cachePrompt === true || params.promptCacheOptions?.mode === 'explicit';
  const explicitCache = explicitCacheRequested && config.supportsExplicitPromptCaching === true;
  const { instructions, input } = toResponsesInput(params.messages, params.systemPrompt, {
    explicitCacheBreakpoint: explicitCache,
  });

  const body: Record<string, unknown> = {
    model: params.model,
    input,
    stream: true,
  };

  const promptCacheKey = params.promptCacheKey ?? params.promptCacheOptions?.key;
  if (promptCacheKey) body.prompt_cache_key = promptCacheKey;
  if (explicitCache) body.prompt_cache_options = { mode: 'explicit' };

  if (instructions) body.instructions = instructions;
  if (params.tools?.length) {
    body.tools = params.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    }));
  }
  if (params.maxTokens) body.max_output_tokens = params.maxTokens;
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.topP !== undefined) body.top_p = params.topP;
  if (params.thinking?.enabled && params.thinking.level && params.thinking.level !== 'disabled') {
    const effort = params.thinking.level === 'enabled' ? 'medium' : params.thinking.level;
    const reasoning: Record<string, unknown> = { effort, summary: 'auto' };
    // GPT-5.6 family supports reasoning.mode = standard (default) | pro
    if (params.thinking.mode) reasoning.mode = params.thinking.mode;
    body.reasoning = reasoning;
  }

  const url = `${config.baseUrl}/responses`;
  const response = await config.fetchImpl(url, {
    method: 'POST',
    headers: withOpencodeHeaders(
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      url,
      params.sessionId,
    ),
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfterMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1_000 : undefined;
    const status = response.status;
    // The error body may contain arbitrary provider text — never let it drive
    // the kind classification (e.g. "Upstream" contains "stream").
    const kind =
      status === 401 || status === 403
        ? 'authentication'
        : status === 429
          ? 'rate_limit'
          : status >= 500
            ? 'unavailable'
            : 'invalid_response';
    throw new ProviderError(
      `${config.providerName} Responses API error: ${status} ${errorBody}`,
      config.providerId,
      status,
      [429, 500, 502, 503].includes(status),
      retryAfterMs,
      kind,
      'connecting',
    );
  }

  const toolCallIdentity: ResponsesToolCallIdentity = {
    currentToolId: '',
    byItemId: new Map(),
    byOutputIndex: new Map(),
    activeCallIds: new Set(),
  };
  const completedToolCallIds = new Set<string>();

  for await (const data of parseSSEStream(response, params.signal)) {
    const chunks = parseResponsesChunk(data, toolCallIdentity, config.providerId);
    for (const chunk of chunks) {
      if (chunk.type === 'tool_call_end') {
        if (completedToolCallIds.has(chunk.id)) continue;
        completedToolCallIds.add(chunk.id);
      }
      yield chunk;
    }
  }
}

/**
 * Parse a single SSE data chunk from the OpenAI Responses API.
 */
export function parseResponsesChunk(
  data: string,
  currentTool: string | ResponsesToolCallIdentity,
  providerId: string,
): StreamChunk[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new ProviderError(
      `Malformed OpenCode SSE event: ${error instanceof Error ? error.message : String(error)}`,
      providerId,
      undefined,
      false,
      undefined,
      'invalid_response',
      'parsing',
    );
  }

  const eventType = parsed.type as string;
  const identity = typeof currentTool === 'string' ? undefined : currentTool;
  const currentToolId = typeof currentTool === 'string' ? currentTool : currentTool.currentToolId;
  const resolveCallId = (): string => {
    const callId = parsed.call_id;
    if (typeof callId === 'string' && callId) return callId;
    const itemId = parsed.item_id;
    if (typeof itemId === 'string') {
      const mappedCallId = identity?.byItemId.get(itemId);
      if (mappedCallId) return mappedCallId;
    }
    const outputIndex = parsed.output_index;
    if (typeof outputIndex === 'number') {
      const mappedCallId = identity?.byOutputIndex.get(outputIndex);
      if (mappedCallId) return mappedCallId;
    }
    if (!identity || identity.activeCallIds.size <= 1) return currentToolId;
    return '';
  };

  switch (eventType) {
    case 'response.output_text.delta': {
      const delta = parsed.delta as string | undefined;
      if (delta) return [{ type: 'text_delta', text: delta }];
      break;
    }
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta': {
      const delta = parsed.delta as string | undefined;
      if (delta) return [{ type: 'thinking_delta', text: delta }];
      break;
    }
    case 'response.content_part.added': {
      const part = parsed.part as Record<string, unknown> | undefined;
      if (part?.type === 'output_text' && part.text) {
        return [{ type: 'text_delta', text: part.text as string }];
      }
      break;
    }
    case 'response.output_item.added': {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (item?.type === 'function_call') {
        const name = (item.name as string) ?? '';
        const itemId = typeof item.id === 'string' ? item.id : undefined;
        const outputIndex = parsed.output_index;
        const callId =
          (typeof item.call_id === 'string' && item.call_id) ||
          itemId ||
          `call_${typeof outputIndex === 'number' ? outputIndex : crypto.randomUUID()}`;
        if (identity) {
          identity.currentToolId = callId;
          identity.activeCallIds.add(callId);
          if (itemId) identity.byItemId.set(itemId, callId);
          identity.byItemId.set(callId, callId);
          if (typeof outputIndex === 'number') identity.byOutputIndex.set(outputIndex, callId);
        }
        return [{ type: 'tool_call_start', id: callId, name }];
      }
      break;
    }
    case 'response.function_call_arguments.delta':
    // Keep accepting the legacy alias used by some Responses-compatible gateways.
    case 'response.tool_call_arguments.delta': {
      const delta = parsed.delta as string | undefined;
      if (delta) {
        const callId = resolveCallId();
        if (callId) return [{ type: 'tool_call_delta', id: callId, input: delta }];
      }
      break;
    }
    case 'response.function_call_arguments.done': {
      const callId = resolveCallId();
      if (callId) {
        identity?.activeCallIds.delete(callId);
        if (identity?.currentToolId === callId) identity.currentToolId = '';
        return [{ type: 'tool_call_end', id: callId }];
      }
      break;
    }
    case 'response.output_item.done': {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (item?.type === 'function_call') {
        const itemId = typeof item.id === 'string' ? item.id : undefined;
        const callId =
          (typeof item.call_id === 'string' && item.call_id) ||
          (itemId && identity?.byItemId.get(itemId)) ||
          itemId ||
          currentToolId;
        if (callId) {
          identity?.activeCallIds.delete(callId);
          if (identity?.currentToolId === callId) identity.currentToolId = '';
          return [{ type: 'tool_call_end', id: callId }];
        }
      }
      break;
    }
    case 'response.completed': {
      const resp = parsed.response as Record<string, unknown> | undefined;
      const usage = resp?.usage as Record<string, unknown> | undefined;
      const chunks: StreamChunk[] = [];
      if (usage) {
        const outputDetails = usage.output_tokens_details as Record<string, unknown> | undefined;
        const tokenUsage: TokenUsage = {
          inputTokens: (usage.input_tokens as number) ?? 0,
          outputTokens: (usage.output_tokens as number) ?? 0,
          totalTokens: (usage.total_tokens as number) ?? 0,
        };
        const inputDetails = usage.input_tokens_details as Record<string, unknown> | undefined;
        if (typeof inputDetails?.cached_tokens === 'number') {
          tokenUsage.cacheReadTokens = inputDetails.cached_tokens;
        }
        if (typeof inputDetails?.cache_write_tokens === 'number') {
          tokenUsage.cacheWriteTokens = inputDetails.cache_write_tokens;
        }
        if (typeof outputDetails?.reasoning_tokens === 'number') {
          tokenUsage.reasoningTokens = outputDetails.reasoning_tokens;
        }
        chunks.push({
          type: 'usage',
          usage: tokenUsage,
        });
      }
      chunks.push({ type: 'done', stopReason: 'end_turn' });
      return chunks;
    }
  }

  return [];
}

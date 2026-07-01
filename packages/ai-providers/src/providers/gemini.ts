import type {
  AIProvider,
  AIModel,
  ChatParams,
  StreamChunk,
  Message,
  ToolDefinition,
  StopReason,
  FetchImpl,
  ThinkingVariants,
  ProviderCapabilities,
} from '../types';
import { ProviderError } from '../types';

// ─── Thinking variant presets ────────────────────────────────────────────────
// Aligned with the official OpenCode built-in variants
// (https://dev.opencode.ai/docs/models/#variants): Google supports low / high.
// The Gemini API uses a numeric thinkingBudget; map the level to a token count.

const GEMINI_THINKING_VARIANTS: ThinkingVariants = {
  kind: 'gemini',
  levels: ['low', 'high'],
  defaultLevel: 'high',
};

/** Map an OpenCode Gemini thinking level to a thinkingBudget token count. */
function thinkingBudgetForLevel(level?: string): number {
  switch (level) {
    case 'low':
      return 0; // 0 disables thinking budget expansion beyond the minimum
    case 'high':
      return 24_576;
    default:
      return 24_576;
  }
}

// ─── Gemini Message Formatting ──────────────────────────────────────────────

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { content: string } } };

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

function toGeminiContents(messages: Message[]): GeminiContent[] {
  const result: GeminiContent[] = [];

  // Build a map from tool call ID → function name so that functionResponse
  // can reference the correct name. Gemini API requires functionResponse.name
  // to match a functionDeclaration.name, NOT the call ID.
  const callIdToName = new Map<string, string>();
  for (const msg of messages) {
    for (const c of msg.content) {
      if (c.type === 'tool_call') {
        callIdToName.set(c.id, c.name);
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === 'system') continue; // handled via systemInstruction

    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [];

    for (const c of msg.content) {
      switch (c.type) {
        case 'text':
          parts.push({ text: c.text });
          break;
        case 'image':
          parts.push({ inlineData: { mimeType: c.mediaType, data: c.base64 } });
          break;
        case 'tool_call':
          parts.push({ functionCall: { name: c.name, args: c.input } });
          break;
        case 'tool_result':
          parts.push({
            functionResponse: {
              name: callIdToName.get(c.toolCallId) ?? c.toolCallId,
              response: { content: c.output },
            },
          });
          break;
      }
    }

    // Merge consecutive same-role
    const last = result[result.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      result.push({ role, parts });
    }
  }

  return result;
}

function toGeminiTools(tools: ToolDefinition[]): {
  functionDeclarations: GeminiFunctionDeclaration[];
} {
  return {
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    })),
  };
}

// ─── Streaming Response Parser ──────────────────────────────────────────────

function* parseGeminiResponse(data: string): Iterable<StreamChunk> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new ProviderError(
      `Malformed Gemini SSE event: ${error instanceof Error ? error.message : String(error)}`,
      'gemini',
      undefined,
      false,
      undefined,
      'invalid_response',
      'parsing',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = parsed.candidates as any[];
  if (!candidates?.length) {
    // Check for usageMetadata
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = parsed.usageMetadata as any;
    if (usage) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
          totalTokens: usage.totalTokenCount ?? 0,
          cacheReadTokens: usage.cachedContentTokenCount ?? 0,
          reasoningTokens: usage.thoughtsTokenCount ?? 0,
        },
      };
    }
    return;
  }

  const candidate = candidates[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = candidate.content?.parts as any[];

  if (parts) {
    let hasFunctionCalls = false;
    for (const part of parts) {
      if (part.text) {
        yield { type: 'text_delta', text: part.text };
      }
      if (part.functionCall) {
        hasFunctionCalls = true;
        const callId = `gemini_${part.functionCall.name}_${Date.now()}`;
        yield { type: 'tool_call_start', id: callId, name: part.functionCall.name };
        yield {
          type: 'tool_call_delta',
          id: callId,
          input: JSON.stringify(part.functionCall.args ?? {}),
        };
        yield { type: 'tool_call_end', id: callId };
      }
    }

    // Check finish reason — override to 'tool_use' if function calls were present
    if (candidate.finishReason) {
      if (hasFunctionCalls) {
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        const reasonMap: Record<string, StopReason> = {
          STOP: 'end_turn',
          MAX_TOKENS: 'max_tokens',
          SAFETY: 'end_turn',
          RECITATION: 'end_turn',
        };
        yield { type: 'done', stopReason: reasonMap[candidate.finishReason] ?? 'end_turn' };
      }
    }
  } else if (candidate.finishReason) {
    const reasonMap: Record<string, StopReason> = {
      STOP: 'end_turn',
      MAX_TOKENS: 'max_tokens',
      SAFETY: 'end_turn',
      RECITATION: 'end_turn',
    };
    yield { type: 'done', stopReason: reasonMap[candidate.finishReason] ?? 'end_turn' };
  }

  // Usage metadata
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usageMeta = parsed.usageMetadata as any;
  if (usageMeta) {
    yield {
      type: 'usage',
      usage: {
        inputTokens: usageMeta.promptTokenCount ?? 0,
        outputTokens: usageMeta.candidatesTokenCount ?? 0,
        totalTokens: usageMeta.totalTokenCount ?? 0,
        cacheReadTokens: usageMeta.cachedContentTokenCount ?? 0,
        reasoningTokens: usageMeta.thoughtsTokenCount ?? 0,
      },
    };
  }
}

// ─── Provider Implementation ────────────────────────────────────────────────

const GEMINI_MODELS: AIModel[] = [
  // ── Gemini 3.x models ──
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2.0,
    outputPricePerMToken: 12.0,
    thinkingVariants: GEMINI_THINKING_VARIANTS,
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.5,
    outputPricePerMToken: 9,
    thinkingVariants: GEMINI_THINKING_VARIANTS,
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 3.0,
    thinkingVariants: GEMINI_THINKING_VARIANTS,
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.25,
    outputPricePerMToken: 1.5,
    thinkingVariants: GEMINI_THINKING_VARIANTS,
  },
  // ── Gemini 2.5 stable models ──
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.25,
    outputPricePerMToken: 10.0,
    thinkingVariants: GEMINI_THINKING_VARIANTS,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_535, // OpenRouter reports 65,535 for Vertex provider
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 2.5,
    thinkingVariants: GEMINI_THINKING_VARIANTS,
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_535, // OpenRouter reports 65,535 for Vertex provider
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.1,
    outputPricePerMToken: 0.4,
  },
];

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini';
  readonly capabilities: ProviderCapabilities = {
    promptCache: 'automatic',
    reasoningReplay: 'none',
    nativeTokenCounting: false,
    acceptsPromptCacheKey: false,
  };
  models: AIModel[] = [...GEMINI_MODELS];

  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: FetchImpl;

  constructor(
    apiKey: string,
    baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
    fetchImpl?: FetchImpl,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async listModels(): Promise<AIModel[]> {
    return this.models;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const contents = toGeminiContents(params.messages);

    const body: Record<string, unknown> = { contents };

    if (params.systemPrompt) {
      body.systemInstruction = { parts: [{ text: params.systemPrompt }] };
    }
    if (params.tools?.length) {
      body.tools = [toGeminiTools(params.tools)];
    }

    const generationConfig: Record<string, unknown> = {};
    if (params.maxTokens) generationConfig.maxOutputTokens = params.maxTokens;
    if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
    if (params.topP !== undefined) generationConfig.topP = params.topP;
    if (params.stopSequences?.length) generationConfig.stopSequences = params.stopSequences;
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

    if (params.thinking?.enabled) {
      // Official OpenCode Gemini variants are low / high (effort/token budget).
      // Map them to a thinkingBudget token count; includeThoughts surfaces the
      // reasoning trace in the stream.
      const budget = thinkingBudgetForLevel(params.thinking.level);
      body.thinkingConfig = { includeThoughts: true, thinkingBudget: budget };
    }

    const url = `${this.baseUrl}/models/${params.model}:streamGenerateContent?alt=sse`;

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1_000 : undefined;
      throw new ProviderError(
        `Gemini API error: ${response.status} ${errorBody}`,
        'gemini',
        response.status,
        [429, 500, 502, 503].includes(response.status),
        retryAfterMs,
      );
    }

    // Gemini streams SSE with JSON chunks containing candidates
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('No response body', 'gemini');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (params.signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;
            for (const chunk of parseGeminiResponse(data)) {
              yield chunk;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

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
import { withOpencodeHeaders } from '../opencode-headers';
import { parseSSEStream } from '../retry';

// ─── Thinking variant presets ────────────────────────────────────────────────
// Per official Gemini docs (ai.google.dev/gemini-api/docs/pricing, Oct 2026):
// 3.8 / 3.7 / 3.6 Flash + 3.5 Flash support thinking levels low/medium/high
// (3.8 default medium); 3.5 Flash Lite + 3 Flash support low/medium.
// The Gemini API uses a numeric thinkingBudget; map the level to a token count.

/** low/medium/high — Gemini 3.8 Flash (default medium), 3.7/3.6/3.5 Flash, 3.1 Pro */
export const GEMINI_THINKING_LMH_VARIANTS: ThinkingVariants = {
  kind: 'gemini',
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'medium',
};

/** low/medium — Gemini 3.5 Flash Lite, 3 Flash */
export const GEMINI_THINKING_LM_VARIANTS: ThinkingVariants = {
  kind: 'gemini',
  levels: ['low', 'medium'],
  defaultLevel: 'medium',
};

/** Map an OpenCode Gemini thinking level to a thinkingBudget token count. */
function thinkingBudgetForLevel(level?: string): number {
  switch (level) {
    case 'low':
      return 0; // 0 disables thinking budget expansion beyond the minimum
    case 'medium':
      return 8_192;
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
  if (!messages.length) throw new Error('model required: messages must not be empty');
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
        case 'thinking':
          // Preserve thinking as text so replay history doesn't lose it.
          parts.push({ text: `[thinking]${c.thinking}` });
          break;
        case 'image':
          if (c.base64.length > 20 * 1024 * 1024) {
            throw new Error('image too large: base64 payload exceeds 20MB');
          }
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
      const tokenUsage: import('../types').TokenUsage = {
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
        reasoningTokens: usage.thoughtsTokenCount ?? 0,
      };
      if (typeof usage.cachedContentTokenCount === 'number') {
        tokenUsage.cacheReadTokens = usage.cachedContentTokenCount;
      }
      yield {
        type: 'usage',
        usage: tokenUsage,
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
        const callId = `gemini_${part.functionCall.name}_${crypto.randomUUID()}`;
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
    const tokenUsage: import('../types').TokenUsage = {
      inputTokens: usageMeta.promptTokenCount ?? 0,
      outputTokens: usageMeta.candidatesTokenCount ?? 0,
      totalTokens: usageMeta.totalTokenCount ?? 0,
      reasoningTokens: usageMeta.thoughtsTokenCount ?? 0,
    };
    if (typeof usageMeta.cachedContentTokenCount === 'number') {
      tokenUsage.cacheReadTokens = usageMeta.cachedContentTokenCount;
    }
    yield {
      type: 'usage',
      usage: tokenUsage,
    };
  }
}

// ─── Provider Implementation ────────────────────────────────────────────────

// SOTA-only direct catalog (verified Oct 2026 against
// https://ai.google.dev/gemini-api/docs/pricing): GA text models —
// 3.8 / 3.7 / 3.6 Flash at introductory pricing ($0.75/$3.75, cache $0.075)
// through Dec 31 2026 (standard $1.50/$7.50 from Jan 01 2027),
// 3.5 Flash ($1.50/$9.00) and 3.5 Flash-Lite ($0.30/$2.50).
const GEMINI_MODELS: AIModel[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.75, // intro through Dec 31 2026; standard $1.50 from Jan 01 2027
    outputPricePerMToken: 3.75, // intro through Dec 31 2026; standard $7.50 from Jan 01 2027
    cachedInputPricePerMToken: 0.075,
    thinkingVariants: GEMINI_THINKING_LMH_VARIANTS,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.75, // intro through Dec 31 2026; standard $1.50 from Jan 01 2027
    outputPricePerMToken: 3.75, // intro through Dec 31 2026; standard $7.50 from Jan 01 2027
    cachedInputPricePerMToken: 0.075,
    thinkingVariants: GEMINI_THINKING_LMH_VARIANTS,
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.75, // intro through Dec 31 2026; standard $1.50 from Jan 01 2027
    outputPricePerMToken: 3.75, // intro through Dec 31 2026; standard $7.50 from Jan 01 2027
    cachedInputPricePerMToken: 0.075,
    thinkingVariants: GEMINI_THINKING_LMH_VARIANTS,
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
    cachedInputPricePerMToken: 0.15,
    thinkingVariants: GEMINI_THINKING_LMH_VARIANTS,
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    provider: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 2.5,
    cachedInputPricePerMToken: 0.03,
    thinkingVariants: GEMINI_THINKING_LM_VARIANTS,
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

  /** Zero the in-memory API key (secret hygiene on reinit/dispose). */
  clear(): void {
    this.apiKey = '';
  }

  dispose(): void {
    this.clear();
  }

  async listModels(): Promise<AIModel[]> {
    return this.models;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    if (!params.model) throw new Error('model required');
    if (!params.messages.length) throw new Error('model required: messages must not be empty');
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
      headers: withOpencodeHeaders(
        {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
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
      throw new ProviderError(
        `Gemini API error: ${response.status} ${errorBody}`,
        'gemini',
        response.status,
        [429, 500, 502, 503, 529].includes(response.status),
        retryAfterMs,
      );
    }

    if (!response.body) throw new ProviderError('No response body', 'gemini');

    // Gemini streams SSE with JSON chunks containing candidates.
    for await (const data of parseSSEStream(response, params.signal)) {
      for (const chunk of parseGeminiResponse(data)) {
        yield chunk;
      }
    }
  }
}

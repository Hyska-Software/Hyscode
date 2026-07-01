// ─── Message Types ──────────────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  base64: string;
  mediaType: string;
}

export interface ToolCallContent {
  type: 'tool_call';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolCallId: string;
  output: string;
  isError?: boolean;
}

/** Extended thinking / reasoning text from models that support it (Kimi, MiMo, Claude). */
export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

export type MessageContent =
  | TextContent
  | ImageContent
  | ToolCallContent
  | ToolResultContent
  | ThinkingContent;

export interface Message {
  role: MessageRole;
  content: MessageContent[];
}

// ─── Tool Definition ────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ─── Token Usage ────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount?: number;
  lastInputTokens?: number;
  lastEffectiveInputTokens?: number;
  peakInputTokens?: number;
  peakEffectiveInputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  retryCount?: number;
  estimatedCostUsd?: number;
  possibleDuplicateCharge?: boolean;
}

export type PromptCacheMode = 'none' | 'automatic' | 'automatic-keyed' | 'explicit-breakpoints';
export type ReasoningReplayMode = 'none' | 'model-dependent' | 'required';

export interface ProviderCapabilities {
  promptCache: PromptCacheMode;
  reasoningReplay: ReasoningReplayMode;
  nativeTokenCounting: boolean;
  acceptsPromptCacheKey: boolean;
}

// ─── Stream Chunks ──────────────────────────────────────────────────────────

export type StreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; input: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; stopReason: StopReason }
  | { type: 'error'; error: string; retryable?: boolean; details?: ProviderErrorDetails };

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';

// ─── Chat Parameters ────────────────────────────────────────────────────────

export interface ThinkingConfig {
  /** Whether thinking is enabled */
  enabled: boolean;
  /** Effort/level for providers that support it (OpenAI: low/medium/high/xhigh, Anthropic adaptive: low/medium/high, Anthropic budget: low/medium/high/max, Kimi: enabled/disabled) */
  level?: 'low' | 'medium' | 'high' | 'enabled' | 'disabled' | 'none' | 'minimal' | 'xhigh' | 'max';
  /** Budget tokens for providers that support it (Anthropic manual mode) */
  budgetTokens?: number;
  /** Provider-native thinking type override */
  type?: 'enabled' | 'adaptive' | 'disabled';
  /** Display mode for Anthropic thinking blocks */
  display?: 'summarized' | 'omitted';
}

export interface ChatParams {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  /** Allow providers with prompt-cache support to mark stable prompt prefixes. */
  cachePrompt?: boolean;
  promptCacheKey?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
  /** Thinking/reasoning configuration */
  thinking?: ThinkingConfig;
}

// ─── Transport ──────────────────────────────────────────────────────────────
// Abstraction over fetch so providers can route through a Tauri proxy instead
// of making direct browser fetch calls (which are blocked by CORS).

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// ─── Chat Response (non-streaming) ──────────────────────────────────────────

export interface ChatResponse {
  content: MessageContent[];
  stopReason: StopReason;
  usage: TokenUsage;
  model: string;
}

// ─── Provider & Model ───────────────────────────────────────────────────────

/** Thinking/reasoning variants supported by a model.
 *  The `kind` selects the wire-format adapter; `levels` are the values the
 *  underlying API accepts. When omitted, the model does not support thinking. */
export type ThinkingKind =
  | 'anthropic' // Anthropic messages: thinking: { type, effort | budget_tokens, display }
  | 'openai' // OpenAI Responses / chat.completions: reasoning_effort
  | 'gemini' // Gemini: thinkingConfig { includeThoughts, thinkingBudget }
  | 'kimi' // Moonshot-compatible (Kimi, MiMo, GLM, MiniMax on chat/completions): thinking: { type }
  | 'deepseek' // DeepSeek chat.completions: reasoning: { enabled }
  | 'mistral' // Mistral: thinking: { enable }
  | 'none';

export interface ThinkingVariants {
  kind: ThinkingKind;
  /** Levels accepted by the model — undefined for kimi/deepseek (binary enabled/disabled) */
  levels?: ReadonlyArray<
    'low' | 'medium' | 'high' | 'enabled' | 'disabled' | 'none' | 'minimal' | 'xhigh' | 'max'
  >;
  /** Default level when thinking is enabled without an explicit value */
  defaultLevel?: 'low' | 'medium' | 'high' | 'enabled';
  /** True for Anthropic models that accept the 'adaptive' type (opus 4.6+, sonnet 4.6, fable 5) */
  supportsAdaptive?: boolean;
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
  cachedInputPricePerMToken?: number;
  /** Thinking/reasoning capability declared by the provider */
  thinkingVariants?: ThinkingVariants;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  models: AIModel[];
  readonly capabilities?: ProviderCapabilities;
  chat(params: ChatParams): AsyncIterable<StreamChunk>;
  listModels(): Promise<AIModel[]>;
  isConfigured(): boolean;
}

// ─── Retry Config ───────────────────────────────────────────────────────────

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  onRetryStart?: (attempt: number) => void;
  signal?: AbortSignal;
}

// ─── Provider Error ─────────────────────────────────────────────────────────

export type ProviderErrorKind =
  | 'authentication'
  | 'rate_limit'
  | 'unavailable'
  | 'timeout'
  | 'offline'
  | 'connection'
  | 'stream_interrupted'
  | 'invalid_response'
  | 'context_overflow'
  | 'cancelled'
  | 'unknown';

export type ProviderErrorPhase = 'configuration' | 'connecting' | 'streaming' | 'parsing';

export type ProviderErrorDetails = {
  kind: ProviderErrorKind;
  phase: ProviderErrorPhase;
  provider: string;
  statusCode?: number;
  retryable: boolean;
  retryAfterMs?: number;
  technicalMessage: string;
  userMessage: string;
  requestId?: string;
};

export type ResilienceConfig = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
};

export const DEFAULT_RESILIENCE_CONFIG: ResilienceConfig = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  requestTimeoutMs: 120_000,
  streamIdleTimeoutMs: 90_000,
};

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs?: number,
    public readonly kind: ProviderErrorKind = classifyProviderErrorKind(message, statusCode),
    public readonly phase: ProviderErrorPhase = 'connecting',
    public readonly userMessage: string = providerErrorUserMessage(kind),
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  toDetails(): ProviderErrorDetails {
    return {
      kind: this.kind,
      phase: this.phase,
      provider: this.provider,
      statusCode: this.statusCode,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      technicalMessage: this.message,
      userMessage: this.userMessage,
      requestId: this.requestId,
    };
  }
}

export function classifyProviderErrorKind(message: string, statusCode?: number): ProviderErrorKind {
  const value = message.toLowerCase();
  if (statusCode === 401 || statusCode === 403 || /api.?key|auth|unauthor/.test(value))
    return 'authentication';
  if (statusCode === 429 || /rate.?limit|quota/.test(value)) return 'rate_limit';
  if (statusCode === 408 || /timed?\s*out|timeout/.test(value)) return 'timeout';
  if (/abort|cancel/.test(value)) return 'cancelled';
  if (/offline|internet.*unavailable/.test(value)) return 'offline';
  if (/context.*(length|window|token)|too many tokens/.test(value)) return 'context_overflow';
  if (
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 529 ||
    /overload|unavailable/.test(value)
  )
    return 'unavailable';
  if (/stream|body.*read|connection.*(closed|reset)|unexpected eof/.test(value))
    return 'stream_interrupted';
  if (/json|protocol|malformed|invalid response|parse/.test(value)) return 'invalid_response';
  if (/network|fetch|connect|dns|http request failed/.test(value)) return 'connection';
  return 'unknown';
}

export function providerErrorUserMessage(kind: ProviderErrorKind): string {
  switch (kind) {
    case 'authentication':
      return 'Authentication failed. Check the provider credentials in Settings.';
    case 'rate_limit':
      return 'The provider rate limit was reached. HysCode will retry when allowed.';
    case 'unavailable':
      return 'The AI provider is temporarily unavailable.';
    case 'timeout':
      return 'The provider took too long to respond.';
    case 'offline':
      return 'No internet connection. HysCode is waiting for the connection to return.';
    case 'connection':
      return 'The connection to the AI provider failed.';
    case 'stream_interrupted':
      return 'The response connection was interrupted.';
    case 'invalid_response':
      return 'The provider returned an invalid response.';
    case 'context_overflow':
      return "The conversation exceeds this model's context window.";
    case 'cancelled':
      return 'Request cancelled.';
    default:
      return 'The agent could not complete the request.';
  }
}

// ─── HTTP Proxy types (for Rust IPC) ────────────────────────────────────────

export interface StreamRequest {
  provider: string;
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface StreamEvent {
  id: string;
  data: string;
  done: boolean;
  error?: string;
}

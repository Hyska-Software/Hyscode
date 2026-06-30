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

export type MessageContent = TextContent | ImageContent | ToolCallContent | ToolResultContent | ThinkingContent;

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
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
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
  | { type: 'error'; error: string; retryable?: boolean };

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
  levels?: ReadonlyArray<'low' | 'medium' | 'high' | 'enabled' | 'disabled' | 'none' | 'minimal' | 'xhigh' | 'max'>;
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
  /** Thinking/reasoning capability declared by the provider */
  thinkingVariants?: ThinkingVariants;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  models: AIModel[];
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
}

// ─── Provider Error ─────────────────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
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

# AI Providers Architecture

## Overview

The AI Provider layer provides a **unified interface** for communicating with multiple LLM providers. Each provider adapter translates the internal message format to/from the provider's API, handles streaming, and manages authentication.

---

## Provider Interface

```typescript
interface AIProvider {
  readonly id: string; // "anthropic" | "openai" | "gemini" | "ollama" | "openrouter"
  readonly name: string; // Human-readable name
  readonly supportsStreaming: boolean;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;

  listModels(): Promise<AIModel[]>;

  chat(params: ChatParams): Promise<ChatResponse>;

  streamChat(params: ChatParams): AsyncIterable<StreamChunk>;

  countTokens(messages: Message[], model: string): Promise<number>;

  validateApiKey(key: string): Promise<boolean>;
}

interface AIModel {
  id: string; // "claude-sonnet-4-20250514"
  name: string; // "Claude Sonnet 4"
  provider: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  costPer1kInput?: number; // USD
  costPer1kOutput?: number;
}
```

---

## Unified Message Format

```typescript
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent[];
  toolCalls?: ToolCall[]; // assistant messages with tool use
  toolCallId?: string; // tool result messages
}

type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; base64: string; mediaType: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; content: string; isError?: boolean };

interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

interface ChatParams {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  systemPrompt?: string;
}
```

---

## Stream Protocol

All providers normalize to a unified streaming protocol:

```typescript
type StreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; input: string } // partial JSON
  | { type: 'tool_call_end'; id: string }
  | { type: 'message_start'; model: string; usage?: TokenUsage }
  | { type: 'message_end'; stopReason: string; usage: TokenUsage }
  | { type: 'error'; error: string; code?: string };

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
```

### Frontend Consumption

```typescript
// In agentStore
async function streamResponse(params: ChatParams) {
  const provider = getActiveProvider();
  const stream = provider.streamChat(params);

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'text_delta':
        appendToLastMessage(chunk.text);
        break;
      case 'tool_call_start':
        addPendingToolCall(chunk.id, chunk.name);
        break;
      case 'tool_call_delta':
        updateToolCallInput(chunk.id, chunk.input);
        break;
      case 'tool_call_end':
        finalizeToolCall(chunk.id);
        break;
      case 'message_end':
        updateTokenUsage(chunk.usage);
        break;
    }
  }
}
```

---

## Provider Implementations

### Anthropic (Claude)

```typescript
class AnthropicProvider implements AIProvider {
  // API: POST https://api.anthropic.com/v1/messages
  // Auth: x-api-key header
  // Streaming: SSE with event types: message_start, content_block_start,
  //            content_block_delta, content_block_stop, message_delta, message_stop
  // Tool use: native tool_use content blocks
  // Models: claude-sonnet-4-20250514, claude-opus-4-20250514, claude-3.5-haiku, etc.
  // Special: caching (cache_control), extended thinking, PDF/image vision
}
```

### OpenAI (GPT)

```typescript
class OpenAIProvider implements AIProvider {
  // API: POST https://api.openai.com/v1/chat/completions
  // Auth: Authorization: Bearer <key>
  // Streaming: SSE with data: {"choices":[{"delta":...}]}
  // Tool use: function calling with tool_choice
  // Models: gpt-4o, gpt-4o-mini, o1, o3, etc.
  // Translation: convert unified format to OpenAI's role/content/tool_calls format
}
```

### Google Gemini

```typescript
class GeminiProvider implements AIProvider {
  // API: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent
  // Auth: x-goog-api-key header
  // Streaming: SSE with candidates[].content.parts[]
  // Tool use: functionDeclarations + functionCall/functionResponse
  // Models: gemini-2.0-flash, gemini-2.0-pro, gemini-1.5-pro, etc.
  // Translation: convert parts[] to unified MessageContent[]
}
```

### Ollama (Local Models)

```typescript
class OllamaProvider implements AIProvider {
  // API: POST http://localhost:11434/api/chat
  // Auth: none (local)
  // Streaming: NDJSON with { message: { content, role, tool_calls? } }
  // Tool use: supported via tools parameter (model-dependent)
  // Models: dynamic via GET /api/tags
  // Special: local-only, no API key, configurable base URL
}
```

### OpenRouter (Multi-Provider Gateway)

```typescript
class OpenRouterProvider implements AIProvider {
  // API: POST https://openrouter.ai/api/v1/chat/completions (OpenAI-compatible)
  // Auth: Authorization: Bearer <key>
  // Streaming: same as OpenAI SSE format
  // Tool use: same as OpenAI function calling
  // Models: dynamic via GET /api/v1/models (hundreds of models)
  // Special: automatic fallback, rate limit pooling, cost tracking
  // Translation: reuse OpenAI translation layer with OpenRouter base URL
}
```

---

## Provider Registry

```typescript
class ProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();

  register(provider: AIProvider): void;
  get(id: string): AIProvider | undefined;
  list(): AIProvider[];
  getDefault(): AIProvider;

  // Factory method using API keys from keychain
  async initialize(): Promise<void> {
    const anthropicKey = await keychain.get('anthropic_api_key');
    if (anthropicKey) this.register(new AnthropicProvider(anthropicKey));

    const openaiKey = await keychain.get('openai_api_key');
    if (openaiKey) this.register(new OpenAIProvider(openaiKey));

    // ... etc for each provider
    // Ollama always registered (no key needed)
    this.register(new OllamaProvider());
  }
}
```

---

## API Key Management

- Keys stored in **OS keychain** via Tauri secure storage commands
- Never stored in SQLite, localStorage, or config files
- Settings UI shows key status (configured/not configured) without revealing the key
- Key validation: each provider has a `validateApiKey()` method (lightweight API call)

---

## Error Handling & Retry

```typescript
interface RetryConfig {
  maxRetries: number; // default: 3
  baseDelayMs: number; // default: 1000
  maxDelayMs: number; // default: 30000
  retryableStatuses: number[]; // [429, 500, 502, 503, 529]
}
```

**Strategy:**

1. Rate limit (429): exponential backoff with jitter, respect `Retry-After` header
2. Server error (5xx): retry up to 3x
3. Auth error (401/403): surface immediately (invalid/expired key)
4. Network/timeout before semantic output: retry up to 3x; waiting for the OS to report the connection online does not consume an attempt
5. Stream interruption after text, thinking, or a tool-call start: preserve the partial response and require explicit user continuation; never retry silently
6. Request timeout defaults to 120s and stream inactivity timeout defaults to 90s; both are configurable in Advanced resilience
7. Malformed SSE/NDJSON is surfaced as a protocol error rather than silently discarded

Retries are intentionally limited to the pre-output phase. This avoids silently duplicating provider charges or replaying partially generated tool calls.

---

## Token Counting

Each provider implements approximate token counting for budget management:

- **Anthropic**: use `@anthropic-ai/tokenizer` (Claude tokenizer)
- **OpenAI**: use `tiktoken` (via WASM build for browser)
- **Gemini**: approximate ratio (4 chars ≈ 1 token)
- **Ollama**: model-dependent, approximate
- **OpenRouter**: delegate to underlying model's tokenizer

Used by Context Manager to stay within token budget before sending requests.

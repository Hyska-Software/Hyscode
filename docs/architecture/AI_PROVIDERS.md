# AI Providers Architecture

## Overview

The AI Provider layer provides a **unified interface** for communicating with multiple LLM providers. Each provider adapter translates the internal message format to/from the provider's API, handles streaming, and manages authentication.

---

## Provider Interface

```typescript
interface AIProvider {
  readonly id: string;
  readonly name: string;
  models: AIModel[];
  readonly capabilities?: ProviderCapabilities;
  chat(params: ChatParams): AsyncIterable<StreamChunk>;
  listModels(): Promise<AIModel[]>;
  isConfigured(): boolean;
}

interface AIModel {
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
  thinkingVariants?: ThinkingVariants;
}
```

---

## Unified Message Format

```typescript
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent[];
}

type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; base64: string; mediaType: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolCallId: string; output: string; isError?: boolean }
  | { type: 'thinking'; thinking: string };

interface ChatParams {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;
  stopSequences?: string[];
  systemPrompt?: string;
  signal?: AbortSignal;
  thinking?: ThinkingConfig;
  cachePrompt?: boolean;
  promptCacheKey?: string;
  promptCacheOptions?: PromptCacheOptions;
  sessionId?: string;
  sessionFingerprint?: string;
}
```

---

## Thinking and Reasoning Controls

Thinking is a model capability, not a provider-wide assumption. `AIModel.thinkingVariants`
declares the native wire-format kind, the supported `ThinkingConfig.level` values, and
the default level. Models without this field (or with `kind: 'none'`) do not expose
thinking controls.

`ThinkingConfig.level` is the shared effort contract. Clients must keep using that
field rather than introducing a separate generic `effort` property. Optional
`mode`, `budgetTokens`, `type`, and `display` fields preserve provider-native
configuration when a provider needs them. The harness passes the configuration to
the selected provider on the next turn.

Thinking settings are persisted by the stable `${providerId}::${modelId}` key. The
runtime validates an enabled level against the selected model's declared variants;
unsupported levels are rejected for explicit changes and invalid persisted values
are safely disabled. The TUI receives both the model catalog and the active
configuration in `runtime_ready`, then uses `set_config` for visual changes.

The desktop and TUI share the default settings file. The desktop imports the active
provider, active model, and per-model thinking settings before its first export on
startup, so a TUI change is visible on the next desktop launch. A TUI started with
`--config` uses an isolated settings path by design.

---

## Stream Protocol

All providers normalize to a unified streaming protocol:

```typescript
type StreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; input: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; stopReason: StopReason }
  | { type: 'error'; error: string; retryable?: boolean; details?: ProviderErrorDetails };

interface TokenUsage {
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
  cacheMeasuredReadTokens?: number;
  cacheEligibleTokens?: number;
  cacheMeasuredEligibleTokens?: number;
  cacheHitRequests?: number;
  cacheObservedRequests?: number;
  cacheTotalRequests?: number;
  cacheUnknownRequests?: number;
  cacheHitRate?: number;
  cacheInputReadRatio?: number;
  cacheRequestHitRate?: number;
  cacheUnknownRate?: number;
}
```

Turn-level `inputTokens`, `outputTokens`, and cache fields are cumulative across API
requests. Context-window indicators must use `peakInputTokens` (with
`lastInputTokens` as fallback), because cumulative turn input can exceed a model's
window without any individual request overflowing it.

### Prompt-cache contract

Prompt caching is measured against the stable prefix, not against every input token.
The harness canonicalizes tool order and object-key order, includes the serializer
version in the prefix hash, and derives a project-scoped key:

```text
stablePrefixHash = hash(v2 + systemPrompt + canonicalTools)
promptCacheKey   = hyscode:v2:provider:model:projectScopeHash:stablePrefixHash
```

`cacheEligibleTokens` is the estimated system-prompt plus tool-definition prefix.
Requests below 1,024 eligible tokens are marked `ineligible`; providers that do not
support prompt caching are marked `unsupported`. A provider response without native
cache fields is `not-reported`, never an inferred miss.

The primary KPI is the weighted hit rate over provider-observed eligible prefixes:

```text
cacheHitRate = sum(min(cacheReadTokens, eligiblePrefixTokens)) /
               sum(eligiblePrefixTokens with native cache telemetry)
```

`cacheRequestHitRate` is the request-level companion metric. `cacheUnknownRate`
shows requests whose state could not be measured; it is intentionally excluded from
the hit denominator. The 96–99% target therefore means **96–99% of measured eligible
prefix tokens**, not 96–99% of all agent input or all providers combined.

`cacheReadTokens` remains the provider's raw usage value for cost accounting, while
`cacheMeasuredReadTokens` is the bounded value used by the cache KPI and persistence
layer. This distinction prevents provider-reported cached history from making the
stable-prefix rate exceed 100%.

The desktop persists the counters in `turn_records` and `traces`, derives rates on
read, and displays hit, eligible, and unknown values in the agent usage popover.
Historical rows with no cache telemetry remain unknown/ineligible rather than being
rewritten as misses.

### Frontend Consumption

```typescript
// In agentStore
async function streamResponse(params: ChatParams) {
  const stream = registry.chat({ ...params, providerId });

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
      case 'usage':
        updateTokenUsage(chunk.usage);
        break;
      case 'error':
        surfaceProviderError(chunk.details ?? chunk.error);
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

Anthropic uses explicit `cache_control: { type: 'ephemeral' }` markers on the
system prompt and final tool definition. Its `message_start` usage supplies cache
read/write counts and `message_delta` supplies output counts; the adapter emits one
consolidated usage chunk per request.

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

### Claude Agent (Anthropic Sidecar) — temporarily disabled

> **Status: in development — unavailable in the current build.**
>
> The Claude Agent provider is disabled until further notice. It is **not
> registered** in the `ProviderRegistry`, so any chat request targeting the
> `claude-agent` provider id fails with `Provider not found`. Its catalog entry
> is removed from the UI, and the AI settings tab shows an
> "in development / temporarily unavailable" notice instead.

**Changes applied:**

- `packages/ai-providers/src/registry.ts` — `initialize()` and
  `reinitializeProvider()` no longer register `ClaudeAgentProvider`; the
  `claudeAgentInvoke` parameter was removed from both signatures.
- `apps/desktop/src/lib/init-providers.ts` — the `claude-agent` transport
  wiring (`createClaudeAgentInvoke`) is no longer passed to the registry.
- `apps/desktop/src/lib/provider-catalog.ts` — the `claude-agent` entry
  (provider metadata + models) was removed from `PROVIDERS`, so it disappears
  from the provider/model selectors and the Models list.
- `apps/desktop/src/components/settings/tabs/ai-tab.tsx` — banner
  ("Claude Agent is in development and temporarily unavailable") plus a
  disabled row in API Keys with an "In development" badge; the setup-guide
  entry point was removed.
- `apps/desktop/src/components/settings/tabs/provider-setup-guide.tsx` — the
  Claude Agent setup guide was removed.
- `apps/desktop/src/stores/settings-store.ts` — persist version bumped
  `3 → 4`: the migration clears any persisted Claude Agent selection (active
  provider/model, inline completion, enabled models, custom models, thinking
  settings) so existing installations never attempt to chat with an
  unregistered provider.

The implementation itself (`ClaudeAgentProvider`, the Tauri transport, and the
`claude-agent-sidecar` package) remains in the repository and can be re-enabled
by restoring the registry registration and the catalog entry.

---

### Codex (OpenAI Agent Sidecar)

```typescript
class CodexProvider implements AIProvider {
  // Transport: spawns the Bun-compiled codex-sidecar binary via the Tauri
  //            command `codex_run` (events stream back over `codex:chunk`)
  // Auth: optional API key (hyscode:codex_api_key) OR the ChatGPT login
  //       cached by the Codex CLI (~/.codex/auth.json via `codex login`)
  // CLI:  NOT bundled — the user installs it (npm install -g @openai/codex);
  //       the sidecar and `codex_cli_status` resolve it from PATH / ~/.codex/bin
  // Protocol: 1 JSON request on stdin → NDJSON events on stdout
  // Agent loop: Codex runs its own agentic loop (shell, apply_patch, MCP,
  //             web_search) internally — `ChatParams.tools` is informational
  // Models: gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4, gpt-5.4-mini
  // Reasoning: model_reasoning_effort = minimal|low|medium|high|xhigh
  // Sandbox: mapped from the harness agent mode — chat/review → read-only,
  //          plan → workspace-write, build/debug → danger-full-access
  //          (approval_policy stays 'never'; the sidecar has no UI to answer
  //          interactive prompts, so HysCode approvals are the guardrail)
  // Prompt cache: native Codex thread reuse; the HysCode conversation id and
  // stable-prefix fingerprint resume the same SDK thread across turns.
}
```

Flow: `CodexProvider.chat()` → `createCodexInvoke()` (desktop transport, listens
`codex:chunk`, filters by `request_id`) → `codex_run` (Rust) → sidecar binary
(`binaries/codex-sidecar`) → `@openai/codex-sdk` → user-installed Codex CLI
(resolved from PATH / `~/.codex/bin` by the sidecar, passed as
`codexPathOverride` — the SDK's own `createRequire` resolution does not work
inside Bun-compiled binaries).

The SDK's `resumeThread(threadId)` is used for subsequent turns. The first turn
sends the complete HysCode context; resumed turns send only the new user request,
so the native Codex thread does not receive duplicated history. The thread id and
prefix fingerprint are persisted with the conversation. Codex usage maps both
`cached_input_tokens` and `cache_write_input_tokens` into the unified usage
contract.

The sidecar is a sibling of `claude-agent-sidecar`; the Rust host reuses the
same spawn/read pattern (`commands/codex.rs`) but with **real cancellation**
(process kill via `CodexRequestState`) and optional `api_key` so ChatGPT-login
users need no key. The settings UI (CodexAuthRow) checks `codex_cli_status` on
mount and shows the install command (`npm install -g @openai/codex`) when the
CLI is missing. Build: `packages/codex-sidecar` (`bun build --compile` +
`scripts/tag-sidecar-triple.mjs`).

**Bundling**: both sidecars are declared in `tauri.conf.json`
`bundle.externalBin` (triple-suffixed names, produced at build time) and ship
next to the app executable on all platforms (Inno, NSIS/MSI, deb/AppImage,
macOS .app/.dmg). Because `tauri-build` validates external binaries at compile
time, `beforeDevCommand`/`beforeBuildCommand` run `npm run build:sidecars`
first — **bun is now required** for `tauri dev` and `tauri build` (already
required for building the sidecars themselves). The Codex CLI itself is never
bundled — it is user-installed and detected at runtime.

---

## Provider Registry

```typescript
class ProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();

  register(provider: AIProvider): void;
  get(id: string): AIProvider | undefined;
  list(): AIProvider[];
  listConfigured(): AIProvider[];
  getDefault(): { provider: AIProvider; modelId: string };
  chat(params: ChatParams & { providerId?: string }): AsyncIterable<StreamChunk>;

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

### Commit-message generation

The Source Control generator uses a dedicated provider gateway rather than reading the
registry from the React view. Provider initialization is single-flight, and the model picker
intersects enabled catalog models with providers and models that are actually configured.
An unavailable persisted selection is shown as unavailable and never falls back silently to
another provider.

Generation is a tool-free, single-turn text request (`maxTurns: 1`, `maxTokens: 256`) without
a forced temperature or thinking mode. The consumer handles `error`, `usage`, and `done`
chunks explicitly. Cancellation discards all partial text, and `max_tokens`, `tool_use`,
missing completion markers, empty output, or a non-Conventional-Commit response are surfaced
as typed errors. Retry, timeout, credential injection, and transport cancellation remain
owned by the registry and Tauri transport.

Only repository-relative staged-change metadata and bounded staged patches are sent. Prompts
mark repository content as untrusted data, and neither prompts nor raw model responses are
logged.

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

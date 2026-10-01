import type { AIProvider, AIModel, ChatParams, StreamChunk, ThinkingConfig } from '../types';

// ─── Codex Provider ─────────────────────────────────────────────────────────
// Wraps the Codex SDK sidecar (packages/codex-sidecar). Chat requests are
// dispatched to the Tauri command `codex_run` which spawns the sidecar
// binary. The sidecar runs the user-installed Codex CLI agentic loop for one
// turn per request and streams NDJSON events back over `codex:chunk`.
//
// Unlike HTTP providers, Codex executes its own tools (shell, apply_patch,
// MCP) inside the CLI — `ChatParams.tools` is informational only. The agent
// is authenticated either via an API key or the ChatGPT login cached by the
// Codex CLI (`~/.codex/auth.json`). The CLI itself is not bundled — the
// settings UI checks for it and shows the install command when missing.

// Official specs (openai.com/index/introducing-gpt-6-sol-and-luna +
// /introducing-gpt-6-1-sol, Oct 2026):
// - gpt-6-astra / gpt-6.1-sol / gpt-6-sol / gpt-6-luna: 1.05M context window
// Pricing per 1M tokens (input / cached input / output, Standard short-ctx).
const CODEX_FULL_CONTEXT_WINDOW = 1_050_000;
const CODEX_MAX_OUTPUT = 128_000;

const CODEX_REASONING_VARIANTS = {
  kind: 'openai' as const,
  levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const,
  defaultLevel: 'medium' as const,
};

export const CODEX_MODELS: AIModel[] = [
  {
    id: 'gpt-6-astra',
    name: 'GPT 6 Astra (Codex)',
    provider: 'codex',
    contextWindow: CODEX_FULL_CONTEXT_WINDOW,
    maxOutputTokens: CODEX_MAX_OUTPUT,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 10,
    outputPricePerMToken: 50,
    cachedInputPricePerMToken: 1,
    thinkingVariants: CODEX_REASONING_VARIANTS,
  },
  {
    id: 'gpt-6.1-sol',
    name: 'GPT 6.1 Sol (Codex)',
    provider: 'codex',
    contextWindow: CODEX_FULL_CONTEXT_WINDOW,
    maxOutputTokens: CODEX_MAX_OUTPUT,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 2,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.1,
    thinkingVariants: CODEX_REASONING_VARIANTS,
  },
  {
    id: 'gpt-6-sol',
    name: 'GPT 6 Sol (Codex)',
    provider: 'codex',
    contextWindow: CODEX_FULL_CONTEXT_WINDOW,
    maxOutputTokens: CODEX_MAX_OUTPUT,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 2,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.2,
    thinkingVariants: CODEX_REASONING_VARIANTS,
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT 6 Luna (Codex)',
    provider: 'codex',
    contextWindow: CODEX_FULL_CONTEXT_WINDOW,
    maxOutputTokens: CODEX_MAX_OUTPUT,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.1,
    outputPricePerMToken: 0.5,
    cachedInputPricePerMToken: 0.01,
    thinkingVariants: CODEX_REASONING_VARIANTS,
  },
];

export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Maps the harness agent mode to the Codex CLI native sandbox so mode
 * restrictions are enforced, not just prompted:
 * - chat / review: HysCode denies writes + terminal → read-only
 * - plan: HysCode allows writing plan docs, denies code/terminal → workspace-write
 * - build / debug: full autonomy → danger-full-access
 */
const AGENT_MODE_TO_SANDBOX: Record<string, CodexSandboxMode> = {
  chat: 'read-only',
  review: 'read-only',
  plan: 'workspace-write',
  build: 'danger-full-access',
  debug: 'danger-full-access',
};

/**
 * Invokes the Codex sidecar via Tauri.
 * This function type is injected from the desktop app so the provider
 * package stays platform-agnostic.
 */
export type CodexInvoke = (params: {
  apiKey?: string;
  model: string;
  systemPrompt?: string;
  prompt: string;
  cwd?: string;
  reasoningEffort?: CodexReasoningEffort;
  sandboxMode?: CodexSandboxMode;
  sessionId?: string;
  sessionFingerprint?: string;
  continuationPrompt?: string;
  signal?: AbortSignal;
}) => AsyncIterable<StreamChunk>;

const REASONING_EFFORT_LEVELS: ReadonlySet<string> = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

function resolveReasoningEffort(thinking?: ThinkingConfig): CodexReasoningEffort | undefined {
  const level = thinking?.level;
  if (level && REASONING_EFFORT_LEVELS.has(level)) {
    return level as CodexReasoningEffort;
  }
  return undefined;
}

export class CodexProvider implements AIProvider {
  readonly id = 'codex' as const;
  readonly name = 'Codex (Agent)';
  models: AIModel[] = [...CODEX_MODELS];

  readonly capabilities = {
    promptCache: 'automatic' as const,
    reasoningReplay: 'none' as const,
    nativeTokenCounting: true,
    acceptsPromptCacheKey: false,
    agenticToolExecution: true,
  };

  private apiKey: string;
  private invoke: CodexInvoke | null;
  private authDetected: boolean;

  constructor(apiKey: string, invoke?: CodexInvoke, authDetected = false) {
    this.apiKey = apiKey;
    this.invoke = invoke ?? null;
    this.authDetected = authDetected;
  }

  isConfigured(): boolean {
    // Either an API key or a cached ChatGPT login makes the provider usable.
    return this.apiKey.length > 0 || this.authDetected;
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
    if (!params.messages.length) throw new Error('model required: messages must not be empty');
    if (!this.invoke) {
      yield { type: 'error', error: 'Codex sidecar not available (no invoke function)' };
      return;
    }

    // Never forward an empty model id — the Codex SDK treats an empty string
    // as "no --model flag", which would make the CLI silently use its own
    // default model instead of the selection.
    const model = params.model || CODEX_MODELS[0].id;

    // Flatten messages to a single prompt; Codex runs its own agentic loop.
    // Role prefixes are escaped so message content starting with "User:" or
    // "Assistant:" can't forge message boundaries. Tool results and thinking
    // are preserved as bracketed text so replay history doesn't lose them.
    const escapeRolePrefix = (text: string): string =>
      text.replace(/^(Assistant|User):/gm, '\\$1:');
    const prompt = params.messages
      .map((m) => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const content = m.content
          .map((c) => {
            if (c.type === 'text') return c.text;
            if (c.type === 'thinking') return `[thinking]${c.thinking}`;
            if (c.type === 'tool_result') return `[tool result ${c.toolCallId}]${c.output}`;
            if (c.type === 'tool_call') return `[tool call ${c.name} ${JSON.stringify(c.input)}]`;
            if (c.type === 'image') return '[image]';
            return '';
          })
          .filter(Boolean)
          .join('\n');
        return `${role}:\n${escapeRolePrefix(content)}`;
      })
      .join('\n\n');

    const latestUserMessage = [...params.messages]
      .reverse()
      .find((message) => message.role === 'user')
      ?.content.filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join('\n');

    yield* this.invoke({
      apiKey: this.apiKey || undefined,
      model,
      systemPrompt: params.systemPrompt,
      prompt,
      reasoningEffort: resolveReasoningEffort(params.thinking),
      sandboxMode: AGENT_MODE_TO_SANDBOX[params.agentMode ?? ''] ?? 'read-only',
      sessionId: params.sessionId,
      sessionFingerprint: params.sessionFingerprint,
      continuationPrompt: latestUserMessage || undefined,
      signal: params.signal,
    });
  }
}

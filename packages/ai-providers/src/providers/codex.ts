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

const CODEX_CONTEXT_WINDOW = 400_000;
const CODEX_MAX_OUTPUT = 128_000;

const CODEX_REASONING_VARIANTS = {
  kind: 'openai' as const,
  levels: ['minimal', 'low', 'medium', 'high', 'xhigh'] as const,
  defaultLevel: 'medium' as const,
};

export const CODEX_MODELS: AIModel[] = [
  {
    id: 'gpt-5.6-sol',
    name: 'GPT 5.6 Sol (Codex)',
    provider: 'codex',
    contextWindow: CODEX_CONTEXT_WINDOW,
    maxOutputTokens: CODEX_MAX_OUTPUT,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.25,
    thinkingVariants: CODEX_REASONING_VARIANTS,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT 5.6 Terra (Codex)',
    provider: 'codex',
    contextWindow: CODEX_CONTEXT_WINDOW,
    maxOutputTokens: CODEX_MAX_OUTPUT,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1.25,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.125,
    thinkingVariants: CODEX_REASONING_VARIANTS,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT 5.6 Luna (Codex)',
    provider: 'codex',
    contextWindow: CODEX_CONTEXT_WINDOW,
    maxOutputTokens: CODEX_MAX_OUTPUT,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 4,
    cachedInputPricePerMToken: 0.05,
    thinkingVariants: CODEX_REASONING_VARIANTS,
  },
  {
    id: 'gpt-5.5',
    name: 'GPT 5.5 (Codex)',
    provider: 'codex',
    contextWindow: CODEX_CONTEXT_WINDOW,
    maxOutputTokens: CODEX_MAX_OUTPUT,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1.25,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.125,
    thinkingVariants: CODEX_REASONING_VARIANTS,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT 5.4 (Codex)',
    provider: 'codex',
    contextWindow: CODEX_CONTEXT_WINDOW,
    maxOutputTokens: CODEX_MAX_OUTPUT,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1.25,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.125,
    thinkingVariants: CODEX_REASONING_VARIANTS,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT 5.4 Mini (Codex)',
    provider: 'codex',
    contextWindow: CODEX_CONTEXT_WINDOW,
    maxOutputTokens: CODEX_MAX_OUTPUT,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.4,
    outputPricePerMToken: 1.6,
    cachedInputPricePerMToken: 0.04,
    thinkingVariants: CODEX_REASONING_VARIANTS,
  },
];

export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

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
}) => AsyncIterable<StreamChunk>;

const REASONING_EFFORT_LEVELS: ReadonlySet<string> = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
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

  async listModels(): Promise<AIModel[]> {
    return this.models;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    if (!this.invoke) {
      yield { type: 'error', error: 'Codex sidecar not available (no invoke function)' };
      return;
    }

    // Flatten messages to a single prompt; Codex runs its own agentic loop.
    const prompt = params.messages
      .map((m) => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const content = m.content
          .map((c) => (c.type === 'text' ? c.text : ''))
          .filter(Boolean)
          .join('\n');
        return `${role}:\n${content}`;
      })
      .join('\n\n');

    yield* this.invoke({
      apiKey: this.apiKey || undefined,
      model: params.model,
      systemPrompt: params.systemPrompt,
      prompt,
      reasoningEffort: resolveReasoningEffort(params.thinking),
    });
  }
}

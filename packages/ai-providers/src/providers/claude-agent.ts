import type { AIProvider, AIModel, ChatParams, StreamChunk } from '../types';

// ─── Claude Agent Provider ──────────────────────────────────────────────────
// Wraps the Claude Agent SDK sidecar. Chat requests are dispatched to the
// Tauri command `claude_agent_run` which spawns the sidecar binary.
// For simple chat (non-agentic), it delegates to the Anthropic streaming API
// through the normal transport — the sidecar is only invoked when tools are
// requested by the harness layer.

const CLAUDE_AGENT_MODELS: AIModel[] = [
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5 (Agent)',
    provider: 'claude-agent',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 10,
    outputPricePerMToken: 50,
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8 (Agent)',
    provider: 'claude-agent',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Agent)',
    provider: 'claude-agent',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5 (Agent)',
    provider: 'claude-agent',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1,
    outputPricePerMToken: 5,
  },
];

/**
 * Invokes the Claude Agent sidecar via Tauri.
 * This function type is injected from the desktop app so the provider
 * package stays platform-agnostic.
 */
export type ClaudeAgentInvoke = (params: {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTurns?: number;
  cwd?: string;
}) => AsyncIterable<StreamChunk>;

export class ClaudeAgentProvider implements AIProvider {
  readonly id = 'claude-agent' as const;
  readonly name = 'Claude Agent';
  models: AIModel[] = [...CLAUDE_AGENT_MODELS];

  private apiKey: string;
  private invoke: ClaudeAgentInvoke | null;

  constructor(apiKey: string, invoke?: ClaudeAgentInvoke) {
    this.apiKey = apiKey;
    this.invoke = invoke ?? null;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async listModels(): Promise<AIModel[]> {
    return this.models;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    if (!this.invoke) {
      yield { type: 'error', error: 'Claude Agent sidecar not available (no invoke function)' };
      return;
    }

    // Flatten messages to simple role/content pairs for the sidecar
    const messages = params.messages.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content
        .map((c) => (c.type === 'text' ? c.text : ''))
        .filter(Boolean)
        .join('\n'),
    }));

    yield* this.invoke({
      apiKey: this.apiKey,
      model: params.model,
      systemPrompt: params.systemPrompt,
      messages,
      maxTurns: 10,
    });
  }
}

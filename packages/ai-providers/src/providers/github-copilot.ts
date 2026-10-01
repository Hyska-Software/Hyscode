import type { AIModel, ChatParams, StreamChunk, FetchImpl, ThinkingVariants } from '../types';
import { OpenAIProvider } from './openai';
import {
  ADAPTIVE_CLAUDE_XHIGH_MEDIUM_VARIANTS,
  ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  ADAPTIVE_CLAUDE_VARIANTS,
  BUDGET_CLAUDE_VARIANTS,
} from './anthropic';
import {
  OPENAI_THINKING_FULL,
  OPENAI_THINKING_FULL_PRO,
  OPENAI_THINKING_HIGH,
  OPENAI_THINKING_LOW,
} from './openai';
import { GEMINI_THINKING_LMH_VARIANTS } from './gemini';

// ─── GitHub Copilot Provider ────────────────────────────────────────────────
// GitHub Copilot exposes an OpenAI-compatible chat completions endpoint at
// https://api.githubcopilot.com. Auth is via a short-lived token obtained
// through the GitHub OAuth Device Flow + Copilot token exchange.
//
// The token lifecycle is managed by the Rust backend:
//   1. User initiates OAuth via `github_oauth_start` → gets device_code + user_code
//   2. User authorizes in browser, frontend polls `github_oauth_poll`
//   3. On success, the access_token is stored in keychain as `github_copilot_access_token`
//   4. Before each request, `github_copilot_ensure_token` refreshes the short-lived
//      Copilot API token from the long-lived OAuth access token
//
// The provider itself is a thin OpenAI adapter — auth header injection is
// handled by the Rust ai_stream_request proxy like all other providers.

// Models current as of Oct 01 2026 — see
// https://docs.github.com/copilot/reference/ai-models/supported-models.
// Copilot API (api.githubcopilot.com) model IDs follow the convention:
//   lowercase display name, spaces → hyphens, dots preserved.
// Copilot bills by premium-request multiplier, not per-token, so no pricing
// is declared here (cost math treats unpriced models as free).

/** Grok 4.x reasoning effort (docs.x.ai/developers/models): low/medium/high/xhigh. */
const COPILOT_GROK_EFFORT: ThinkingVariants = {
  kind: 'openai',
  levels: ['low', 'medium', 'high', 'xhigh'],
  defaultLevel: 'medium',
};

/** Kimi K3: reasoning_effort default/max, always on. */
const COPILOT_KIMI_K3_EFFORT: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'max'],
  defaultLevel: 'max',
};

/** Kimi K2.7 Code: always-on thinking, cannot disable. */
const COPILOT_KIMI_ALWAYS_ON: ThinkingVariants = {
  kind: 'kimi',
  levels: ['enabled'],
  defaultLevel: 'enabled',
};

const COPILOT_MODELS: AIModel[] = [
  // ── OpenAI ─────────────────────────────────────────────────────────────
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-6-sol',
    name: 'GPT-6 Sol (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_FULL,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_FULL,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini (Copilot)',
    provider: 'github-copilot',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_HIGH,
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT-5.4 Nano (Copilot)',
    provider: 'github-copilot',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_LOW,
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini (Copilot)',
    provider: 'github-copilot',
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3-Codex (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: OPENAI_THINKING_FULL,
  },
  // ── Anthropic ──────────────────────────────────────────────────────────
  {
    id: 'claude-fable-5-1',
    name: 'Claude Fable 5.1 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  },
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_MEDIUM_VARIANTS,
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  },
  {
    id: 'claude-opus-4-8-fast',
    name: 'Claude Opus 4.8 Fast (Copilot Preview)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  },
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_VARIANTS,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: BUDGET_CLAUDE_VARIANTS,
  },
  // ── Google Gemini ──────────────────────────────────────────────────────
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: GEMINI_THINKING_LMH_VARIANTS,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: GEMINI_THINKING_LMH_VARIANTS,
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: GEMINI_THINKING_LMH_VARIANTS,
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: GEMINI_THINKING_LMH_VARIANTS,
  },
  // ── Microsoft ──────────────────────────────────────────────────────────
  {
    id: 'mai-code-1.1-flash',
    name: 'MAI-Code-1.1-Flash (Copilot)',
    provider: 'github-copilot',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
  // ── Moonshot AI ────────────────────────────────────────────────────────
  {
    id: 'kimi-k3',
    name: 'Kimi K3 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: COPILOT_KIMI_K3_EFFORT,
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code (Copilot)',
    provider: 'github-copilot',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: COPILOT_KIMI_ALWAYS_ON,
  },
  // ── xAI ────────────────────────────────────────────────────────────────
  {
    id: 'grok-4.7',
    name: 'Grok 4.7 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 500_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: COPILOT_GROK_EFFORT,
  },
  {
    id: 'grok-4.6',
    name: 'Grok 4.6 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 500_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: COPILOT_GROK_EFFORT,
  },
  {
    id: 'grok-4.5',
    name: 'Grok 4.5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 500_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: COPILOT_GROK_EFFORT,
  },
];

export class GitHubCopilotProvider extends OpenAIProvider {
  override readonly id = 'github-copilot' as const;
  override readonly name = 'GitHub Copilot';
  override models: AIModel[] = [...COPILOT_MODELS];

  constructor(apiKey: string, fetchImpl?: FetchImpl) {
    // apiKey here is the short-lived Copilot token.
    // Extra headers identify this as an editor integration.
    super(
      apiKey,
      'https://api.githubcopilot.com',
      {
        'Editor-Version': 'HysCode/0.1.0',
        'Editor-Plugin-Version': 'hyscode-copilot/0.1.0',
        'Copilot-Integration-Id': 'vscode-chat',
      },
      fetchImpl,
    );
  }

  override async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    yield* super.chat(params);
  }
}

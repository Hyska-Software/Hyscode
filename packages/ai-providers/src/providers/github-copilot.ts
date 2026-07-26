import type { AIModel, ChatParams, StreamChunk, FetchImpl } from '../types';
import { OpenAIProvider } from './openai';
import {
  ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
  ADAPTIVE_CLAUDE_VARIANTS,
  ADAPTIVE_CLAUDE_BASIC_VARIANTS,
  BUDGET_CLAUDE_VARIANTS,
} from './anthropic';
import {
  OPENAI_THINKING_FULL,
  OPENAI_THINKING_FULL_PRO,
  OPENAI_THINKING_HIGH,
} from './openai';
import { GEMINI_THINKING_LMH_VARIANTS, GEMINI_THINKING_LM_VARIANTS } from './gemini';

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

// Models current as of July 25, 2026 — see docs/MODELS_REFERENCE.md §1.
//
// Copilot API (api.githubcopilot.com) model IDs follow the convention:
//   lowercase display name, spaces → hyphens, dots preserved.
// Multiplier tiers: 0× = free/included, 0.25–0.33× = low-cost, 1× = standard, 3× = premium
const COPILOT_MODELS: AIModel[] = [
  // ── 0× multiplier (free, all plans) ────────────────────────────────────
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
    id: 'raptor-mini',
    name: 'Raptor Mini (Copilot)',
    provider: 'github-copilot',
    contextWindow: 400_000, // fine-tuned GPT-5 mini — same context limits
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
  // ── 0.33× multiplier ──────────────────────────────────────────────────
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
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: GEMINI_THINKING_LM_VARIANTS,
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
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: BUDGET_CLAUDE_VARIANTS,
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: GEMINI_THINKING_LM_VARIANTS,
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
    id: 'gpt-5.6',
    name: 'GPT-5.6 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: OPENAI_THINKING_FULL_PRO,
  },
  // ── 1× multiplier (standard premium) ──────────────────────────────────
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: BUDGET_CLAUDE_VARIANTS,
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576, // Anthropic upgraded Sonnet 4.6 to 1M context
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_VARIANTS,
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
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: GEMINI_THINKING_LMH_VARIANTS,
  },
  {
    id: 'mai-code-1-flash',
    name: 'MAI-Code-1-Flash (Copilot)',
    provider: 'github-copilot',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
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
  {
    id: 'claude-opus-4.8',
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
    id: 'claude-opus-4.8-fast',
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
  // ── 3× multiplier (premium) ───────────────────────────────────────────
  {
    id: 'claude-opus-4.7',
    name: 'Claude Opus 4.7 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 1_048_576, // Anthropic latest — 1M context
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_XHIGH_VARIANTS,
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
    id: 'claude-opus-4.5',
    name: 'Claude Opus 4.5 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_BASIC_VARIANTS,
  },
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6 (Copilot)',
    provider: 'github-copilot',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    thinkingVariants: ADAPTIVE_CLAUDE_VARIANTS,
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

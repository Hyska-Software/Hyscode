import type { AIModel, ChatParams, StreamChunk, FetchImpl, ThinkingVariants } from '../types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { chatResponsesAPI } from './openai-responses';

// ─── Model Routing ──────────────────────────────────────────────────────────
// Claude models use the Anthropic message format at /zen/v1/messages.
// Gemini models use the Google Gemini API format at /zen/v1/models/<model>.
// GPT models use the OpenAI Responses API at /zen/v1/responses.
// All other models use OpenAI-compatible chat completions at /zen/v1/chat/completions.
// Source: https://dev.opencode.ai/docs/zen (last updated Jul 31, 2026)

const ZEN_ANTHROPIC_MODELS = new Set([
  'claude-fable-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
  'qwen3.5-plus',
]);

const ZEN_GPT_MODELS = new Set([
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-5',
  'gpt-5-nano',
]);

const ZEN_GEMINI_MODELS = new Set([
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro',
  'gemini-3-flash',
]);

// ─── Thinking variant presets ────────────────────────────────────────────────
// Per docs/MODELS_REFERENCE.md §2 — exact per-model thinking ladders.

/** Adaptive Claude with xhigh: fable 5, opus 5, opus 4.8, opus 4.7, sonnet 5 */
const THINKING_ADAPTIVE_CLAUDE_XHIGH: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: true,
};

/** Adaptive Claude with max but not xhigh: opus 4.6, sonnet 4.6 */
const THINKING_ADAPTIVE_CLAUDE: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: true,
};

/** Adaptive Claude limited to low/medium/high: opus 4.5 */
const THINKING_ADAPTIVE_CLAUDE_BASIC: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'high',
  supportsAdaptive: true,
};

/** Extended-thinking (budget) Claude: sonnet 4.5, haiku 4.5 */
const THINKING_BUDGET_CLAUDE: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: false,
};

/** GPT full ladder: 5.5, 5.5 Pro, 5.4, 5.4 Pro, 5.3 Codex */
const THINKING_OPENAI_FULL: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
};

/** GPT full ladder + standard/pro mode: 5.6 Sol/Terra/Luna */
const THINKING_OPENAI_FULL_PRO: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
  modes: ['standard', 'pro'],
  defaultMode: 'standard',
};

/** GPT up to xhigh: 5.2, 5.1, 5 */
const THINKING_OPENAI_XHIGH: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh'],
  defaultLevel: 'medium',
};

/** GPT up to high: 5.4 Mini, 5.3 Codex Spark */
const THINKING_OPENAI_HIGH: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high'],
  defaultLevel: 'medium',
};

/** GPT up to medium: 5.4 Nano, 5 Nano */
const THINKING_OPENAI_LOW: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium'],
  defaultLevel: 'medium',
};

/** Gemini low/medium/high: 3.6 Flash, 3.5 Flash, 3.1 Pro */
const THINKING_GEMINI_LMH: ThinkingVariants = {
  kind: 'gemini',
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'high',
};

/** Gemini low/medium: 3.5 Flash Lite, 3 Flash */
const THINKING_GEMINI_LM: ThinkingVariants = {
  kind: 'gemini',
  levels: ['low', 'medium'],
  defaultLevel: 'medium',
};

/** Toggle thinking: GLM, Kimi K2.x, MiniMax (hybrid) */
const THINKING_KIMI: ThinkingVariants = {
  kind: 'kimi',
  levels: ['enabled', 'disabled'],
  defaultLevel: 'enabled',
};

/** Qwen: reasoning effort default/high/max */
const THINKING_QWEN_ANTHROPIC: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'high', 'max'],
  defaultLevel: 'max',
};

/** DeepSeek V4 reasoning: high/max effort */
const THINKING_DEEPSEEK: ThinkingVariants = {
  kind: 'openai',
  levels: ['high', 'max'],
  defaultLevel: 'max',
};

/** Grok 4.5 reasoning: low/medium/high */
const THINKING_GROK: ThinkingVariants = {
  kind: 'openai',
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'medium',
};

/** Kimi K3: reasoning_effort default/max (default max), always on */
const THINKING_KIMI_K3: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'max'],
  defaultLevel: 'max',
};

/** GLM-5.2: reasoning effort default/high/max */
const THINKING_GLM: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'high', 'max'],
  defaultLevel: 'max',
};

/** MiniMax M3: thinking.type adaptive/disabled */
const THINKING_MINIMAX_M3: ThinkingVariants = {
  kind: 'kimi',
  levels: ['adaptive', 'disabled'],
  defaultLevel: 'adaptive',
};

/** Always-on thinking (cannot disable): Kimi K2.7-code, MiniMax M2.x */
const THINKING_ALWAYS_ON: ThinkingVariants = {
  kind: 'kimi',
  levels: ['enabled'],
  defaultLevel: 'enabled',
};

// ─── Static Model List ──────────────────────────────────────────────────────
// Sourced from https://dev.opencode.ai/docs/zen — models and pricing as of July 2026.
// The listModels() method attempts to refresh this list from the live API.

const ZEN_MODELS: AIModel[] = [
  // ── Claude models (Anthropic format) ──────────────────────────────────────
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 10,
    outputPricePerMToken: 50,
    cachedInputPricePerMToken: 1,
    thinkingVariants: THINKING_ADAPTIVE_CLAUDE_XHIGH,
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    cachedInputPricePerMToken: 0.5,
    thinkingVariants: THINKING_ADAPTIVE_CLAUDE_XHIGH,
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    cachedInputPricePerMToken: 0.5,
    thinkingVariants: THINKING_ADAPTIVE_CLAUDE_XHIGH,
  },
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    cachedInputPricePerMToken: 0.5,
    thinkingVariants: THINKING_ADAPTIVE_CLAUDE_XHIGH,
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    cachedInputPricePerMToken: 0.5,
    thinkingVariants: THINKING_ADAPTIVE_CLAUDE,
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 25,
    cachedInputPricePerMToken: 0.5,
    thinkingVariants: THINKING_ADAPTIVE_CLAUDE_BASIC,
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2,
    outputPricePerMToken: 10,
    cachedInputPricePerMToken: 0.2,
    thinkingVariants: THINKING_ADAPTIVE_CLAUDE_XHIGH,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    cachedInputPricePerMToken: 0.3,
    thinkingVariants: THINKING_ADAPTIVE_CLAUDE,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    cachedInputPricePerMToken: 0.3,
    thinkingVariants: THINKING_BUDGET_CLAUDE,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1,
    outputPricePerMToken: 5,
    cachedInputPricePerMToken: 0.1,
    thinkingVariants: THINKING_BUDGET_CLAUDE,
  },

  // ── GPT models (/zen/v1/responses) ────────────────────────────────────────
  {
    id: 'gpt-5.6-sol',
    name: 'GPT 5.6 Sol (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 30,
    cachedInputPricePerMToken: 0.5,
    thinkingVariants: THINKING_OPENAI_FULL_PRO,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT 5.6 Terra (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2,
    outputPricePerMToken: 12,
    cachedInputPricePerMToken: 0.2,
    thinkingVariants: THINKING_OPENAI_FULL_PRO,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT 5.6 Luna (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.2,
    outputPricePerMToken: 1.2,
    cachedInputPricePerMToken: 0.02,
    thinkingVariants: THINKING_OPENAI_FULL_PRO,
  },
  {
    id: 'gpt-5.5',
    name: 'GPT 5.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 5,
    outputPricePerMToken: 30,
    cachedInputPricePerMToken: 0.5,
    thinkingVariants: THINKING_OPENAI_FULL,
  },
  {
    id: 'gpt-5.5-pro',
    name: 'GPT 5.5 Pro (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 30,
    outputPricePerMToken: 180,
    thinkingVariants: THINKING_OPENAI_FULL,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT 5.4 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 15,
    cachedInputPricePerMToken: 0.25,
    thinkingVariants: THINKING_OPENAI_FULL,
  },
  {
    id: 'gpt-5.4-pro',
    name: 'GPT 5.4 Pro (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 30,
    outputPricePerMToken: 180,
    thinkingVariants: THINKING_OPENAI_FULL,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT 5.4 Mini (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.75,
    outputPricePerMToken: 4.5,
    cachedInputPricePerMToken: 0.075,
    thinkingVariants: THINKING_OPENAI_HIGH,
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT 5.4 Nano (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.2,
    outputPricePerMToken: 1.25,
    cachedInputPricePerMToken: 0.02,
    thinkingVariants: THINKING_OPENAI_LOW,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT 5.3 Codex (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.75,
    outputPricePerMToken: 14,
    cachedInputPricePerMToken: 0.175,
    thinkingVariants: THINKING_OPENAI_FULL,
  },
  {
    id: 'gpt-5.3-codex-spark',
    name: 'GPT 5.3 Codex Spark (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.75,
    outputPricePerMToken: 14,
    cachedInputPricePerMToken: 0.175,
    thinkingVariants: THINKING_OPENAI_HIGH,
  },
  {
    id: 'gpt-5.2',
    name: 'GPT 5.2 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.75,
    outputPricePerMToken: 14,
    cachedInputPricePerMToken: 0.175,
    thinkingVariants: THINKING_OPENAI_XHIGH,
  },
  {
    id: 'gpt-5.1',
    name: 'GPT 5.1 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.07,
    outputPricePerMToken: 8.5,
    cachedInputPricePerMToken: 0.107,
    thinkingVariants: THINKING_OPENAI_XHIGH,
  },
  {
    id: 'gpt-5',
    name: 'GPT 5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.07,
    outputPricePerMToken: 8.5,
    cachedInputPricePerMToken: 0.107,
    thinkingVariants: THINKING_OPENAI_XHIGH,
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT 5 Nano (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.05,
    outputPricePerMToken: 0.4,
    cachedInputPricePerMToken: 0.005,
    thinkingVariants: THINKING_OPENAI_LOW,
  },

  // ── Gemini models (/zen/v1/models/<model>) ────────────────────────────────
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.5,
    outputPricePerMToken: 7.5,
    cachedInputPricePerMToken: 0.15,
    thinkingVariants: THINKING_GEMINI_LMH,
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 1.5,
    outputPricePerMToken: 9,
    cachedInputPricePerMToken: 0.15,
    thinkingVariants: THINKING_GEMINI_LMH,
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 2.5,
    cachedInputPricePerMToken: 0.03,
    thinkingVariants: THINKING_GEMINI_LM,
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 2,
    outputPricePerMToken: 12,
    cachedInputPricePerMToken: 0.2,
    thinkingVariants: THINKING_GEMINI_LMH,
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 3,
    cachedInputPricePerMToken: 0.05,
    thinkingVariants: THINKING_GEMINI_LM,
  },

  // ── Anthropic-compatible Qwen models (/zen/v1/messages) ──────────────────
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 7.5,
    cachedInputPricePerMToken: 0.5,
    thinkingVariants: THINKING_QWEN_ANTHROPIC,
  },
  {
    id: 'qwen3.7-plus',
    name: 'Qwen3.7 Plus (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.4,
    outputPricePerMToken: 1.6,
    cachedInputPricePerMToken: 0.04,
    thinkingVariants: THINKING_QWEN_ANTHROPIC,
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 3,
    cachedInputPricePerMToken: 0.05,
    thinkingVariants: THINKING_QWEN_ANTHROPIC,
  },
  {
    id: 'qwen3.5-plus',
    name: 'Qwen3.5 Plus (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.2,
    outputPricePerMToken: 1.2,
    cachedInputPricePerMToken: 0.02,
    thinkingVariants: THINKING_QWEN_ANTHROPIC,
  },

  // ── OpenAI-compatible chat models (/zen/v1/chat/completions) ──────────────
  {
    id: 'minimax-m3',
    name: 'MiniMax M3 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 1.2,
    cachedInputPricePerMToken: 0.06,
    thinkingVariants: THINKING_MINIMAX_M3,
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.3,
    outputPricePerMToken: 1.2,
    cachedInputPricePerMToken: 0.06,
    thinkingVariants: THINKING_ALWAYS_ON,
  },
  {
    id: 'glm-5.2',
    name: 'GLM 5.2 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1.4,
    outputPricePerMToken: 4.4,
    cachedInputPricePerMToken: 0.26,
    thinkingVariants: THINKING_GLM,
  },
  {
    id: 'glm-5.1',
    name: 'GLM 5.1 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1.4,
    outputPricePerMToken: 4.4,
    cachedInputPricePerMToken: 0.26,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code (Zen)',
    provider: 'opencode-zen',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.95,
    outputPricePerMToken: 4,
    cachedInputPricePerMToken: 0.19,
    thinkingVariants: THINKING_ALWAYS_ON,
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.95,
    outputPricePerMToken: 4,
    cachedInputPricePerMToken: 0.16,
    thinkingVariants: THINKING_KIMI,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1.74,
    outputPricePerMToken: 3.48,
    cachedInputPricePerMToken: 0.145,
    thinkingVariants: THINKING_DEEPSEEK,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0.14,
    outputPricePerMToken: 0.28,
    cachedInputPricePerMToken: 0.028,
    thinkingVariants: THINKING_DEEPSEEK,
  },
  {
    id: 'grok-4.5',
    name: 'Grok 4.5 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 500_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 2,
    outputPricePerMToken: 6,
    cachedInputPricePerMToken: 0.3,
    thinkingVariants: THINKING_GROK,
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    cachedInputPricePerMToken: 0.3,
    thinkingVariants: THINKING_KIMI_K3,
  },
  {
    id: 'grok-build-0.1',
    name: 'Grok Build 0.1 (Zen)',
    provider: 'opencode-zen',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 1,
    outputPricePerMToken: 2,
    cachedInputPricePerMToken: 0.2,
  },
  {
    id: 'big-pickle',
    name: 'Big Pickle (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
  {
    id: 'mimo-v2.5-free',
    name: 'MiMo-V2.5 Free (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
  {
    id: 'laguna-s-2.1-free',
    name: 'Laguna S 2.1 Free (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
  {
    id: 'ling-3.0-flash-free',
    name: 'Ling-3.0-flash Free (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
  {
    id: 'north-mini-code-free',
    name: 'North Mini Code Free (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
  {
    id: 'nemotron-3-ultra-free',
    name: 'Nemotron 3 Ultra Free (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
  },
  {
    id: 'deepseek-v4-flash-free',
    name: 'DeepSeek V4 Flash Free (Zen)',
    provider: 'opencode-zen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
    thinkingVariants: THINKING_DEEPSEEK,
  },
];

// ─── Provider Implementation ────────────────────────────────────────────────

export class OpenCodeZenProvider extends OpenAIProvider {
  override readonly id = 'opencode-zen' as const;
  override readonly name = 'OpenCode Zen';
  override models: AIModel[] = [...ZEN_MODELS];

  // Delegates Anthropic-format requests to a reusable AnthropicProvider
  // pointed at the Zen endpoint instead of api.anthropic.com.
  private readonly anthropicDelegate: AnthropicProvider;
  // Delegates Gemini-format requests to a reusable GeminiProvider
  // pointed at the Zen endpoint instead of generativelanguage.googleapis.com.
  private readonly geminiDelegate: GeminiProvider;

  constructor(apiKey: string, fetchImpl?: FetchImpl) {
    super(apiKey, 'https://opencode.ai/zen/v1', {}, fetchImpl);
    // Kimi/MiMo models require reasoning_content in every assistant+tool_calls message
    this.requiresReasoningContent = true;
    // AnthropicProvider appends /v1/messages to baseUrl → https://opencode.ai/zen/v1/messages
    this.anthropicDelegate = new AnthropicProvider(
      apiKey,
      'https://opencode.ai/zen',
      this.fetchImpl,
    );
    // GeminiProvider uses baseUrl/models/<model>:streamGenerateContent
    this.geminiDelegate = new GeminiProvider(apiKey, 'https://opencode.ai/zen/v1', this.fetchImpl);
  }

  /**
   * Attempts to refresh the model list from the live Zen API.
   * Falls back to the static list on any error.
   */
  override async listModels(): Promise<AIModel[]> {
    try {
      const response = await this.fetchImpl('https://opencode.ai/zen/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) return this.models;

      const data = (await response.json()) as unknown;
      const items: unknown[] = Array.isArray(data)
        ? data
        : ((data as { data?: unknown[] }).data ?? []);

      if (!items.length) return this.models;

      const normalized: AIModel[] = items
        .filter(
          (m): m is { id: string; name?: string } => typeof (m as { id?: unknown }).id === 'string',
        )
        .map((m) => {
          // Prefer the static entry for known models (preserves pricing + capabilities)
          const known = ZEN_MODELS.find((x) => x.id === m.id);
          if (known) return { ...known, provider: 'opencode-zen' };
          return {
            id: m.id,
            name: m.name ?? m.id,
            provider: 'opencode-zen',
            contextWindow: 1_000_000,
            maxOutputTokens: 16_384,
            supportsTools: true,
            supportsStreaming: true,
            supportsVision: false,
          } satisfies AIModel;
        });

      if (normalized.length) this.models = normalized;
      return this.models;
    } catch {
      return this.models;
    }
  }

  override async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    if (ZEN_ANTHROPIC_MODELS.has(params.model)) {
      // Route Claude and Anthropic-compatible Qwen models through the Anthropic message format
      yield* this.anthropicDelegate.chat(params);
    } else if (ZEN_GEMINI_MODELS.has(params.model)) {
      // Route Gemini models through the Gemini API format
      yield* this.geminiDelegate.chat(params);
    } else if (ZEN_GPT_MODELS.has(params.model)) {
      // Route GPT models through the OpenAI Responses API
      yield* chatResponsesAPI(params, {
        providerId: this.id,
        providerName: this.name,
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        fetchImpl: this.fetchImpl,
      });
    } else {
      // All other models (Kimi, MiniMax, GLM, DeepSeek, Grok, free tier) use OpenAI-compatible chat completions
      yield* super.chat(params);
    }
  }
}

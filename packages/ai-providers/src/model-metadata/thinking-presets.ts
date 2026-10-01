// ─── Shared Thinking Variant Presets ─────────────────────────────────────────
// Canonical per-model thinking ladders for OpenCode Zen/Go, synced against
// vendor API references and docs/MODELS_REFERENCE.md (§1 Go, §2 Zen) via
// commits 3c1e80d / fda5bef (Aug 2026). Single source of truth consumed by
// model-metadata/catalog-corrections.ts.
//
// NOTE: these intentionally do NOT mirror models.dev `reasoning_options`
// verbatim — see normalize-modelsdev.ts for why upstream data is treated as
// advisory only (kimi-k2.7-code reports [] despite being always-on, MiniMax
// reports [] yet uses thinking.type adaptive/disabled, GPT-5.6 modes missing).

import type { ThinkingVariants } from '../types';

/** Adaptive Claude with xhigh: claude-fable-5.1, claude-fable-5, claude-sonnet-5.5 */
export const ADAPTIVE_CLAUDE_XHIGH: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: true,
};

/** Adaptive Claude with xhigh, API default medium: claude-opus-5-5 */
export const ADAPTIVE_CLAUDE_XHIGH_MEDIUM: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
  supportsAdaptive: true,
};

/** Adaptive Claude with max but not xhigh: opus-4.6, sonnet-4.6 */
export const ADAPTIVE_CLAUDE: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: true,
};

/** Adaptive Claude limited to low/medium/high: opus-4.5 */
export const ADAPTIVE_CLAUDE_BASIC: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'high',
  supportsAdaptive: true,
};

/** Extended-thinking (budget) Claude: sonnet-4.5, sonnet-4, haiku-4.5 */
export const BUDGET_CLAUDE: ThinkingVariants = {
  kind: 'anthropic',
  levels: ['low', 'medium', 'high', 'max'],
  defaultLevel: 'high',
  supportsAdaptive: false,
};

/** GPT full ladder: gpt-5.5/-pro, 5.4/-pro, 5.3-codex, 5.1-codex-max */
export const OPENAI_FULL: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
};

/** GPT full ladder + standard/pro reasoning mode: gpt-5.6 Sol/Terra/Luna */
export const OPENAI_FULL_PRO: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'medium',
  modes: ['standard', 'pro'],
  defaultMode: 'standard',
};

/** GPT up to xhigh: gpt-5.2/-codex, 5.1/-codex, 5-codex */
export const OPENAI_XHIGH: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high', 'xhigh'],
  defaultLevel: 'medium',
};

/** GPT up to high: gpt-5.4-mini, gpt-5.3-codex-spark */
export const OPENAI_HIGH: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high'],
  defaultLevel: 'medium',
};

/** GPT up to medium: gpt-5.4-nano, gpt-5-nano, gpt-5.1-codex-mini */
export const OPENAI_LOW: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium'],
  defaultLevel: 'medium',
};

/** Gemini low/medium/high: gemini-3.8-flash (API default medium), 3.7/3.6/3.5-flash, 3.1-pro */
export const GEMINI_LMH: ThinkingVariants = {
  kind: 'gemini',
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'medium',
};

/** Gemini low/medium: gemini-3.5-flash-lite, gemini-3-flash */
export const GEMINI_LM: ThinkingVariants = {
  kind: 'gemini',
  levels: ['low', 'medium'],
  defaultLevel: 'medium',
};

/** Toggle thinking (thinking.type enabled/disabled): GLM-5.1/5, Kimi K2.x, MiMo, LongCat */
export const KIMI_TOGGLE: ThinkingVariants = {
  kind: 'kimi',
  levels: ['enabled', 'disabled'],
  defaultLevel: 'enabled',
};

/** Qwen effort ladder (reasoning_effort default/high/max, on Anthropic-format endpoint) */
export const QWEN_EFFORT: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'high', 'max'],
  defaultLevel: 'max',
};

/** DeepSeek V4 effort (high/max) */
export const DEEPSEEK_HIGH_MAX: ThinkingVariants = {
  kind: 'openai',
  levels: ['high', 'max'],
  defaultLevel: 'max',
};

/** Grok 4.x on Zen: low/medium/high/xhigh effort (default medium) */
export const GROK_LMH_MEDIUM: ThinkingVariants = {
  kind: 'openai',
  levels: ['low', 'medium', 'high', 'xhigh'],
  defaultLevel: 'medium',
};

/** Grok 4.x on Go: low/medium/high/xhigh effort (default high) */
export const REASONING_LMH_HIGH: ThinkingVariants = {
  kind: 'openai',
  levels: ['low', 'medium', 'high', 'xhigh'],
  defaultLevel: 'high',
};

/** Kimi K3: reasoning_effort default/max, cannot disable */
export const KIMI_K3_EFFORT: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'max'],
  defaultLevel: 'max',
};

/** GLM-5.2/5.3(/flash): reasoning effort default/low/high/max */
export const GLM_EFFORT: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'low', 'high', 'max'],
  defaultLevel: 'max',
};

/** MiniMax M3: thinking.type adaptive/disabled */
export const MINIMAX_M3_ADAPTIVE: ThinkingVariants = {
  kind: 'kimi',
  levels: ['adaptive', 'disabled'],
  defaultLevel: 'adaptive',
};

/** Hy3: OpenAI-compatible hybrid thinking via reasoning_effort (none = off) */
export const HY3_EFFORT: ThinkingVariants = {
  kind: 'openai',
  levels: ['none', 'low', 'medium', 'high'],
  defaultLevel: 'medium',
};

/** Muse Spark 1.2 (+Contributor): reasoning effort default/minimal/low/medium/high/xhigh */
export const MUSE_EFFORT: ThinkingVariants = {
  kind: 'openai',
  levels: ['default', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  defaultLevel: 'default',
};

/** Always-on thinking, cannot disable: kimi-k2.7-code, minimax-m2.7, minimax-m2.5 */
export const ALWAYS_ON: ThinkingVariants = {
  kind: 'kimi',
  levels: ['enabled'],
  defaultLevel: 'enabled',
};

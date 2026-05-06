// ─── Provider & Model Catalog ─────────────────────────────────────────────────
// Single source of truth for provider/model metadata used by both the AI
// settings tab and the agent-input model selector.

import type { CustomModel } from '@/stores/settings-store';

export interface ModelInfo {
  id: string;
  name: string;
  /** Whether this model supports thinking/reasoning modes */
  supportsThinking?: boolean;
  /** Type of thinking control supported by this model */
  thinkingType?: 'anthropic' | 'openai' | 'gemini' | 'kimi' | 'deepseek' | 'mistral' | 'none';
  /** Available thinking levels for this model (if applicable) */
  thinkingLevels?: string[];
}

export interface ProviderInfo {
  id: string;
  name: string;
  models: ModelInfo[];
  needsKey: boolean;
  supportsCustomModels?: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    needsKey: true,
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', supportsThinking: false, thinkingType: 'none' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    needsKey: true,
    models: [
      { id: 'gpt-5.5', name: 'GPT-5.5', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.4', name: 'GPT-5.4', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', supportsThinking: false, thinkingType: 'none' },
      { id: 'o3', name: 'o3', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'o4-mini', name: 'o4-mini', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['low', 'medium', 'high'] },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    needsKey: true,
    models: [
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite Preview', supportsThinking: false, thinkingType: 'none' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', supportsThinking: false, thinkingType: 'none' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    needsKey: true,
    supportsCustomModels: true,
    models: [
      { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'openai/gpt-5.5', name: 'GPT-5.5', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'openai/gpt-5.4', name: 'GPT-5.4', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'openai/o3', name: 'o3', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'openai/o4-mini', name: 'o4-mini', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'meta-llama/llama-4-scout', name: 'Llama 4 Scout', supportsThinking: false, thinkingType: 'none' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', supportsThinking: true, thinkingType: 'deepseek', thinkingLevels: ['enabled'] },
      { id: 'mistral/mistral-small-latest', name: 'Mistral Small', supportsThinking: true, thinkingType: 'mistral', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'mistral/mistral-medium-3-5', name: 'Mistral Medium 3.5', supportsThinking: true, thinkingType: 'mistral', thinkingLevels: ['low', 'medium', 'high'] },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    needsKey: false,
    supportsCustomModels: true,
    models: [
      { id: 'llama4', name: 'Llama 4', supportsThinking: false, thinkingType: 'none' },
      { id: 'qwen3', name: 'Qwen 3', supportsThinking: true, thinkingType: 'none', thinkingLevels: ['enabled'] },
      { id: 'deepseek-r1', name: 'DeepSeek R1', supportsThinking: true, thinkingType: 'deepseek', thinkingLevels: ['enabled'] },
      { id: 'deepseek-coder-v2', name: 'DeepSeek Coder V2', supportsThinking: false, thinkingType: 'none' },
    ],
  },
  {
    id: 'claude-agent',
    name: 'Claude Agent',
    needsKey: false, // Reuses Anthropic API key
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Agent)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 (Agent)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7 (Agent)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (Agent)', supportsThinking: false, thinkingType: 'none' },
    ],
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    needsKey: false, // Uses OAuth, not API key
    models: [
      // 0× (free)
      { id: 'gpt-4.1', name: 'GPT-4.1 (Copilot)', supportsThinking: false, thinkingType: 'none' },
      { id: 'gpt-4o', name: 'GPT-4o (Copilot)', supportsThinking: false, thinkingType: 'none' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini (Copilot)', supportsThinking: false, thinkingType: 'none' },
      { id: 'raptor-mini', name: 'Raptor Mini (Copilot)', supportsThinking: false, thinkingType: 'none' },
      // 0.25×
      { id: 'grok-code-fast-1', name: 'Grok Code Fast 1 (Copilot)', supportsThinking: false, thinkingType: 'none' },
      // 0.33×
      { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5 (Copilot)', supportsThinking: false, thinkingType: 'none' },
      { id: 'gemini-3-flash', name: 'Gemini 3 Flash (Copilot)', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini (Copilot)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      // 1×
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4 (Copilot)', supportsThinking: false, thinkingType: 'none' },
      { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (Copilot)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6 (Copilot)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Copilot)', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro (Copilot)', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'gpt-5.2', name: 'GPT-5.2 (Copilot)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.2-codex', name: 'GPT-5.2-Codex (Copilot)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex (Copilot)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.4', name: 'GPT-5.4 (Copilot)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      // 3×
      { id: 'claude-opus-4.5', name: 'Claude Opus 4.5 (Copilot)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-opus-4.6', name: 'Claude Opus 4.6 (Copilot)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
    ],
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    needsKey: true,
    models: [
      { id: 'gpt-5.5', name: 'GPT 5.5 (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.5-pro', name: 'GPT 5.5 Pro (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.4', name: 'GPT 5.4 (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.4-pro', name: 'GPT 5.4 Pro (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.4-mini', name: 'GPT 5.4 Mini (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.4-nano', name: 'GPT 5.4 Nano (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.3-codex-spark', name: 'GPT 5.3 Codex Spark (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.2', name: 'GPT 5.2 (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.1', name: 'GPT 5.1 (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.1-codex', name: 'GPT 5.1 Codex (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5', name: 'GPT 5 (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5-codex', name: 'GPT 5 Codex (Zen)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { id: 'gpt-5-nano', name: 'GPT 5 Nano (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro (Zen)', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'gemini-3-flash', name: 'Gemini 3 Flash (Zen)', supportsThinking: true, thinkingType: 'gemini', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7 (Zen)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 (Zen)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Zen)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (Zen)', supportsThinking: true, thinkingType: 'anthropic', thinkingLevels: ['low', 'medium', 'high'] },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4 (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'claude-3-5-haiku', name: 'Claude Haiku 3.5 (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus (Zen)', supportsThinking: true, thinkingType: 'none', thinkingLevels: ['enabled'] },
      { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus (Zen)', supportsThinking: true, thinkingType: 'none', thinkingLevels: ['enabled'] },
      { id: 'minimax-m2.7', name: 'MiniMax M2.7 (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'minimax-m2.5', name: 'MiniMax M2.5 (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'minimax-m2.5-free', name: 'MiniMax M2.5 Free (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'glm-5.1', name: 'GLM 5.1 (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'glm-5', name: 'GLM 5 (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'kimi-k2.5', name: 'Kimi K2.5 (Zen)', supportsThinking: true, thinkingType: 'kimi', thinkingLevels: ['enabled', 'disabled'] },
      { id: 'kimi-k2.6', name: 'Kimi K2.6 (Zen)', supportsThinking: true, thinkingType: 'kimi', thinkingLevels: ['enabled', 'disabled'] },
      { id: 'big-pickle', name: 'Big Pickle (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'ling-2.6-flash', name: 'Ling 2.6 Flash (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'hy3-preview-free', name: 'Hy3 Preview Free (Zen)', supportsThinking: false, thinkingType: 'none' },
      { id: 'nemotron-3-super-free', name: 'Nemotron 3 Super Free (Zen)', supportsThinking: false, thinkingType: 'none' },
    ],
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    needsKey: true,
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro (Go)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['low', 'medium', 'high', 'max', 'xhigh'] },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash (Go)', supportsThinking: true, thinkingType: 'openai', thinkingLevels: ['low', 'medium', 'high', 'max', 'xhigh'] },
      { id: 'glm-5.1', name: 'GLM 5.1 (Go)', supportsThinking: false, thinkingType: 'none' },
      { id: 'glm-5', name: 'GLM 5 (Go)', supportsThinking: false, thinkingType: 'none' },
      { id: 'kimi-k2.5', name: 'Kimi K2.5 (Go)', supportsThinking: true, thinkingType: 'kimi', thinkingLevels: ['enabled', 'disabled'] },
      { id: 'kimi-k2.6', name: 'Kimi K2.6 (Go)', supportsThinking: true, thinkingType: 'kimi', thinkingLevels: ['enabled', 'disabled'] },
      { id: 'mimo-v2-pro', name: 'MiMo V2 Pro (Go)', supportsThinking: true, thinkingType: 'kimi', thinkingLevels: ['enabled', 'disabled'] },
      { id: 'mimo-v2-omni', name: 'MiMo V2 Omni (Go)', supportsThinking: true, thinkingType: 'kimi', thinkingLevels: ['enabled', 'disabled'] },
      { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro (Go)', supportsThinking: true, thinkingType: 'kimi', thinkingLevels: ['enabled', 'disabled'] },
      { id: 'mimo-v2.5', name: 'MiMo V2.5 (Go)', supportsThinking: true, thinkingType: 'kimi', thinkingLevels: ['enabled', 'disabled'] },
      { id: 'minimax-m2.7', name: 'MiniMax M2.7 (Go)', supportsThinking: false, thinkingType: 'none' },
      { id: 'minimax-m2.5', name: 'MiniMax M2.5 (Go)', supportsThinking: false, thinkingType: 'none' },
      { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus (Go)', supportsThinking: true, thinkingType: 'none', thinkingLevels: ['enabled'] },
      { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus (Go)', supportsThinking: true, thinkingType: 'none', thinkingLevels: ['enabled'] },
    ],
  },
];

/** Get all models for a provider (catalog + user custom) */
export function getProviderModels(
  provider: ProviderInfo,
  customModels: CustomModel[],
): ModelInfo[] {
  const customs = customModels
    .filter((c) => c.providerId === provider.id)
    .map((c) => ({ id: c.modelId, name: c.name }));
  return [...provider.models, ...customs];
}

/** Check if a model is enabled for a provider.
 *  Absent key = all catalog models enabled by default. */
export function isModelEnabled(
  enabledModels: Record<string, string[]>,
  providerId: string,
  modelId: string,
): boolean {
  const explicit = enabledModels[providerId];
  if (!explicit) return true;
  return explicit.includes(modelId);
}

/** Get flat list of enabled models for a single provider */
export function getEnabledModelsForProvider(
  providerId: string,
  enabledModels: Record<string, string[]>,
  customModels: CustomModel[],
): ModelInfo[] {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return [];
  const all = getProviderModels(provider, customModels);
  return all.filter((m) => isModelEnabled(enabledModels, providerId, m.id));
}

/** Get all enabled models grouped by provider */
export function getAllEnabledModelsGrouped(
  enabledModels: Record<string, string[]>,
  customModels: CustomModel[],
): Array<{ provider: ProviderInfo; models: ModelInfo[] }> {
  return PROVIDERS.map((p) => ({
    provider: p,
    models: getEnabledModelsForProvider(p.id, enabledModels, customModels),
  })).filter((g) => g.models.length > 0);
}

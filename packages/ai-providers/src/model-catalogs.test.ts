import { describe, expect, it } from 'vitest';

import {
  AnthropicProvider,
  ClaudeAgentProvider,
  GeminiProvider,
  GitHubCopilotProvider,
  OpenAIProvider,
  OpenCodeGoProvider,
  OpenCodeZenProvider,
  OpenRouterProvider,
} from './index';

function modelIds(provider: { models: Array<{ id: string }> }): string[] {
  return provider.models.map((model) => model.id);
}

describe('provider model catalogs', () => {
  it('exposes the current direct-provider model families', () => {
    // SOTA-only direct catalogs (Oct 2026): current flagship generations per
    // official vendor docs — legacy models serve via gateways, not direct.
    expect(modelIds(new AnthropicProvider('key'))).toEqual([
      'claude-fable-5-1',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-4-5-20251001',
    ]);
    expect(modelIds(new ClaudeAgentProvider('key'))).toEqual(
      expect.arrayContaining([
        'claude-fable-5-1',
        'claude-fable-5',
        'claude-opus-5-5',
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-sonnet-5-5',
        'claude-sonnet-5',
        'claude-haiku-4-5',
      ]),
    );
    expect(modelIds(new OpenAIProvider('key'))).toEqual([
      'gpt-6-astra',
      'gpt-6.1-sol',
      'gpt-6-sol',
      'gpt-6-luna',
    ]);
    expect(modelIds(new GeminiProvider('key'))).toEqual([
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
    ]);
    expect(modelIds(new GeminiProvider('key'))).not.toContain('gemini-3.1-flash-lite');
  });

  it('tracks the official GitHub Copilot supported-models list', () => {
    const ids = modelIds(new GitHubCopilotProvider('key'));

    expect(ids).toEqual(
      expect.arrayContaining([
        'gpt-6.1-sol',
        'gpt-6-sol',
        'gpt-6-luna',
        'gpt-6-astra',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.5',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
        'gpt-5.3-codex',
        'claude-fable-5-1',
        'claude-opus-5-5',
        'claude-sonnet-5-5',
        'claude-opus-4-8-fast',
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'mai-code-1.1-flash',
        'kimi-k3',
        'kimi-k2.7-code',
        'grok-4.7',
        'grok-4.6',
      ]),
    );
    expect(ids).not.toEqual(
      expect.arrayContaining([
        'gpt-4.1',
        'gpt-4o',
        'gpt-5.2',
        'gpt-5.2-codex',
        'grok-code-fast-1',
        'raptor-mini',
        'gemini-3-flash',
        'claude-sonnet-4.5',
        'claude-opus-4.5',
        'claude-opus-4.6',
        'mai-code-1-flash',
        'gpt-5.6',
      ]),
    );
  });

  it('keeps gateway fallbacks aligned with their current discovery APIs', () => {
    expect(modelIds(new OpenRouterProvider('key'))).toEqual(
      expect.arrayContaining([
        'anthropic/claude-fable-5',
        'anthropic/claude-fable-5.1',
        'anthropic/claude-opus-5-5',
        'anthropic/claude-opus-5',
        'anthropic/claude-opus-4.8',
        'anthropic/claude-sonnet-5-5',
        'openai/gpt-6.1-sol',
        'openai/gpt-6-sol',
        'openai/gpt-6-luna',
        'openai/gpt-6-astra',
        'openai/gpt-5.5',
        'openai/gpt-5.6-sol',
        'openai/gpt-5.6-luna',
        'google/gemini-3.5-flash',
        'google/gemini-3.8-flash',
        'x-ai/grok-4.7',
        'x-ai/grok-4.5',
        'x-ai/grok-4.6',
        'moonshotai/kimi-k3',
        'deepseek/deepseek-v4.1-flash',
        'xiaomi/mimo-v2.6-flash',
        'tencent/hy3',
        'tencent/hy4-preview',
        'qwen/qwen3.8-max',
        'qwen/qwen3.8-flash',
        'z-ai/glm-5.3',
        'z-ai/glm-5.3-flash',
        'minimax/minimax-m2.7',
        'meta/muse-spark-1.3',
        'deepseek/deepseek-v4-flash-vision-exp',
      ]),
    );
    expect(modelIds(new OpenRouterProvider('key'))).not.toEqual(
      expect.arrayContaining([
        'openai/o3',
        'openai/o4-mini',
        'meta-llama/llama-4-scout',
        'deepseek/deepseek-r1',
        'google/gemini-2.5-flash',
      ]),
    );
    expect(modelIds(new OpenCodeZenProvider('key'))).toEqual(
      expect.arrayContaining([
        'claude-fable-5-1',
        'claude-fable-5',
        'claude-opus-5-5',
        'claude-opus-4-8',
        'claude-sonnet-5-5',
        'claude-sonnet-5',
        'gemini-3.5-flash',
        'gemini-3.7-flash',
        'gemini-3.8-flash',
        'gpt-6-astra',
        'gpt-6-sol',
        'gpt-6.1-sol',
        'gpt-6-luna',
        'gpt-5.6-sol',
        'gpt-5.2-codex',
        'glm-5.3',
        'glm-5.3-flash',
        'glm-5.2',
        'grok-4.7',
        'grok-4.5',
        'qwen3.8-max',
        'qwen3.8-flash',
        'kimi-k3',
        'kimi-k2.5',
        'deepseek-v4.1-flash',
        'minimax-m2.5',
        'muse-spark-1.3',
        'muse-spark-1.2',
        'muse-spark-1.3-contributor-free',
        'space-bunny-free',
        'longcat-2.5-preview-free',
        'mimo-v2.6-flash-free',
        'ling-3.0-flash-fin-free',
        'big-pickle',
        'mimo-v2.5-free',
      ]),
    );
    // Retired upstream must not linger in the static fallback.
    expect(modelIds(new OpenCodeZenProvider('key'))).toEqual(
      expect.not.arrayContaining([
        'claude-sonnet-4',
        'laguna-s-2.1-free',
        'deepseek-v4-flash-free',
        'hy3-free',
        'north-mini-code-free',
        'x-preview-f-free',
        'muse-spark-1.2-contributor-free',
      ]),
    );
    expect(modelIds(new OpenCodeGoProvider('key'))).toEqual(
      expect.arrayContaining([
        'grok-4.7',
        'grok-4.6',
        'gpt-6-luna',
        'gpt-5.6-luna',
        'glm-5.2',
        'glm-5.3',
        'glm-5.3-flash',
        'longcat-2.0',
        'longcat-2.5-preview-free',
        'space-bunny-free',
        'kimi-k3',
        'kimi-k2.7-code',
        'kimi-k2.6',
        'deepseek-v4.1-flash',
        'deepseek-v4-flash-vision-exp',
        'deepseek-v4-pro',
        'deepseek-v4-flash',
        'minimax-m3',
        'minimax-m2.7',
        'muse-spark-1.3-contributor',
        'muse-spark-1.2-contributor',
        'mimo-v2.6-flash',
        'mimo-v2.6-pro',
        'qwen3.8-max',
        'qwen3.8-flash',
        'qwen3.7-plus',
        'mimo-v2.5',
        'mimo-v2.5-pro',
        'hy4-preview',
        'hy3',
      ]),
    );
    // Retired from Go upstream must not linger in the static fallback.
    expect(modelIds(new OpenCodeGoProvider('key'))).toEqual(
      expect.not.arrayContaining([
        'grok-4.5',
        'glm-5',
        'glm-5.1',
        'kimi-k2.5',
        'qwen3.5-plus',
        'qwen3.6-plus',
        'qwen3.7-max',
        'minimax-m2.5',
        'mimo-v2-pro',
        'mimo-v2-omni',
        'hy3-preview',
      ]),
    );
  });
});

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
    expect(modelIds(new AnthropicProvider('key'))).toEqual(
      expect.arrayContaining([
        'claude-fable-5',
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-sonnet-5',
        'claude-opus-4-7',
        'claude-opus-4-6',
        'claude-sonnet-4-6',
        'claude-opus-4-5',
        'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5-20251001',
      ]),
    );
    expect(modelIds(new ClaudeAgentProvider('key'))).toEqual(
      expect.arrayContaining([
        'claude-fable-5',
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-sonnet-5',
        'claude-haiku-4-5',
      ]),
    );
    expect(modelIds(new OpenAIProvider('key'))).toContain('gpt-5.5');
    expect(modelIds(new GeminiProvider('key'))).toEqual(
      expect.arrayContaining([
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-pro',
        'gemini-3-flash',
      ]),
    );
    expect(modelIds(new GeminiProvider('key'))).not.toContain('gemini-3.1-flash-lite');
  });

  it('removes models retired from GitHub Copilot', () => {
    const ids = modelIds(new GitHubCopilotProvider('key'));

    expect(ids).toEqual(
      expect.arrayContaining([
        'gpt-5.5',
        'claude-opus-4.8',
        'gemini-3.5-flash',
        'mai-code-1-flash',
      ]),
    );
    expect(ids).not.toEqual(
      expect.arrayContaining(['gpt-4.1', 'gpt-4o', 'gpt-5.2', 'gpt-5.2-codex', 'grok-code-fast-1']),
    );
  });

  it('keeps gateway fallbacks aligned with their current discovery APIs', () => {
    expect(modelIds(new OpenRouterProvider('key'))).toEqual(
      expect.arrayContaining([
        'anthropic/claude-fable-5',
        'anthropic/claude-opus-4.8',
        'openai/gpt-5.5',
        'google/gemini-3.5-flash',
        'x-ai/grok-4.5',
        'moonshotai/kimi-k3',
        'tencent/hy3',
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
        'claude-fable-5',
        'claude-opus-4-8',
        'claude-sonnet-5',
        'gemini-3.5-flash',
        'glm-5.2',
        'grok-4.5',
        'kimi-k3',
      ]),
    );
    expect(modelIds(new OpenCodeGoProvider('key'))).toEqual(
      expect.arrayContaining([
        'grok-4.5',
        'glm-5.2',
        'kimi-k3',
        'kimi-k2.7-code',
        'minimax-m3',
        'qwen3.7-max',
        'qwen3.7-plus',
        'hy3',
      ]),
    );
  });
});

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AIProvider, Message, StreamChunk, ToolDefinition } from './types';
import { AnthropicProvider } from './providers/anthropic';
import { OpenRouterProvider } from './providers/openrouter';

const liveEnabled = process.env.HYSCODE_LIVE_PROVIDER_ACCEPTANCE === '1';
const providerFilter = process.env.HYSCODE_LIVE_PROVIDER;

function loadLocalKeys(): Record<string, string> {
  const appData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return JSON.parse(readFileSync(join(appData, 'hyscode', 'keychain.json'), 'utf8')) as Record<string, string>;
}

const echoTool: ToolDefinition = {
  name: 'acceptance_echo',
  description: 'Return the supplied value. Always call this tool once when asked to verify integration.',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
};

async function collect(provider: AIProvider, model: string, messages: Message[]): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of provider.chat({
    model,
    messages,
    tools: [echoTool],
    maxTokens: 128,
    signal: AbortSignal.timeout(90_000),
  })) {
    chunks.push(chunk);
    if (chunk.type === 'error') throw new Error(chunk.error);
  }
  return chunks;
}

async function verifyToolRoundTrip(provider: AIProvider, model: string): Promise<void> {
  const userMessage: Message = {
    role: 'user',
    content: [{ type: 'text', text: 'Call acceptance_echo with value HYS_ACCEPTED. Do not answer before calling it.' }],
  };
  const first = await collect(provider, model, [userMessage]);
  const start = first.find((chunk) => chunk.type === 'tool_call_start');
  expect(start?.type).toBe('tool_call_start');
  if (!start || start.type !== 'tool_call_start') throw new Error(`${provider.id} did not request the acceptance tool.`);

  const input = first
    .filter((chunk) => chunk.type === 'tool_call_delta' && chunk.id === start.id)
    .map((chunk) => chunk.type === 'tool_call_delta' ? chunk.input : '')
    .join('');
  expect(input).toContain('HYS_ACCEPTED');
  const assistant: Message = {
    role: 'assistant',
    content: [{
      type: 'tool_call',
      id: start.id,
      name: start.name,
      input: JSON.parse(input) as Record<string, unknown>,
    }],
  };
  const toolResult: Message = {
    role: 'tool',
    content: [{ type: 'tool_result', toolCallId: start.id, output: 'HYS_ACCEPTED' }],
  };
  const second = await collect(provider, model, [userMessage, assistant, toolResult]);
  const text = second
    .filter((chunk) => chunk.type === 'text_delta')
    .map((chunk) => chunk.type === 'text_delta' ? chunk.text : '')
    .join('');
  expect(text).toContain('HYS_ACCEPTED');
  expect(second.some((chunk) => chunk.type === 'done')).toBe(true);
}

describe.skipIf(!liveEnabled)('live provider acceptance', () => {
  const keys = liveEnabled ? loadLocalKeys() : {};

  it.skipIf(Boolean(providerFilter && providerFilter !== 'anthropic'))('round-trips a tool call through the Anthropic protocol', async () => {
    const key = keys['hyscode:anthropic_api_key'];
    expect(key, 'Anthropic key is not configured in the HysCode keychain.').toBeTruthy();
    await verifyToolRoundTrip(new AnthropicProvider(key), 'claude-haiku-4-5');
  }, 120_000);

  it.skipIf(Boolean(providerFilter && providerFilter !== 'openrouter'))('round-trips a tool call through an OpenAI-compatible protocol', async () => {
    const key = keys['hyscode:openrouter_api_key'];
    expect(key, 'OpenRouter key is not configured in the HysCode keychain.').toBeTruthy();
    await verifyToolRoundTrip(new OpenRouterProvider(key), 'google/gemini-2.5-flash');
  }, 120_000);
});

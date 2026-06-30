import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getProviderRegistry } from '@hyscode/ai-providers';
import { Harness } from './harness';
import type { ToolHandler } from './types';

const liveEnabled = process.env.HYSCODE_LIVE_HARNESS_ACCEPTANCE === '1';

function loadLocalKeys(): Record<string, string> {
  const appData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return JSON.parse(readFileSync(join(appData, 'hyscode', 'keychain.json'), 'utf8')) as Record<string, string>;
}

describe.skipIf(!liveEnabled)('live agent harness acceptance', () => {
  it('completes an approved multi-iteration tool turn through OpenRouter', async () => {
    const keys = loadLocalKeys();
    const openRouterKey = keys['hyscode:openrouter_api_key'];
    expect(openRouterKey, 'OpenRouter key is not configured in the HysCode keychain.').toBeTruthy();
    await getProviderRegistry().initialize({
      get: async (name) => name === 'openrouter_api_key' ? openRouterKey : null,
      set: async () => undefined,
      delete: async () => undefined,
    });

    let approvals = 0;
    const harness = new Harness({
      workspacePath: process.cwd(),
      projectId: 'live-acceptance',
      invoke: async <T>() => undefined as T,
      onApprovalRequest: async () => {
        approvals++;
        return true;
      },
      config: {
        providerId: 'openrouter',
        modelId: 'google/gemini-2.5-flash',
        maxIterations: 5,
        maxOutputTokens: 256,
        approval: { mode: 'manual' },
      },
    });
    harness.setConversationId(crypto.randomUUID());
    const echoTool: ToolHandler = {
      definition: {
        name: 'acceptance_echo',
        description: 'Return the supplied value. Always use this tool when explicitly requested.',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        },
      },
      category: 'meta',
      requiresApproval: true,
      execute: async (input) => ({ success: true, output: String(input.value) }),
    };
    harness.registerExternalTool(echoTool);

    const outcome = await harness.run({
      userMessage: 'Call acceptance_echo exactly once with value HYS_HARNESS_ACCEPTED, then report that value.',
      history: [],
    });
    expect(outcome.status).toBe('complete');
    expect(outcome.toolCalls).toHaveLength(1);
    expect(outcome.toolCalls[0]).toMatchObject({ toolName: 'acceptance_echo', approved: true });
    expect(outcome.toolCalls[0].input).toEqual({ value: 'HYS_HARNESS_ACCEPTED' });
    expect(outcome.response).toContain('HYS_HARNESS_ACCEPTED');
    expect(approvals).toBe(1);
  }, 180_000);
});

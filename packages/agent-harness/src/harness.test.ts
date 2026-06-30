import { afterEach, describe, expect, it } from 'vitest';
import { getProviderRegistry, type AIProvider, type ChatParams, type StreamChunk } from '@hyscode/ai-providers';
import { Harness } from './harness';
import type { HarnessEvent } from './types';

const model = {
  id: 'test-model',
  name: 'Test',
  provider: 'harness-test',
  contextWindow: 32_000,
  maxOutputTokens: 4_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsVision: false,
};

function provider(toolName: string, input: Record<string, unknown>): AIProvider {
  let call = 0;
  return {
    id: 'harness-test',
    name: 'Harness Test',
    models: [model],
    isConfigured: () => true,
    listModels: async () => [model],
    async *chat(_params: ChatParams): AsyncIterable<StreamChunk> {
      call++;
      const id = `call-${call}`;
      yield { type: 'tool_call_start', id, name: toolName };
      yield { type: 'tool_call_delta', id, input: JSON.stringify(input) };
      yield { type: 'tool_call_end', id };
      yield { type: 'done', stopReason: 'tool_use' };
    },
  };
}

afterEach(() => getProviderRegistry().unregister('harness-test'));

describe('Harness lifecycle', () => {
  it('returns a visible max-iteration outcome and one terminal event', async () => {
    getProviderRegistry().register(provider('read_file', { path: 'a.ts' }));
    const events: HarnessEvent[] = [];
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async () => 'const value = 1;' as never,
      onEvent: (event) => events.push(event),
      config: { providerId: 'harness-test', modelId: 'test-model', maxIterations: 2 },
    });
    harness.setAgentType('build');
    harness.setConversationId('conversation');
    const result = await harness.run('inspect', []);
    expect(result.status).toBe('max_iterations');
    expect(result.response).toContain('2-iteration limit');
    expect(events.filter((event) => event.type === 'turn_end')).toHaveLength(1);
  });

  it('cancels a turn waiting for tool approval', async () => {
    getProviderRegistry().register(provider('write_file', { path: 'a.ts', content: 'x' }));
    let approvalStarted!: () => void;
    const waiting = new Promise<void>((resolve) => { approvalStarted = resolve; });
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async () => undefined as never,
      config: { providerId: 'harness-test', modelId: 'test-model', maxIterations: 3, approval: { mode: 'manual' } },
      onApprovalRequest: async (_pending, signal) => {
        approvalStarted();
        return new Promise<boolean>((resolve) => signal.addEventListener('abort', () => resolve(false), { once: true }));
      },
    });
    harness.setAgentType('build');
    harness.setConversationId('conversation');
    const run = harness.run('edit', []);
    await waiting;
    harness.cancel();
    const result = await run;
    expect(result.status).toBe('cancelled');
    expect(result.response).toBe('Request cancelled.');
  });
});

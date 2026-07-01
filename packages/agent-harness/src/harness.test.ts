import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getProviderRegistry,
  type AIProvider,
  type ChatParams,
  type StreamChunk,
} from '@hyscode/ai-providers';
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
  it('preserves a partial stream and requires explicit continuation', async () => {
    const interruptedProvider: AIProvider = {
      id: 'harness-test',
      name: 'Harness Test',
      models: [model],
      isConfigured: () => true,
      listModels: async () => [model],
      async *chat(): AsyncIterable<StreamChunk> {
        yield { type: 'text_delta', text: 'preserved partial response' };
        throw new Error('connection reset while streaming');
      },
    };
    getProviderRegistry().register(interruptedProvider);
    const events: HarnessEvent[] = [];
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async () => undefined as never,
      onEvent: (event) => events.push(event),
      config: { providerId: 'harness-test', modelId: 'test-model' },
    });
    harness.setConversationId('conversation');
    const result = await harness.run('continue for a long time', []);
    expect(result.status).toBe('recoverable_error');
    expect(result.response).toBe('preserved partial response');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'turn_recoverable_error',
        recovery: expect.objectContaining({
          action: 'continue',
          partialText: 'preserved partial response',
        }),
      }),
    );
  });

  it('never executes an incomplete tool call', async () => {
    const incompleteToolProvider: AIProvider = {
      id: 'harness-test',
      name: 'Harness Test',
      models: [model],
      isConfigured: () => true,
      listModels: async () => [model],
      async *chat(): AsyncIterable<StreamChunk> {
        yield { type: 'tool_call_start', id: 'partial', name: 'write_file' };
        yield { type: 'tool_call_delta', id: 'partial', input: '{"path":' };
        throw new Error('stream closed');
      },
    };
    getProviderRegistry().register(incompleteToolProvider);
    const invoke = vi.fn();
    const events: HarnessEvent[] = [];
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke,
      onEvent: (event) => events.push(event),
      config: { providerId: 'harness-test', modelId: 'test-model' },
    });
    harness.setConversationId('conversation');
    const result = await harness.run('edit', []);
    expect(result.status).toBe('recoverable_error');
    expect(invoke).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'turn_recoverable_error',
        recovery: expect.objectContaining({ action: 'retry', possibleDuplicateCharge: true }),
      }),
    );
  });

  it('starts with a bounded output budget and escalates only after max_tokens', async () => {
    const budgets: number[] = [];
    let call = 0;
    const adaptiveProvider: AIProvider = {
      id: 'harness-test',
      name: 'Harness Test',
      models: [{ ...model, maxOutputTokens: 16_000 }],
      isConfigured: () => true,
      listModels: async () => [{ ...model, maxOutputTokens: 16_000 }],
      async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
        budgets.push(params.maxTokens ?? 0);
        call++;
        yield { type: 'text_delta', text: call === 1 ? 'partial' : 'complete' };
        yield { type: 'done', stopReason: call === 1 ? 'max_tokens' : 'end_turn' };
      },
    };
    getProviderRegistry().register(adaptiveProvider);
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async () => undefined as never,
      config: {
        providerId: 'harness-test',
        modelId: 'test-model',
        maxOutputTokens: 16_000,
        maxIterations: 3,
      },
    });
    harness.setAgentType('build');
    harness.setConversationId('conversation');
    const result = await harness.run('implement', []);
    expect(budgets).toEqual([8_000, 16_000]);
    expect(result.response).toBe('complete');
  });

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
    const waiting = new Promise<void>((resolve) => {
      approvalStarted = resolve;
    });
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async () => undefined as never,
      config: {
        providerId: 'harness-test',
        modelId: 'test-model',
        maxIterations: 3,
        approval: { mode: 'manual' },
      },
      onApprovalRequest: async (_pending, signal) => {
        approvalStarted();
        return new Promise<boolean>((resolve) =>
          signal.addEventListener('abort', () => resolve(false), { once: true }),
        );
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

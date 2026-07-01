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

function longRunningProvider(iterationsBeforeCompletion: number): AIProvider {
  let call = 0;
  return {
    id: 'harness-test',
    name: 'Harness Test',
    models: [model],
    isConfigured: () => true,
    listModels: async () => [model],
    async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
      call++;
      expect(params.maxTurns).toBeUndefined();
      if (call > iterationsBeforeCompletion) {
        yield { type: 'text_delta', text: 'completed after a long run' };
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      const id = `call-${call}`;
      yield { type: 'tool_call_start', id, name: 'read_file' };
      yield { type: 'tool_call_delta', id, input: JSON.stringify({ path: `file-${call}.ts` }) };
      yield { type: 'tool_call_end', id };
      yield { type: 'done', stopReason: 'tool_use' };
    },
  };
}

function modeSwitchProvider(onRequest?: (params: ChatParams, call: number) => void): AIProvider {
  let call = 0;
  return {
    id: 'harness-test',
    name: 'Harness Test',
    models: [model],
    isConfigured: () => true,
    listModels: async () => [model],
    async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
      call++;
      onRequest?.(params, call);
      if (call === 1) {
        yield { type: 'tool_call_start', id: 'switch-1', name: 'request_mode_switch' };
        yield {
          type: 'tool_call_delta',
          id: 'switch-1',
          input: JSON.stringify({
            target_mode: 'build',
            reason: 'Implement the review findings',
            context_summary: 'Fix the validated findings in src/app.ts',
          }),
        };
        yield { type: 'tool_call_end', id: 'switch-1' };
        yield { type: 'done', stopReason: 'tool_use' };
        return;
      }
      yield { type: 'text_delta', text: 'Build agent continued automatically.' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

afterEach(() => getProviderRegistry().unregister('harness-test'));

describe('Harness lifecycle', () => {
  it('runs beyond the former 25-iteration default when unlimited', async () => {
    getProviderRegistry().register(longRunningProvider(26));
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async () => 'content' as never,
      config: {
        providerId: 'harness-test',
        modelId: 'test-model',
        approval: { mode: 'yolo' },
        costOptimization: false,
      },
    });
    harness.setAgentType('build');
    harness.setConversationId('conversation');

    const result = await harness.run('complete a long task', []);

    expect(result.status).toBe('complete');
    expect(result.turnRecord.iterations).toBe(27);
    expect(result.response).toBe('completed after a long run');
  });

  it('switches from review to build within the same turn using a frozen delegation chain', async () => {
    const requests: Array<{ call: number; tools: string[] }> = [];
    getProviderRegistry().register(
      modeSwitchProvider((params, call) => {
        requests.push({ call, tools: params.tools?.map((tool) => tool.name) ?? [] });
      }),
    );
    const events: HarnessEvent[] = [];
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async () => undefined as never,
      onEvent: (event) => events.push(event),
      onModeSwitchRequest: async () => true,
      config: {
        providerId: 'harness-test',
        modelId: 'test-model',
        approval: { mode: 'yolo' },
        costOptimization: false,
      },
    });
    harness.setAgentType('review');
    harness.setDelegationChain(Object.freeze([]));
    harness.setConversationId('conversation');

    const result = await harness.run('review and delegate the fixes', []);

    expect(result.status).toBe('complete');
    expect(result.response).toBe('Build agent continued automatically.');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.tools).not.toContain('write_file');
    expect(requests[1]?.tools).toContain('write_file');
    const resolved = events.filter((event) => event.type === 'mode_switch_resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual(expect.objectContaining({ approved: true }));
    expect(events.filter((event) => event.type === 'turn_end')).toHaveLength(1);
    expect(new Set(events.map((event) => event.turnId).filter(Boolean)).size).toBe(1);
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes.indexOf('mode_switch_request')).toBeLessThan(
      eventTypes.indexOf('mode_switch_resolved'),
    );
    expect(eventTypes.indexOf('mode_switch_resolved')).toBeLessThan(
      eventTypes.lastIndexOf('turn_start'),
    );
    expect(eventTypes.lastIndexOf('turn_start')).toBeLessThan(eventTypes.indexOf('turn_end'));
  });

  it('keeps review mode when the delegation is denied', async () => {
    const requests: string[][] = [];
    getProviderRegistry().register(
      modeSwitchProvider((params) => requests.push(params.tools?.map((tool) => tool.name) ?? [])),
    );
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async () => undefined as never,
      onModeSwitchRequest: async () => false,
      config: {
        providerId: 'harness-test',
        modelId: 'test-model',
        approval: { mode: 'yolo' },
        costOptimization: false,
      },
    });
    harness.setAgentType('review');
    harness.setConversationId('conversation');

    const result = await harness.run('review only', []);

    expect(result.status).toBe('complete');
    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toContain('write_file');
  });

  it('releases the active turn after an unexpected delegation error', async () => {
    getProviderRegistry().register(modeSwitchProvider());
    const events: HarnessEvent[] = [];
    let failDecision = true;
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async () => undefined as never,
      onEvent: (event) => events.push(event),
      onModeSwitchRequest: async () => {
        if (failDecision) throw new Error('mode switch callback failed');
        return false;
      },
      config: {
        providerId: 'harness-test',
        modelId: 'test-model',
        approval: { mode: 'yolo' },
      },
    });
    harness.setAgentType('review');
    harness.setConversationId('conversation');

    await expect(harness.run('delegate', [])).rejects.toThrow('mode switch callback failed');
    expect(events.filter((event) => event.type === 'turn_end')).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'turn_end', reason: 'error' }));

    failDecision = false;
    const next = await harness.run('continue', []);
    expect(next.status).toBe('complete');
    expect(next.response).toBe('Build agent continued automatically.');
  });

  it('cancels cleanly while a mode switch decision is pending', async () => {
    getProviderRegistry().register(modeSwitchProvider());
    let decisionStarted!: () => void;
    const waiting = new Promise<void>((resolve) => {
      decisionStarted = resolve;
    });
    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async () => undefined as never,
      onModeSwitchRequest: async (_request, signal) => {
        decisionStarted();
        return new Promise<boolean>((resolve) => {
          signal.addEventListener('abort', () => resolve(false), { once: true });
        });
      },
      config: {
        providerId: 'harness-test',
        modelId: 'test-model',
        approval: { mode: 'yolo' },
      },
    });
    harness.setAgentType('review');
    harness.setConversationId('conversation');

    const run = harness.run('delegate', []);
    await waiting;
    harness.cancel();

    const result = await run;
    expect(result.status).toBe('cancelled');
    expect(result.response).toBe('Request cancelled.');
  });

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

import { afterEach, describe, expect, it } from 'vitest';
import {
  getProviderRegistry,
  type AIProvider,
  type ChatParams,
  type StreamChunk,
} from '@hyscode/ai-providers';
import { Harness } from './harness';
import type { ToolHandler } from './types';

const model = {
  id: 'parallel-model',
  name: 'Parallel test model',
  provider: 'parallel-test',
  contextWindow: 32_000,
  maxOutputTokens: 4_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsVision: false,
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function batchProvider(toolNames: string[]): AIProvider {
  let call = 0;
  return {
    id: 'parallel-test',
    name: 'Parallel test provider',
    models: [model],
    isConfigured: () => true,
    listModels: async () => [model],
    async *chat(_params: ChatParams): AsyncIterable<StreamChunk> {
      call += 1;
      if (call === 1) {
        for (const [index, name] of toolNames.entries()) {
          const id = `batch-${index}`;
          yield { type: 'tool_call_start', id, name };
          yield { type: 'tool_call_delta', id, input: JSON.stringify({ index }) };
          yield { type: 'tool_call_end', id };
        }
        yield { type: 'done', stopReason: 'tool_use' };
        return;
      }
      yield { type: 'text_delta', text: 'batch complete' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

function parallelHandler(name: string, started: string[], finished: string[]): ToolHandler {
  return {
    definition: {
      name,
      description: `parallel test tool ${name}`,
      inputSchema: { type: 'object', properties: {} },
    },
    category: 'meta',
    requiresApproval: false,
    parallel: true,
    execute: async () => {
      started.push(name);
      await delay(30);
      finished.push(name);
      return { success: true, output: name };
    },
  };
}

afterEach(() => getProviderRegistry().unregister('parallel-test'));

describe('Harness parallel batches', () => {
  it('runs a batch of parallel-safe tools concurrently and preserves order', async () => {
    getProviderRegistry().register(batchProvider(['par-a', 'par-b']));
    const started: string[] = [];
    const finished: string[] = [];
    let overlapped = false;

    const harness = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async <T>(_cmd: string, _args?: Record<string, unknown>) => 'ok' as T,
      config: {
        providerId: 'parallel-test',
        modelId: 'parallel-model',
        approval: { mode: 'yolo' },
        costOptimization: false,
      },
    });
    const handlerA = parallelHandler('par-a', started, finished);
    const handlerB = parallelHandler('par-b', started, finished);
    const originalExecuteA = handlerA.execute;
    const originalExecuteB = handlerB.execute;
    handlerA.execute = async (input, ctx) => {
      const result = await originalExecuteA(input, ctx);
      if (started.length === 2) overlapped = true;
      return result;
    };
    handlerB.execute = async (input, ctx) => {
      const result = await originalExecuteB(input, ctx);
      if (started.length === 2) overlapped = true;
      return result;
    };
    harness.registerExternalTool(handlerA);
    harness.registerExternalTool(handlerB);
    harness.setAgentType('build');
    harness.setConversationId('conversation');

    const outcome = await harness.run('run the parallel batch', []);

    expect(outcome.status).toBe('complete');
    expect(outcome.response).toBe('batch complete');
    // Both tools must have started before the first one finished.
    expect(started).toHaveLength(2);
    expect(finished).toHaveLength(2);
    expect(overlapped).toBe(true);
    // Tool call history preserves the original batch order.
    expect(outcome.toolCalls.map((call) => call.toolName)).toEqual(['par-a', 'par-b']);
  });
});

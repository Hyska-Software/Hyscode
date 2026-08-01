import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getProviderRegistry,
  type AIProvider,
  type ChatParams,
  type StreamChunk,
} from '@hyscode/ai-providers';
import {
  Harness,
  type HarnessEvent,
  type TurnRecord,
} from '@hyscode/agent-harness';
import type { SubAgentState } from '@/stores/agent-store';
import { SubAgentRunner, type SubAgentRunnerOptions } from './sub-agent-runner';

const settings = vi.hoisted(() => ({
  activeProviderId: 'desktop-subagent-test',
  activeModelId: 'desktop-subagent-model',
  subAgentAutoApprove: true,
  subAgentMaxIterations: 8,
  approvalMode: 'yolo' as const,
  customApprovalRules: { categoryRules: {}, toolRules: {} },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: { getState: () => settings },
}));

const model = {
  id: 'desktop-subagent-model',
  name: 'Desktop sub-agent test model',
  provider: 'desktop-subagent-test',
  contextWindow: 32_000,
  maxOutputTokens: 4_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsVision: false,
};

function parentHarness(): Harness {
  return new Harness({
    workspacePath: 'C:/workspace',
    projectId: 'project',
    invoke: async <T>(_cmd: string, _args?: Record<string, unknown>) => 'file contents' as T,
    config: {
      providerId: 'desktop-subagent-test',
      modelId: 'desktop-subagent-model',
      approval: { mode: 'yolo' },
      costOptimization: false,
    },
  });
}

function finalProvider(): AIProvider {
  return {
    id: 'desktop-subagent-test',
    name: 'Desktop sub-agent test provider',
    models: [model],
    isConfigured: () => true,
    listModels: async () => [model],
    async *chat(_params: ChatParams): AsyncIterable<StreamChunk> {
      yield {
        type: 'usage',
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
      };
      yield { type: 'text_delta', text: 'adapter result' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

function readLoopProvider(): AIProvider {
  let calls = 0;
  return {
    id: 'desktop-subagent-test',
    name: 'Desktop sub-agent test provider',
    models: [model],
    isConfigured: () => true,
    listModels: async () => [model],
    async *chat(_params: ChatParams): AsyncIterable<StreamChunk> {
      calls += 1;
      if (calls > 4) {
        yield { type: 'text_delta', text: 'completed after range reads' };
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      const id = `read-${calls}`;
      yield { type: 'tool_call_start', id, name: 'read_file' };
      yield {
        type: 'tool_call_delta',
        id,
        input: JSON.stringify({
          path: 'src/repeated.ts',
          start_line: (calls - 1) * 100 + 1,
          end_line: calls * 100,
        }),
      };
      yield { type: 'tool_call_end', id };
      yield { type: 'done', stopReason: 'tool_use' };
    },
  };
}

function manyChunksProvider(): AIProvider {
  return {
    id: 'desktop-subagent-test',
    name: 'Desktop sub-agent test provider',
    models: [model],
    isConfigured: () => true,
    listModels: async () => [model],
    async *chat(_params: ChatParams): AsyncIterable<StreamChunk> {
      for (let index = 0; index < 20; index++) {
        yield { type: 'text_delta', text: `chunk-${index} ` };
      }
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

function thinkingProvider(): AIProvider {
  return {
    id: 'desktop-subagent-test',
    name: 'Desktop sub-agent test provider',
    models: [model],
    isConfigured: () => true,
    listModels: async () => [model],
    async *chat(_params: ChatParams): AsyncIterable<StreamChunk> {
      for (let index = 0; index < 5; index++) {
        yield { type: 'thinking_delta', text: `reasoning-${index} ` };
      }
      yield { type: 'text_delta', text: 'final answer' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

function runnerOptions(
  updates: Array<Partial<SubAgentState>>,
  bridgeEvents: Array<{ type: string }>,
  records: Array<SubAgentState['tokenUsage']>,
): SubAgentRunnerOptions {
  return {
    id: 'sub-agent-tool-call',
    task: 'Review the selected module.',
    mode: 'review' as const,
    workspacePath: 'C:/workspace',
    projectId: 'project',
    invoke: async <T>(_cmd: string, _args?: Record<string, unknown>) => 'file contents' as T,
    onApproval: async () => true,
    onUpdate: (patch: Partial<SubAgentState>) => updates.push(patch),
    onBridgeEvent: (event: HarnessEvent) => bridgeEvents.push(event),
    onTurnRecord: (record: TurnRecord) => records.push(record.tokenUsage),
    activeSkills: [],
    activeRules: [],
    parentHarness: parentHarness(),
    conversationId: 'parent-conversation',
    parentTurnId: 'parent-turn',
  };
}

afterEach(() => getProviderRegistry().unregister('desktop-subagent-test'));

describe('SubAgentRunner', () => {
  it('runs through the delegated harness and forwards usage/accounting events', async () => {
    getProviderRegistry().register(finalProvider());
    const updates: Array<Partial<SubAgentState>> = [];
    const bridgeEvents: Array<{ type: string }> = [];
    const records: Array<SubAgentState['tokenUsage']> = [];

    const runner = new SubAgentRunner(runnerOptions(updates, bridgeEvents, records));
    const result = await runner.run('Review the selected module.');

    expect(result).toBe('adapter result');
    expect(updates.at(-1)?.status).toBe('done');
    expect(updates.at(-1)?.tokenUsage?.totalTokens).toBe(28);
    expect(bridgeEvents.map((event) => event.type)).toEqual(['api_request_sent', 'stream_chunk']);
    expect(records).toHaveLength(1);
    expect(records[0]?.totalTokens).toBe(28);
  });

  it('allows legitimate non-overlapping range reads of the same file', async () => {
    getProviderRegistry().register(readLoopProvider());
    const updates: Array<Partial<SubAgentState>> = [];
    const bridgeEvents: Array<{ type: string }> = [];
    const records: Array<SubAgentState['tokenUsage']> = [];

    const runner = new SubAgentRunner(runnerOptions(updates, bridgeEvents, records));
    const result = await runner.run('Read the repeated module and report findings.');

    expect(result).toBe('completed after range reads');
    expect(updates.at(-1)?.status).toBe('done');
    expect(updates.at(-1)?.stopReason).toBe('complete');
  });

  it('coalesces streamed output updates instead of updating once per chunk', async () => {
    vi.useFakeTimers();
    try {
      getProviderRegistry().register(manyChunksProvider());
      const updates: Array<Partial<SubAgentState>> = [];
      const bridgeEvents: Array<{ type: string }> = [];
      const records: Array<SubAgentState['tokenUsage']> = [];

      const runner = new SubAgentRunner(runnerOptions(updates, bridgeEvents, records));
      const result = await runner.run('Stream a long response.');

      expect(result).toContain('chunk-19');
      const outputUpdates = updates.filter((patch) => patch.output !== undefined);
      // One coalesced flush + the final terminal update, not one per chunk.
      expect(outputUpdates.length).toBeLessThanOrEqual(2);
      expect(updates.at(-1)?.output).toContain('chunk-19');
    } finally {
      vi.useRealTimers();
    }
  });

  it('captures thinking deltas, coalesces them, and persists the final reasoning', async () => {
    vi.useFakeTimers();
    try {
      getProviderRegistry().register(thinkingProvider());
      const updates: Array<Partial<SubAgentState>> = [];
      const bridgeEvents: Array<{ type: string }> = [];
      const records: Array<SubAgentState['tokenUsage']> = [];

      const runner = new SubAgentRunner(runnerOptions(updates, bridgeEvents, records));
      const result = await runner.run('Reason about the module.');

      expect(result).toBe('final answer');
      const thinkingUpdates = updates.filter((patch) => patch.thinking !== undefined);
      // One coalesced flush + the final terminal update.
      expect(thinkingUpdates.length).toBeLessThanOrEqual(2);
      expect(updates.at(-1)?.thinking).toContain('reasoning-4');
      expect(updates.at(-1)?.output).toBe('final answer');
    } finally {
      vi.useRealTimers();
    }
  });
});

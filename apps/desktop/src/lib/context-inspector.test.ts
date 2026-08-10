import { describe, expect, it } from 'vitest';
import type { AIModel, TokenUsage } from '@hyscode/ai-providers';
import {
  buildContextInspectorViewModel,
  formatCost,
  formatTokenCount,
  parseTraceIterations,
  selectLatestMainTrace,
  type BuildContextInspectorInput,
  type PersistedTraceRow,
} from './context-inspector';

const model: AIModel = {
  id: 'inspector-model',
  name: 'Inspector Model',
  provider: 'test-provider',
  contextWindow: 128_000,
  maxOutputTokens: 8_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsVision: false,
  inputPricePerMToken: 5,
  outputPricePerMToken: 10,
  cachedInputPricePerMToken: 1,
};

function makeTrace(overrides: Partial<PersistedTraceRow> = {}): PersistedTraceRow {
  return {
    id: 'trace-1',
    conversation_id: 'conversation-1',
    mode: 'chat',
    provider: 'test-provider',
    model: 'inspector-model',
    system_prompt_hash: null,
    iterations: '[]',
    token_input: 0,
    token_output: 0,
    token_cache_read: 0,
    token_cache_write: 0,
    token_cache_measured_read: 0,
    token_cache_eligible: 0,
    token_cache_measured: 0,
    token_cache_hit_requests: 0,
    token_cache_observed_requests: 0,
    token_cache_total_requests: 0,
    token_cache_unknown_requests: 0,
    stop_reason: 'complete',
    verification_performed: false,
    verification_forced: false,
    files_modified: null,
    errors: null,
    loop_warnings: null,
    duration_ms: 0,
    created_at: '2026-08-09T12:00:00.000Z',
    parent_turn_id: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<BuildContextInspectorInput> = {}): BuildContextInspectorInput {
  return {
    conversation: {
      id: 'conversation-1',
      title: 'Inspector session',
      mode: 'chat',
      model_id: 'inspector-model',
      provider_id: 'test-provider',
      project_id: 'project-1',
      created_at: '2026-08-09T11:00:00.000Z',
      updated_at: '2026-08-09T12:00:00.000Z',
    },
    persistedUsage: null,
    traces: [],
    messages: [
      { id: 'user-1', role: 'user', content: 'Hello', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'Hi', timestamp: 2 },
    ],
    liveUsage: null,
    liveSessionUsage: null,
    model,
    providerName: 'Test Provider',
    contextWindow: 128_000,
    fallbackTitle: null,
    isStreaming: false,
    apiRequestCount: 1,
    pendingToolCallCount: 0,
    contextFiles: [],
    gatheredContext: [],
    attachedImageCount: 0,
    hasAttachedTerminal: false,
    ...overrides,
  };
}

describe('context inspector model', () => {
  it('counts messages, preserves zero cache values, and calculates estimated cost', () => {
    const usage: TokenUsage = {
      inputTokens: 2_000,
      outputTokens: 500,
      totalTokens: 2_500,
      cacheReadTokens: 1_000,
      cacheWriteTokens: 0,
    };

    const view = buildContextInspectorViewModel(
      makeInput({ liveUsage: usage, pendingToolCallCount: 2 }),
    );

    expect(view.messages).toEqual({ total: 2, user: 1, assistant: 1, toolCalls: 2 });
    expect(view.latestTurn.cacheWriteTokens).toBe(0);
    expect(view.latestTurn.cacheHitRate).toBeNull();
    expect(view.latestTurn.costUsd).toBeCloseTo(0.011);
    expect(view.latestTurn.costEstimated).toBe(true);
    expect(view.contextUsage).toEqual({
      tokens: 2_000,
      percentage: 2_000 / 128_000,
      source: 'usage',
    });
  });

  it('selects the latest main trace and parses its real context snapshot', () => {
    const mainTrace = makeTrace({
      id: 'main-trace',
      duration_ms: 250,
      token_cache_measured_read: 300,
      token_cache_measured: 600,
      iterations: JSON.stringify([
        {
          number: 1,
          durationMs: 250,
          toolCalls: [{ name: 'read_file' }, { name: 'git_status' }],
          context: {
            toolCount: 3,
            tokenBreakdown: {
              system: 200,
              tools: 300,
              currentTurn: 400,
              activeToolFrame: 0,
              recentHistory: 600,
              explicit: 0,
              memory: 0,
              environment: 0,
              automatic: 0,
              total: 1_500,
              dropped: 25,
              deduplicated: 10,
            },
            entries: [
              { id: 'system', category: 'system', tokens: 200, included: true },
              { id: 'duplicate', category: 'recentHistory', tokens: 10, included: false, reason: 'duplicate' },
            ],
          },
        },
      ]),
    });
    const childTrace = makeTrace({ id: 'child-trace', parent_turn_id: 'main-trace' });

    expect(selectLatestMainTrace([childTrace, mainTrace])?.id).toBe('main-trace');
    expect(parseTraceIterations(mainTrace.iterations)[0].context?.tokenBreakdown.total).toBe(1_500);

    const view = buildContextInspectorViewModel(makeInput({ traces: [childTrace, mainTrace] }));
    expect(view.latestTurn.source).toBe('trace');
    expect(view.latestTurn.durationMs).toBe(250);
    expect(view.latestTurn.requestCount).toBe(1);
    expect(view.latestTurn.cacheHitRate).toBe(0.5);
    expect(view.contextComposition.breakdown?.dropped).toBe(25);
    expect(view.contextComposition.entries).toHaveLength(2);
    expect(view.contextComposition.toolCount).toBe(3);
  });

  it('does not fabricate percentage, cost, or reasoning when metadata is unavailable', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    };
    const view = buildContextInspectorViewModel(
      makeInput({ model: null, contextWindow: null, providerName: null, liveUsage: usage }),
    );

    expect(view.contextUsage.percentage).toBeNull();
    expect(view.latestTurn.costUsd).toBeNull();
    expect(view.latestTurn.reasoningTokens).toBeNull();
    expect(formatTokenCount(null)).toBe('Not available');
    expect(formatCost(null)).toBe('Not available');
  });
});

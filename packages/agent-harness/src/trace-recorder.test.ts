import { describe, expect, it } from 'vitest';
import type { TokenUsage } from '@hyscode/ai-providers';

import { TraceRecorder, analyzeTraces, type Trace } from './trace-recorder';
import type { ToolCallRecord } from './types';

function toolCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: 'call_1',
    toolName: 'read_file',
    input: { path: 'a.ts' },
    output: { success: true, output: 'x' },
    durationMs: 10,
    approved: true,
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function failedToolCall(toolName: string, error: string): ToolCallRecord {
  return toolCall({ toolName, output: { success: false, output: '', error } });
}

const tokenUsage: TokenUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };

describe('TraceRecorder', () => {
  it('records a full turn lifecycle and finalizes a complete trace', () => {
    const recorder = new TraceRecorder();
    expect(recorder.isRecording()).toBe(false);

    recorder.startTrace('conv-1', 'build', 'anthropic', 'claude-3-5');
    expect(recorder.isRecording()).toBe(true);
    recorder.recordSystemPrompt('You are a coding agent.', 12);
    recorder.startIteration(1);
    recorder.recordToolCall(toolCall({ toolName: 'read_file', durationMs: 5 }));
    recorder.recordToolCall(failedToolCall('edit_file', 'denied'));
    recorder.setHadToolCalls(true);
    recorder.recordMiddlewareInjection('verification');
    recorder.recordRepeatedCall();
    recorder.recordLoopWarning('a.ts', 3);
    recorder.recordError('edit failed', 'edit_file');
    recorder.endIteration();

    const trace = recorder.finalizeTrace('complete', tokenUsage, ['a.ts'], true, false);
    expect(trace).not.toBeNull();
    expect(trace).toMatchObject({
      conversationId: 'conv-1',
      mode: 'build',
      provider: 'anthropic',
      model: 'claude-3-5',
      systemPromptHash: expect.any(String),
      systemPromptPreview: 'You are a coding agent.',
      systemPromptTokens: expect.any(Number),
      toolCount: 12,
      stopReason: 'complete',
      verificationPerformed: true,
      filesModified: ['a.ts'],
    });
    expect(trace!.iterations).toHaveLength(1);
    expect(trace!.iterations[0].toolCalls).toHaveLength(2);
    expect(trace!.iterations[0].toolCalls[1]).toMatchObject({
      name: 'edit_file',
      success: false,
      error: 'denied',
    });
    expect(trace!.errors).toEqual([
      { iteration: 1, message: 'denied', toolName: 'edit_file' },
      { iteration: 1, message: 'edit failed', toolName: 'edit_file' },
    ]);
    expect(trace!.loopWarnings).toEqual([{ iteration: 1, filePath: 'a.ts', editCount: 3 }]);
    expect(recorder.isRecording()).toBe(false);
  });

  it('returns null when finalizing without an active trace', () => {
    const recorder = new TraceRecorder();
    expect(recorder.finalizeTrace('complete', tokenUsage, [])).toBeNull();
  });

  it('ignores tool calls and iterations without an active trace', () => {
    const recorder = new TraceRecorder();
    recorder.startIteration(1);
    recorder.recordToolCall(toolCall());
    recorder.recordMiddlewareInjection('x');
    recorder.recordRepeatedCall();
    recorder.recordError('boom');
    recorder.recordLoopWarning('f.ts', 1);
    recorder.endIteration();
    recorder.setHadToolCalls(true);
    expect(recorder.finalizeTrace('error', tokenUsage, [])).toBeNull();
  });

  it('records context snapshots and prepared requests when provided', () => {
    const recorder = new TraceRecorder();
    recorder.startTrace('conv-2', 'debug', 'openai', 'gpt-4o');
    recorder.startIteration(1);
    recorder.recordContextSnapshot(
      { tokenBreakdown: { system: 10, user: 20, tool: 30 } } as never,
      [],
      5,
    );
    recorder.recordPreparedRequest(
      { inputTokens: 1, outputTokens: 2 } as never,
      'h1',
      ['cache'],
      [],
    );
    recorder.endIteration();
    const trace = recorder.finalizeTrace('complete', tokenUsage, []);
    expect(trace!.iterations[0].context).toBeDefined();
    expect(trace!.iterations[0].request).toMatchObject({ stablePrefixHash: 'h1' });
  });
});

describe('analyzeTraces', () => {
  function trace(overrides: Partial<Trace> = {}): Trace {
    return {
      id: 't1',
      conversationId: 'c1',
      mode: 'build',
      provider: 'anthropic',
      model: 'm',
      systemPromptHash: 'h',
      systemPromptPreview: 'p',
      systemPromptTokens: 10,
      toolCount: 3,
      iterations: [],
      tokenUsage,
      stopReason: 'complete',
      verificationPerformed: false,
      verificationForced: false,
      filesModified: [],
      errors: [],
      loopWarnings: [],
      durationMs: 1000,
      timestamp: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  it('returns an empty summary for no traces', () => {
    const summary = analyzeTraces([]);
    expect(summary.totalTraces).toBe(0);
    expect(summary.timeRange).toEqual({ from: '', to: '' });
  });

  it('computes success rate, averages, tool usage and failures', () => {
    const traces = [
      trace({
        iterations: [
          {
            number: 1,
            startMs: 0,
            durationMs: 100,
            toolCalls: [
              { name: 'run_terminal_command', durationMs: 50, success: true },
              { name: 'read_file', durationMs: 10, success: true },
            ],
            hadToolCalls: true,
            middlewareInjections: [],
            wasRepeatedCall: false,
          },
        ],
      }),
      trace({
        id: 't2',
        stopReason: 'error',
        durationMs: 2000,
        tokenUsage: { inputTokens: 300, outputTokens: 150, totalTokens: 450 },
        errors: [{ iteration: 1, message: 'Exit code: 1' }],
        filesModified: ['a.ts'],
        verificationForced: true,
        iterations: [
          {
            number: 1,
            startMs: 0,
            durationMs: 100,
            toolCalls: [{ name: 'run_terminal_command', durationMs: 50, success: false, error: 'boom' }],
            hadToolCalls: true,
            middlewareInjections: [],
            wasRepeatedCall: false,
          },
        ],
      }),
    ];

    const summary = analyzeTraces(traces);
    expect(summary.totalTraces).toBe(2);
    expect(summary.successRate).toBe(0.5);
    expect(summary.avgIterations).toBe(1);
    expect(summary.avgDurationMs).toBe(1500);
    expect(summary.avgTokensPerTurn).toEqual({ input: 200, output: 100 });
    expect(summary.topFailingTools).toEqual([
      { toolName: 'run_terminal_command', failCount: 1, totalCalls: 2 },
    ]);
    expect(summary.toolUsage[0]).toMatchObject({ toolName: 'run_terminal_command', count: 2 });
    expect(summary.errorCount).toBe(1);
    expect(summary.topErrors).toEqual([{ message: 'Exit code: 1', count: 1 }]);
    expect(summary.topModifiedFiles).toEqual([{ path: 'a.ts', count: 1 }]);
    expect(summary.verificationForcedCount).toBe(1);
  });

  it('counts max iteration hits and loop warnings', () => {
    const summary = analyzeTraces([
      trace({ stopReason: 'max_iterations', loopWarnings: [{ iteration: 1, filePath: 'a.ts', editCount: 2 }] }),
      trace({ id: 't2', stopReason: 'loop_detected', loopWarnings: [{ iteration: 1, filePath: 'b.ts', editCount: 5 }] }),
    ]);
    expect(summary.maxIterationHits).toBe(1);
    expect(summary.loopWarningCount).toBe(2);
  });
});

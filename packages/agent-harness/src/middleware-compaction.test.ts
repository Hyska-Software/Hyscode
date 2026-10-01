import { describe, expect, it } from 'vitest';
import {
  compactToolOutput,
  compactSpawnOutput,
  spawnTaskSimilarity,
  LoopDetectionMiddleware,
  type MiddlewareContext,
} from './middleware';

describe('compactToolOutput', () => {
  it('keeps terminal diagnostics and omits noise', () => {
    const output = `${Array.from({ length: 800 }, (_, index) => `progress ${index}`).join('\n')}\nERROR: build failed\nexit code 1`;
    const compacted = compactToolOutput(output, 'run_terminal_command');
    expect(compacted).toContain('ERROR: build failed');
    expect(compacted).toContain('exit code 1');
    expect(compacted.length).toBeLessThan(output.length);
  });

  it('directs large file reads to ranged retrieval', () => {
    const output = Array.from(
      { length: 800 },
      (_, index) => `${index + 1}: line with enough content to exceed the compaction threshold`,
    ).join('\n');
    const compacted = compactToolOutput(output, 'read_file');
    expect(compacted).toContain('line_start/line_end');
    expect(compacted).toContain('1: line');
    expect(compacted).toContain('800: line');
  });

  it('keeps sub-agent results wide and never promises re-reads', () => {
    const output = `conclusion\n${'detail line\n'.repeat(3000)}final note`;
    expect(output.length).toBeGreaterThan(24_000);
    const compacted = compactToolOutput(output, 'spawn_subagent');
    expect(compacted).toContain('conclusion');
    expect(compacted).toContain('final note');
    expect(compacted).toContain('cannot be re-fetched');
    expect(compacted).not.toContain('re-run the command');
    expect(compacted.length).toBeLessThan(output.length);
  });

  it('routes invoke_external_tool spawn output through the spawn budget', () => {
    const output = `head\n${'x'.repeat(30_000)}\ntail`;
    const compacted = compactToolOutput(output, 'invoke_external_tool');
    expect(compacted).toContain('cannot be re-fetched');
    expect(compactSpawnOutput('short', 'spawn_subagent')).toBe('short');
  });
});

describe('spawnTaskSimilarity', () => {
  it('scores near-identical analyses high and different tasks low', () => {
    const a = 'You are doing a READ-ONLY analysis of the HysCode monorepo at D:/Hyscode';
    const b = 'You are doing a READ-ONLY analysis of the Hyscode monorepo at D:/Hyscode project';
    expect(spawnTaskSimilarity(a, b)).toBeGreaterThanOrEqual(0.7);
    expect(spawnTaskSimilarity(a, 'Fix the login redirect bug in auth flow')).toBeLessThan(0.3);
  });

  it('scores empty tasks as zero, never warning on missing input', () => {
    expect(spawnTaskSimilarity('', 'analyze the project')).toBe(0);
    expect(spawnTaskSimilarity('', '')).toBe(0);
  });
});

describe('LoopDetectionMiddleware spawn loop', () => {
  const record = (task: string, mode = 'review') => ({
    id: 'call',
    toolName: 'spawn_subagent',
    input: { task, mode },
    output: { success: true, output: 'ok' },
    durationMs: 1,
    approved: true,
    timestamp: new Date().toISOString(),
  });
  const ctx: MiddlewareContext = {
    mode: 'build',
    iteration: 1,
    maxIterations: 10,
    toolCallHistory: [],
    assistantText: '',
    conversationId: 'c',
    workspacePath: 'w',
  };

  it('stays silent on the first spawn and on unrelated tasks', () => {
    const middleware = new LoopDetectionMiddleware();
    expect(
      middleware.afterTool('spawn_subagent', record('Analyze the HysCode monorepo'), ctx),
    ).toBeNull();
    expect(
      middleware.afterTool('spawn_subagent', record('Fix the login redirect bug'), ctx),
    ).toBeNull();
  });

  it('warns on a repeated similar analysis and escalates on the third', () => {
    const middleware = new LoopDetectionMiddleware();
    const task = 'You are doing a READ-ONLY analysis of the HysCode monorepo at D:/Hyscode';
    expect(middleware.afterTool('spawn_subagent', record(task), ctx)).toBeNull();
    const first = middleware.afterTool('spawn_subagent', record(`${task} structure`), ctx);
    expect(first).toContain('spawn_warning');
    expect(first).toContain('use it instead of spawning again');
    const second = middleware.afterTool('spawn_subagent', record(`${task} architecture`), ctx);
    expect(second).toContain('Do NOT spawn another sub-agent');
  });

  it('ignores different modes and resets per turn', () => {
    const middleware = new LoopDetectionMiddleware();
    const task = 'Analyze the HysCode monorepo structure';
    expect(middleware.afterTool('spawn_subagent', record(task, 'review'), ctx)).toBeNull();
    expect(middleware.afterTool('spawn_subagent', record(task, 'build'), ctx)).toBeNull();
    middleware.resetCounts();
    expect(middleware.afterTool('spawn_subagent', record(task, 'review'), ctx)).toBeNull();
  });
});

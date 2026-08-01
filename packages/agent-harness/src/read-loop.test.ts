import { describe, expect, it } from 'vitest';
import { ReadLoopMiddleware } from './read-loop';
import type { MiddlewareContext } from './middleware';
import type { ToolCallRecord } from './types';

const context: MiddlewareContext = {
  mode: 'review',
  iteration: 1,
  maxIterations: 20,
  toolCallHistory: [],
  assistantText: '',
  conversationId: 'conversation',
};

function readRecord(input: Record<string, unknown>, success = true): ToolCallRecord {
  return {
    id: crypto.randomUUID(),
    toolName: 'read_file',
    input,
    output: success
      ? { success: true, output: 'content' }
      : { success: false, output: '', error: 'read failed' },
    durationMs: 1,
    approved: true,
    timestamp: new Date().toISOString(),
  };
}

describe('ReadLoopMiddleware', () => {
  it('allows multiple non-overlapping ranges from the same file', () => {
    const guard = new ReadLoopMiddleware('C:/workspace');

    expect(guard.afterTool('read_file', readRecord({ path: 'src/file.rs', start_line: 1, end_line: 100 }), context)).toBeNull();
    expect(guard.afterTool('read_file', readRecord({ path: 'src/file.rs', start_line: 101, end_line: 200 }), context)).toBeNull();
    expect(guard.afterTool('read_file', readRecord({ path: 'C:/workspace/src/file.rs', start_line: 201, end_line: 300 }), context)).toBeNull();
    expect(guard.afterTool('read_file', readRecord({ path: 'src/file.rs', start_line: 301, end_line: 400 }), context)).toBeNull();
  });

  it('warns on repeated overlapping successful reads without cancelling', () => {
    const guard = new ReadLoopMiddleware('C:/workspace');
    const input = { path: 'src/file.rs', start_line: 10, end_line: 30 };

    expect(guard.afterTool('read_file', readRecord(input), context)).toBeNull();
    expect(guard.afterTool('read_file', readRecord(input), context)).toBeNull();
    expect(guard.afterTool('read_file', readRecord(input), context)).toContain('Read-loop warning');
  });

  it('does not consume the duplicate budget for failed reads or gather_context', () => {
    const guard = new ReadLoopMiddleware('C:/workspace');
    const input = { path: 'src/file.rs', start_line: 1, end_line: 20 };

    expect(guard.afterTool('read_file', readRecord(input, false), context)).toBeNull();
    expect(
      guard.afterTool(
        'gather_context',
        { ...readRecord(input), toolName: 'gather_context' },
        context,
      ),
    ).toBeNull();
    expect(guard.afterTool('read_file', readRecord(input), context)).toBeNull();
    expect(guard.afterTool('read_file', readRecord(input), context)).toBeNull();
    expect(guard.afterTool('read_file', readRecord(input), context)).toContain('Read-loop warning');
  });

  it('uses only successful paths from read_multiple_files metadata', () => {
    const guard = new ReadLoopMiddleware('C:/workspace');
    const record: ToolCallRecord = {
      ...readRecord({ paths: ['src/ok.rs', 'src/missing.rs'] }),
      toolName: 'read_multiple_files',
      output: {
        success: true,
        output: 'files',
        metadata: { successfulPaths: ['src/ok.rs'], failedPaths: ['src/missing.rs'] },
      },
    };

    expect(guard.afterTool('read_multiple_files', record, context)).toBeNull();
    expect(guard.afterTool('read_file', readRecord({ path: 'src/missing.rs' }), context)).toBeNull();
  });
});

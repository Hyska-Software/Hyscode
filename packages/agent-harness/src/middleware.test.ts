import { describe, expect, it } from 'vitest';
import { AutoGatherMiddleware, type MiddlewareContext } from './middleware';
import type { ToolCallRecord } from './types';

describe('AutoGatherMiddleware', () => {
  it('keeps review reads in gathered context', () => {
    const gathered: string[] = [];
    const middleware = new AutoGatherMiddleware();
    middleware.setGatheredContext({
      add: (path) => {
        gathered.push(`add:${path}`);
        return 10;
      },
      append: (path) => {
        gathered.push(`append:${path}`);
        return 10;
      },
      remove: () => false,
      has: () => false,
      getTokens: () => 10,
    });

    const context: MiddlewareContext = {
      mode: 'review',
      iteration: 1,
      maxIterations: 10,
      toolCallHistory: [],
      assistantText: '',
      conversationId: 'conversation',
      workspacePath: 'C:/workspace',
    };
    const record: ToolCallRecord = {
      id: 'read-1',
      toolName: 'read_file',
      input: { path: 'src/review.ts' },
      output: { success: true, output: '1 | export const review = true;' },
      durationMs: 1,
      approved: true,
      timestamp: new Date().toISOString(),
    };

    middleware.afterTool('read_file', record, context);

    expect(gathered).toEqual(['add:c:/workspace/src/review.ts']);
  });
});

import { describe, expect, it } from 'vitest';
import { gatherContextTool, readFileTool } from './tools';
import type { ToolExecutionContext } from './types';

describe('read context cache', () => {
  it('lets gather_context reuse the latest raw file read', async () => {
    const cache = new Map<string, string>();
    const gathered: string[] = [];
    let readCalls = 0;
    const context: ToolExecutionContext = {
      workspacePath: 'C:/workspace',
      conversationId: 'conversation',
      toolCallId: 'read',
      signal: new AbortController().signal,
      invoke: async <T>(command: string) => {
        if (command === 'read_file') {
          readCalls += 1;
          return 'export const value = true;' as T;
        }
        return undefined as T;
      },
      readCache: {
        get: (path) => cache.get(path),
        set: (path, content) => cache.set(path, content),
        delete: (path) => cache.delete(path),
      },
      gatheredContext: {
        add: (path) => {
          gathered.push(path);
          return 8;
        },
        append: (path) => {
          gathered.push(path);
          return 8;
        },
        remove: () => false,
        has: () => false,
        getAll: () => [],
        getTokens: () => 8,
        clear: () => undefined,
      },
    };

    const readResult = await readFileTool.execute({ path: 'src/value.ts' }, context);
    const gatherResult = await gatherContextTool.execute(
      { path: 'src/value.ts', relevance: 0.8, reason: 'keep it available' },
      context,
    );

    expect(readResult.success).toBe(true);
    expect(gatherResult.success).toBe(true);
    expect(readCalls).toBe(1);
    expect(gathered).toEqual(['c:/workspace/src/value.ts']);
  });
});

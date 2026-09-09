import { describe, expect, it, vi } from 'vitest';
import { ToolRouter, normalizeToolInput, parseToolCallInput } from './tool-router';
import type { ToolExecutionContext, ToolHandler } from './types';

const handler: ToolHandler = {
  definition: {
    name: 'write_value',
    description: 'test tool',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
  },
  category: 'filesystem',
  requiresApproval: false,
  execute: vi.fn(async (input) => ({ success: true, output: String(input.value) })),
};

function context(signal: AbortSignal): ToolExecutionContext {
  return {
    workspacePath: 'C:/workspace',
    conversationId: 'conversation',
    toolCallId: 'call',
    signal,
    invoke: vi.fn(),
  };
}

describe('ToolRouter', () => {
  it('rejects malformed input before execution and still emits a result', async () => {
    const router = new ToolRouter();
    router.register(handler);
    const events: string[] = [];
    router.setEventHandler((event) => events.push(event.type));
    const record = await router.execute(
      'write_value',
      'call',
      {},
      context(new AbortController().signal),
    );
    expect(record.output.success).toBe(false);
    expect(record.output.error).toContain('missing required field');
    expect(handler.execute).not.toHaveBeenCalled();
    expect(events).toEqual(['tool_call_start', 'tool_call_result']);
  });

  it('does not execute a tool after turn cancellation', async () => {
    const router = new ToolRouter();
    router.register(handler);
    const controller = new AbortController();
    controller.abort();
    const record = await router.execute(
      'write_value',
      'cancelled-call',
      { value: 'x' },
      context(controller.signal),
    );
    expect(record.output.error).toContain('cancelled');
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it('waits for an uncancellable native operation and reports partial cancellation', async () => {
    const router = new ToolRouter();
    let settle: ((result: { success: boolean; output: string }) => void) | undefined;
    router.register({
      ...handler,
      execute: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    });
    const controller = new AbortController();
    const execution = router.execute(
      'write_value',
      'running-call',
      { value: 'x' },
      context(controller.signal),
    );
    controller.abort();
    settle?.({ success: true, output: 'written' });
    await expect(execution).resolves.toMatchObject({
      output: {
        success: false,
        metadata: { cancellationPartial: true, operationCompleted: true },
      },
    });
  });

  it('suggests the closest tool when the model calls an unknown name', async () => {
    const router = new ToolRouter();
    router.register(handler);
    router.register({
      definition: {
        name: 'search_code',
        description: 'search code',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      category: 'filesystem',
      requiresApproval: false,
      execute: vi.fn(async () => ({ success: true, output: 'ok' })),
    });
    const record = await router.execute(
      'grep_search',
      'call',
      {},
      context(new AbortController().signal),
    );
    expect(record.output.success).toBe(false);
    expect(record.output.error).toContain('Unknown tool: grep_search');
    expect(record.output.error).toContain('search_code');
  });

  it('coerces weak-model typings and resolves camelCase aliases', async () => {
    const router = new ToolRouter();
    const execute = vi.fn(async (input: Record<string, unknown>) => ({
      success: true,
      output: `${String(input.path)}:${String(input.start_line)}:${String(input.replace_all)}`,
    }));
    router.register({
      definition: {
        name: 'edit_file',
        description: 'test edit',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            start_line: { type: 'integer' },
            replace_all: { type: 'boolean' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
      category: 'filesystem',
      requiresApproval: false,
      execute,
    });
    const record = await router.execute(
      'edit_file',
      'call',
      {
        filePath: 'src/a.ts',
        oldString: 'const a = 1;',
        newString: 'const a = 2;',
        start_line: '10',
        replace_all: 'true',
      },
      context(new AbortController().signal),
    );
    expect(record.output.success).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'src/a.ts',
        old_string: 'const a = 1;',
        new_string: 'const a = 2;',
        start_line: 10,
        replace_all: true,
      }),
      expect.anything(),
    );
  });

  it('reports received keys when a required field is missing', async () => {
    const router = new ToolRouter();
    router.register({
      definition: {
        name: 'create_file',
        description: 'test create',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path'],
        },
      },
      category: 'filesystem',
      requiresApproval: false,
      execute: vi.fn(async () => ({ success: true, output: 'ok' })),
    });
    const record = await router.execute(
      'create_file',
      'call',
      {},
      context(new AbortController().signal),
    );
    expect(record.output.success).toBe(false);
    expect(record.output.error).toContain('missing required field "path"');
    expect(record.output.error).toContain('Received keys: [(none)]');
  });

  it('prefers the canonical path over the file alias', async () => {
    const router = new ToolRouter();
    const execute = vi.fn(async (input: Record<string, unknown>) => ({
      success: true,
      output: String(input.path),
    }));
    router.register({
      definition: {
        name: 'create_file',
        description: 'test create',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path'],
        },
      },
      category: 'filesystem',
      requiresApproval: false,
      execute,
    });
    const record = await router.execute(
      'create_file',
      'call',
      { path: 'n.ts', file: 'ignored.ts' },
      context(new AbortController().signal),
    );
    expect(record.output.success).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'n.ts' }),
      expect.anything(),
    );
  });
});

describe('normalizeToolInput', () => {
  const schema = {
    type: 'object',
    properties: {
      path: { type: 'string' },
      count: { type: 'integer' },
      flag: { type: 'boolean' },
    },
    required: ['path'],
  };

  it('maps file_path to path and coerces numerics/booleans', () => {
    expect(normalizeToolInput(schema, { file_path: 'a.ts', count: '3', flag: 'false' })).toEqual({
      file_path: 'a.ts',
      count: 3,
      flag: false,
      path: 'a.ts',
    });
  });

  it('does not mutate the original input', () => {
    const input = { file_path: 'a.ts' };
    normalizeToolInput(schema, input);
    expect(input).toEqual({ file_path: 'a.ts' });
  });

  it('maps bare file to path and new_content to content', () => {
    const fileSchema = {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path'],
    };
    expect(normalizeToolInput(fileSchema, { file: 'a.ts', new_content: 'hi' })).toEqual(
      expect.objectContaining({ path: 'a.ts', content: 'hi' }),
    );
    expect(normalizeToolInput(fileSchema, { path: 'b.ts', file: 'a.ts' })).toEqual(
      expect.objectContaining({ path: 'b.ts' }),
    );
  });
});

describe('parseToolCallInput', () => {
  it('parses valid JSON as-is', () => {
    expect(parseToolCallInput('{"path":"a.ts"}')).toEqual({ path: 'a.ts' });
  });

  it('repairs trailing commas', () => {
    expect(parseToolCallInput('{"path":"a.ts",}')).toEqual({ path: 'a.ts' });
  });

  it('repairs raw newlines inside strings', () => {
    expect(parseToolCallInput('{"text":"line1\nline2"}')).toEqual({ text: 'line1\nline2' });
  });

  it('throws the original error when unrepairable', () => {
    expect(() => parseToolCallInput('{not json')).toThrow();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ToolRouter, normalizeToolInput, parseToolCallInput, timeoutForTool } from './tool-router';
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

function context(
  signal: AbortSignal,
  allowedToolNames: string[] = ['write_value', 'search_code', 'create_file', 'edit_file'],
  invoke: ToolExecutionContext['invoke'] = vi.fn(),
): ToolExecutionContext {
  return {
    workspacePath: 'C:/workspace',
    conversationId: 'conversation',
    policyAllowedToolNames: new Set(allowedToolNames),
    toolCallId: 'call',
    signal,
    invoke,
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

  it('rejects a registered tool that is absent from the effective policy', async () => {
    const router = new ToolRouter();
    const execute = vi.fn(async () => ({ success: true, output: 'should not run' }));
    router.register({ ...handler, execute });

    const record = await router.execute(
      'write_value',
      'filtered-call',
      { value: 'x' },
      context(new AbortController().signal, []),
    );

    expect(record.output).toMatchObject({
      success: false,
      error: 'Tool "write_value" is not allowed by the active agent policy.',
    });
    expect(record.approved).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows execution when no policy allow-list is attached (legacy callers)', async () => {
    const router = new ToolRouter();
    const execute = vi.fn(async () => ({ success: true, output: 'ran' }));
    router.register({ ...handler, execute });
    const legacyContext: ToolExecutionContext = {
      workspacePath: 'C:/workspace',
      conversationId: 'conversation',
      toolCallId: 'call',
      signal: new AbortController().signal,
      invoke: vi.fn(),
    };

    const record = await router.execute(
      'write_value',
      'legacy-call',
      { value: 'x' },
      legacyContext,
    );

    expect(record.output.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed when an approval-required tool has no approval callback', async () => {
    const router = new ToolRouter();
    const execute = vi.fn(async () => ({ success: true, output: 'should not run' }));
    router.register({ ...handler, requiresApproval: true, execute });

    const record = await router.execute(
      'write_value',
      'approval-call',
      { value: 'x' },
      context(new AbortController().signal),
    );

    expect(record.output).toMatchObject({ success: false });
    expect(record.output.error).toContain('rejected');
    expect(record.approved).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires explicit approval for project-controlled diagnostics even in yolo mode', async () => {
    const router = new ToolRouter();
    router.setApprovalConfig({ mode: 'yolo' });
    const execute = vi.fn(async () => ({ success: true, output: 'diagnostics ran' }));
    router.register({
      ...handler,
      definition: { ...handler.definition, name: 'get_diagnostics' },
      requiresApproval: false,
      requiresExplicitApproval: true,
      execute,
    });
    const approval = vi.fn(async () => true);
    router.setApprovalCallback(approval);

    const record = await router.execute(
      'get_diagnostics',
      'diagnostics-call',
      { value: 'inspect' },
      context(new AbortController().signal, ['get_diagnostics']),
    );

    expect(approval).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(record.output.success).toBe(true);
  });

  it('allows explicitly session-trusted project diagnostics without another prompt', async () => {
    const router = new ToolRouter();
    router.setApprovalConfig({ mode: 'yolo' });
    const execute = vi.fn(async () => ({ success: true, output: 'diagnostics ran' }));
    router.register({
      ...handler,
      definition: { ...handler.definition, name: 'get_diagnostics' },
      requiresApproval: false,
      requiresExplicitApproval: true,
      execute,
    });
    const approval = vi.fn(async () => true);
    router.setApprovalCallback(approval);
    router.trustToolForSession('get_diagnostics');

    const record = await router.execute(
      'get_diagnostics',
      'diagnostics-call',
      { value: 'inspect' },
      context(new AbortController().signal, ['get_diagnostics']),
    );

    expect(approval).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(record.output.success).toBe(true);
  });

  it('blocks direct invoke calls that escape the owning workspace', async () => {
    const router = new ToolRouter();
    const nativeInvoke = vi.fn(
      async () => 'must not be called',
    ) as unknown as ToolExecutionContext['invoke'];
    router.register({
      ...handler,
      execute: async (_input, executionContext) => {
        try {
          await executionContext.invoke('write_file', {
            path: '../outside.txt',
            content: 'blocked',
          });
          return { success: true, output: 'unexpected invoke success' };
        } catch (error) {
          return { success: false, output: '', error: String(error) };
        }
      },
    });

    const record = await router.execute(
      'write_value',
      'direct-invoke-call',
      { value: 'x' },
      context(new AbortController().signal, ['write_value'], nativeInvoke),
    );

    expect(record.output.success).toBe(false);
    expect(record.output.error).toContain('outside the workspace');
    expect(nativeInvoke).not.toHaveBeenCalled();
  });

  it('normalizes in-workspace direct invoke paths before native dispatch', async () => {
    const router = new ToolRouter();
    const nativeInvoke = vi.fn(
      async () => 'read result',
    ) as unknown as ToolExecutionContext['invoke'];
    router.register({
      ...handler,
      execute: async (_input, executionContext) => ({
        success: true,
        output: await executionContext.invoke<string>('read_file', { path: 'src/value.ts' }),
      }),
    });

    const record = await router.execute(
      'write_value',
      'workspace-invoke-call',
      { value: 'x' },
      context(new AbortController().signal, ['write_value'], nativeInvoke),
    );

    expect(record.output.success).toBe(true);
    expect(nativeInvoke).toHaveBeenCalledWith(
      'read_file',
      { path: 'c:/workspace/src/value.ts' },
      { workspacePath: 'C:/workspace', externalPathAccess: undefined },
    );
  });

  it('cancels promptly when abort fires before the native operation settles', async () => {
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
        error: expect.stringMatching(/cancel/i),
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

describe('timeoutForTool', () => {
  it('gives spawn_subagent and invoke_external_tool a child-loop budget, not the 60s default', () => {
    expect(timeoutForTool('spawn_subagent')).toBe(600_000);
    expect(timeoutForTool('invoke_external_tool')).toBe(600_000);
    expect(timeoutForTool('SPAWN_SUBAGENT')).toBe(600_000);
  });

  it('keeps the existing budgets for other tools', () => {
    expect(timeoutForTool('write_file', 'filesystem')).toBe(15_000);
    expect(timeoutForTool('run_terminal_command')).toBe(30_000);
    expect(timeoutForTool('mcp__server__tool')).toBe(30_000);
    expect(timeoutForTool('search_code')).toBe(60_000);
  });
});

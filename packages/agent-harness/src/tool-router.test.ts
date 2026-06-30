import { describe, expect, it, vi } from 'vitest';
import { ToolRouter } from './tool-router';
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
    const record = await router.execute('write_value', 'call', {}, context(new AbortController().signal));
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

  it('returns cancellation without waiting for a running tool to settle', async () => {
    const router = new ToolRouter();
    router.register({
      ...handler,
      execute: () => new Promise(() => undefined),
    });
    const controller = new AbortController();
    const execution = router.execute('write_value', 'running-call', { value: 'x' }, context(controller.signal));
    controller.abort();
    await expect(execution).resolves.toMatchObject({
      output: { success: false, error: 'Tool call cancelled.' },
    });
  });
});

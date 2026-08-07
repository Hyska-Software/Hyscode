import { describe, expect, it, vi } from 'vitest';
import { ExternalPathAccessRegistry } from './external-path-access';
import { Harness } from './harness';
import { ToolRouter } from './tool-router';
import { readFileTool, runTerminalCommandTool, writeFileTool } from './tools';
import type { ToolExecutionContext, ToolHandler } from './types';

const workspacePath = 'C:/workspace';

function context(
  invoke: ToolExecutionContext['invoke'],
  signal = new AbortController().signal,
): ToolExecutionContext {
  return {
    workspacePath,
    conversationId: 'conversation',
    toolCallId: 'call',
    signal,
    invoke,
  };
}

describe('ExternalPathAccessRegistry', () => {
  it('keeps grants operation-specific and matches directory boundaries', () => {
    const registry = new ExternalPathAccessRegistry();
    const request = registry.inspect(
      { operation: 'read', fields: [{ key: 'path', kind: 'target' }] },
      { path: 'C:/external/project/file.ts' },
      workspacePath,
    );

    expect(request).toEqual({
      operation: 'read',
      paths: ['c:/external/project/file.ts'],
      directories: ['c:/external/project'],
      directoryScopes: [],
    });
    expect(request && registry.isCovered(request)).toBe(false);

    registry.grant(request!, 'session-directory');
    expect(
      registry.isCovered(
        registry.inspect(
          { operation: 'read', fields: [{ key: 'path', kind: 'target' }] },
          { path: 'C:/external/project/nested/file.ts' },
          workspacePath,
        )!,
      ),
    ).toBe(true);
    expect(
      registry.isCovered(
        registry.inspect(
          { operation: 'read', fields: [{ key: 'path', kind: 'target' }] },
          { path: 'C:/external/project-other/file.ts' },
          workspacePath,
        )!,
      ),
    ).toBe(false);
    expect(
      registry.isCovered(
        registry.inspect(
          { operation: 'write', fields: [{ key: 'path', kind: 'target' }] },
          { path: 'C:/external/project/file.ts' },
          workspacePath,
        )!,
      ),
    ).toBe(false);
  });

  it('keeps descendants covered when a session grant targets a filesystem root', () => {
    const registry = new ExternalPathAccessRegistry();
    const request = registry.inspect(
      { operation: 'read', fields: [{ key: 'path', kind: 'directory' }] },
      { path: 'C:/' },
      workspacePath,
    )!;

    registry.grant(request, 'session-directory');

    expect(
      registry.isCovered(
        registry.inspect(
          { operation: 'read', fields: [{ key: 'path', kind: 'target' }] },
          { path: 'C:/external/file.ts' },
          workspacePath,
        )!,
      ),
    ).toBe(true);
  });

  it('does not accept relative traversal as an external authorization request', () => {
    const registry = new ExternalPathAccessRegistry();
    expect(() =>
      registry.inspect(
        { operation: 'read', fields: [{ key: 'path', kind: 'target' }] },
        { path: '../outside/file.ts' },
        workspacePath,
      ),
    ).toThrow('outside the workspace');
  });

  it('limits a one-call file grant to the requested path', () => {
    const registry = new ExternalPathAccessRegistry();
    const request = registry.inspect(
      { operation: 'read', fields: [{ key: 'path', kind: 'target' }] },
      { path: 'C:/external/file.ts' },
      workspacePath,
    )!;
    const access = registry.createAccess(request, workspacePath);

    expect(access.resolve('C:/external/file.ts')).toBe('c:/external/file.ts');
    expect(() => access.resolve('C:/external/another.ts')).toThrow('not approved');
  });
});

describe('ToolRouter external path approval', () => {
  it('prompts for an external read even in yolo mode and executes only after approval', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'read_file') return 'external content' as never;
      return undefined as never;
    });
    const router = new ToolRouter();
    router.register(readFileTool);
    router.setApprovalConfig({ mode: 'yolo' });
    const approvals: unknown[] = [];
    router.setApprovalCallback(async (pending) => {
      approvals.push(pending.externalAccess);
      expect(invoke).not.toHaveBeenCalled();
      return { approved: true, externalGrant: 'once' };
    });

    const record = await router.execute(
      'read_file',
      'read-1',
      { path: 'C:/external/file.ts' },
      context(invoke),
    );

    expect(record.output).toMatchObject({ success: true, output: expect.stringContaining('external content') });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toEqual({
      operation: 'read',
      paths: ['c:/external/file.ts'],
      directories: ['c:/external'],
      directoryScopes: [],
    });
    expect(invoke).toHaveBeenCalledWith('read_file', { path: 'c:/external/file.ts' });
  });

  it('does not persist an allow-once decision', async () => {
    const invoke = vi.fn(async () => 'content' as never);
    const router = new ToolRouter();
    router.register(readFileTool);
    router.setApprovalConfig({ mode: 'yolo' });
    let approvalCount = 0;
    router.setApprovalCallback(async () => {
      approvalCount += 1;
      return { approved: true, externalGrant: 'once' };
    });

    await router.execute('read_file', 'read-1', { path: 'C:/external/file.ts' }, context(invoke));
    await router.execute('read_file', 'read-2', { path: 'C:/external/file.ts' }, context(invoke));

    expect(approvalCount).toBe(2);
  });

  it('shares a session-directory grant with descendants but not writes', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'read_file') return 'content' as never;
      return undefined as never;
    });
    const router = new ToolRouter();
    router.register(readFileTool);
    router.register(writeFileTool);
    router.setApprovalConfig({ mode: 'yolo' });
    const approvals: string[] = [];
    router.setApprovalCallback(async (pending) => {
      approvals.push(pending.toolName);
      return { approved: true, externalGrant: 'session-directory' };
    });

    await router.execute(
      'read_file',
      'read-1',
      { path: 'C:/external/project/file.ts' },
      context(invoke),
    );
    await router.execute(
      'read_file',
      'read-2',
      { path: 'C:/external/project/nested/file.ts' },
      context(invoke),
    );
    await router.execute(
      'write_file',
      'write-1',
      { path: 'C:/external/project/file.ts', content: 'changed' },
      context(invoke),
    );

    expect(approvals).toEqual(['read_file', 'write_file']);
  });

  it('fails closed when no approval callback exists', async () => {
    const invoke = vi.fn(async () => 'must not run' as never);
    const router = new ToolRouter();
    router.register(readFileTool);
    router.setApprovalConfig({ mode: 'yolo' });

    const record = await router.execute(
      'read_file',
      'read-1',
      { path: 'C:/external/file.ts' },
      context(invoke),
    );

    expect(record.output.success).toBe(false);
    expect(record.output.error).toContain('External path access');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('requires approval for an external terminal cwd even in yolo mode', async () => {
    const invoke = vi.fn(async () => 'must not run' as never);
    const router = new ToolRouter();
    router.register(runTerminalCommandTool);
    router.setApprovalConfig({ mode: 'yolo' });
    const approval = vi.fn(async () => false);

    router.setApprovalCallback(approval);
    const record = await router.execute(
      'run_terminal_command',
      'terminal-1',
      { command: 'echo external', cwd: 'C:/external/project' },
      context(invoke),
    );

    expect(approval).toHaveBeenCalledWith(
      expect.objectContaining({
        externalAccess: {
          operation: 'execute',
          paths: ['c:/external/project'],
          directories: ['c:/external/project'],
          directoryScopes: ['c:/external/project'],
        },
      }),
      expect.any(AbortSignal),
    );
    expect(record.output.success).toBe(false);
    expect(record.output.error).toContain('External path access');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns a recoverable result when the external request is cancelled', async () => {
    const invoke = vi.fn(async () => 'must not run' as never);
    const router = new ToolRouter();
    router.register(readFileTool);
    router.setApprovalConfig({ mode: 'yolo' });
    router.setApprovalCallback(async (_pending, signal) => {
      if (signal.aborted) return false;
      return new Promise<boolean>((resolve) => {
        signal.addEventListener('abort', () => resolve(false), { once: true });
      });
    });

    const controller = new AbortController();
    const execution = router.execute(
      'read_file',
      'cancelled-read',
      { path: 'C:/external/file.ts' },
      context(invoke, controller.signal),
    );
    controller.abort();
    const record = await execution;

    expect(record.output.success).toBe(false);
    expect(record.output.error).toContain('External path access');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('clears session-directory grants explicitly', async () => {
    const invoke = vi.fn(async () => 'content' as never);
    const router = new ToolRouter();
    router.register(readFileTool);
    router.setApprovalConfig({ mode: 'yolo' });
    let approvals = 0;
    router.setApprovalCallback(async () => {
      approvals += 1;
      return { approved: true, externalGrant: 'session-directory' };
    });

    await router.execute('read_file', 'read-1', { path: 'C:/external/file.ts' }, context(invoke));
    await router.execute('read_file', 'read-2', { path: 'C:/external/nested/file.ts' }, context(invoke));
    router.clearExternalPathGrants();
    await router.execute('read_file', 'read-3', { path: 'C:/external/again.ts' }, context(invoke));

    expect(approvals).toBe(2);
  });

  it('shares directory grants with child harnesses', async () => {
    const invoke = vi.fn(async () => undefined as never);
    const approvals = vi.fn(async () => ({ approved: true, externalGrant: 'session-directory' as const }));
    const externalProbe: ToolHandler = {
      definition: {
        name: 'external_probe',
        description: 'test external access',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      category: 'filesystem',
      requiresApproval: false,
      externalPathAccess: {
        operation: 'read',
        fields: [{ key: 'path', kind: 'target' }],
      },
      execute: async (input, ctx) => ({
        success: true,
        output: ctx.externalPathAccess?.resolve(String(input.path)) ?? '',
      }),
    };
    const parent = new Harness({
      workspacePath,
      projectId: 'project',
      invoke,
      config: { approval: { mode: 'yolo' } },
      onApprovalRequest: approvals,
    });
    const child = parent.createChild({ agentType: 'review', externalTools: [externalProbe] });
    parent.getToolRouter().register(externalProbe);

    const first = await parent.getToolRouter().execute(
      'external_probe',
      'parent-call',
      { path: 'C:/external/project/file.ts' },
      context(invoke),
    );
    const second = await child.getToolRouter().execute(
      'external_probe',
      'child-call',
      { path: 'C:/external/project/nested/file.ts' },
      context(invoke),
    );

    expect(first.output.success).toBe(true);
    expect(second.output.success).toBe(true);
    expect(approvals).toHaveBeenCalledTimes(1);
  });
});

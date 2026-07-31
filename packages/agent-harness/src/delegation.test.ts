import { afterEach, describe, expect, it } from 'vitest';
import { getProviderRegistry, type AIProvider, type ChatParams, type StreamChunk } from '@hyscode/ai-providers';
import type { ToolHandler } from './types';
import { Harness } from './harness';
import { DelegatedRunner } from './delegated-runner';

function externalTool(name: string): ToolHandler {
  return {
    definition: {
      name,
      description: 'test external tool',
      inputSchema: { type: 'object', properties: {} },
    },
    category: 'meta',
    requiresApproval: false,
    execute: async () => ({ success: true, output: 'ok' }),
  };
}

const model = {
  id: 'delegation-model',
  name: 'Delegation test model',
  provider: 'delegation-test',
  contextWindow: 32_000,
  maxOutputTokens: 4_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsVision: false,
};

function finalResponseProvider(onParams: (params: ChatParams) => void): AIProvider {
  return {
    id: 'delegation-test',
    name: 'Delegation test provider',
    models: [model],
    isConfigured: () => true,
    listModels: async () => [model],
    async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
      onParams(params);
      yield {
        type: 'usage',
        usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      };
      yield { type: 'text_delta', text: 'delegated result' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

afterEach(() => getProviderRegistry().unregister('delegation-test'));

describe('Harness child delegation', () => {
  it('creates an isolated child with inherited environment and explicit tools', () => {
    const invoke = async <T>(_cmd: string, _args?: Record<string, unknown>) => 'ok' as T;
    const parent = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke,
      config: { approval: { mode: 'manual' } },
    });
    parent.setAgentType('build');
    parent.setConversationId('parent-conversation');
    parent.registerExternalTool(externalTool('parent-only'));

    const child = parent.createChild({
      agentType: 'review',
      externalTools: [externalTool('delegated-safe')],
    });

    expect(child.getAgentType()).toBe('review');
    expect(child.getDelegationLevel()).toBe(1);
    expect(child.getConversationId()).toBe('parent-conversation');
    expect(child.getToolRouter().has('parent-only')).toBe(false);
    expect(child.getToolRouter().has('delegated-safe')).toBe(true);
  });

  it('does not inherit parent-only external tools by default', () => {
    const parent = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async <T>(_cmd: string, _args?: Record<string, unknown>) => 'ok' as T,
    });
    parent.registerExternalTool(externalTool('parent-only'));

    const child = parent.createChild({ agentType: 'plan' });

    expect(child.getToolRouter().has('parent-only')).toBe(false);
  });

  it('runs a delegated turn with parent identity and environment context', async () => {
    const observedParams: ChatParams[] = [];
    getProviderRegistry().register(finalResponseProvider((params) => {
      observedParams.push(params);
    }));

    const parent = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async <T>(_cmd: string, _args?: Record<string, unknown>) => 'ok' as T,
      config: {
        providerId: 'delegation-test',
        modelId: 'delegation-model',
        approval: { mode: 'yolo' },
        costOptimization: false,
      },
    });
    parent.setAgentType('build');
    parent.setConversationId('parent-conversation');

    const events: Array<{ type: string; conversationId?: string }> = [];
    const runner = new DelegatedRunner({
      parentHarness: parent,
      mode: 'review',
      config: {
        providerId: 'delegation-test',
        modelId: 'delegation-model',
        maxIterations: 3,
        approval: { mode: 'yolo' },
        costOptimization: false,
      },
      conversationId: 'parent-conversation',
      environmentContext: {
        workspacePath: 'C:/workspace',
        activeFile: { path: 'src/app.ts', content: 'export const app = true;', language: 'typescript' },
      },
      onEvent: (event) => events.push({ type: event.type, conversationId: event.conversationId }),
    });

    const outcome = await runner.run('Review the active file.');

    expect(outcome.status).toBe('complete');
    expect(outcome.response).toBe('delegated result');
    expect(outcome.turnRecord.conversationId).toBe('parent-conversation');
    expect(
      observedParams[0]?.messages.some((message) =>
        message.content.some(
          (block) => block.type === 'text' && block.text.includes('<active_file path="src/app.ts"'),
        ),
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === 'turn_start')).toBe(true);
    expect(events.every((event) => event.conversationId === 'parent-conversation')).toBe(true);
  });

  it('blocks ask_user at the child execution context', async () => {
    const parent = new Harness({
      workspacePath: 'C:/workspace',
      projectId: 'project',
      invoke: async <T>(_cmd: string, _args?: Record<string, unknown>) => 'ok' as T,
    });
    const child = parent.createChild({ agentType: 'review' });
    const handler = child.getToolRouter().getHandler('ask_user');

    expect(handler).toBeDefined();
    const result = await handler!.execute(
      { questions: [{ id: 'q1', question: 'Should this continue?' }] },
      {
        workspacePath: 'C:/workspace',
        conversationId: 'parent-conversation',
        toolCallId: 'ask-1',
        signal: new AbortController().signal,
        invoke: async <T>(_cmd: string, _args?: Record<string, unknown>) => 'ok' as T,
        delegationLevel: 1,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not available inside sub-agents');
  });
});

import { describe, expect, it } from 'vitest';
import type { BridgeRequest, BridgeResponse, RuntimeReadyPayload } from '@hyscode/tui-runtime';
import { TuiController, type RuntimeClient } from './controller';

function readyPayload(workspacePath: string): RuntimeReadyPayload {
  return {
    protocolVersion: 1,
    workspacePath,
    projectId: workspacePath,
    providers: [],
    models: [],
    agentTypes: ['chat', 'build', 'review', 'debug', 'plan'],
    modes: ['manual', 'yolo', 'smart', 'notify', 'session-trust', 'custom'],
    activeAgentType: 'chat',
    activeProviderId: '',
    activeModelId: '',
    activeThinking: { enabled: false },
  };
}

class FakeRuntime implements RuntimeClient {
  readonly requests: BridgeRequest[] = [];
  private onRequest: ((request: BridgeRequest) => void) | null = null;

  setRequestObserver(observer: (request: BridgeRequest) => void): void {
    this.onRequest = observer;
  }

  async handle(request: BridgeRequest): Promise<BridgeResponse> {
    this.requests.push(request);
    this.onRequest?.(request);
    const result = request.method === 'initialize' ? readyPayload(String(request.params?.workspacePath)) : request.method === 'diagnostics' ? [] : request.method === 'shutdown' ? { shutdown: true } : request.method === 'resolve_interaction' ? { resolved: true } : { ok: true };
    return { type: 'response', id: request.id, ok: true, result };
  }
}

describe('TUI controller', () => {
  it('projects runtime streaming events into a bounded transcript and sends user messages', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    await controller.handleKey({ type: 'character', value: 'Olá' });
    await controller.handleKey({ type: 'enter' });
    controller.handleRuntimeMessage({ type: 'event', event: 'harness_event', payload: { type: 'turn_start', conversationId: 'c', iteration: 1 } });
    controller.handleRuntimeMessage({ type: 'event', event: 'harness_event', payload: { type: 'stream_chunk', chunk: { type: 'text_delta', text: 'resposta' } } });
    controller.handleRuntimeMessage({ type: 'event', event: 'harness_event', payload: { type: 'turn_end', reason: 'complete', tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } });

    expect(runtime.requests.map((request) => request.method)).toEqual(['initialize', 'send_message']);
    expect(controller.state.transcript).toEqual(expect.arrayContaining([
      { kind: 'user', text: 'Olá' },
      { kind: 'assistant', text: 'resposta' },
    ]));
    expect(controller.state.running).toBe(false);
  });

  it('resolves approval interactions with the same fields used by the shared bridge', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    controller.handleRuntimeMessage({
      type: 'event',
      event: 'interaction',
      payload: { kind: 'approval', requestId: 'approval-1', toolCall: { id: 'approval-1', toolName: 'write_file', input: {}, description: 'write fixture', riskLevel: 'destructive' } },
    });
    await controller.handleKey({ type: 'character', value: 'y' });

    expect(runtime.requests.at(-1)).toMatchObject({ method: 'resolve_interaction', params: { requestId: 'approval-1', approved: true } });
    expect(controller.state.interaction).toBeNull();
  });

  it('opens the slash palette while typing and completes the selected command with Tab', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();

    await controller.handleKey({ type: 'character', value: '/' });
    await controller.handleKey({ type: 'character', value: 'mo' });

    expect(controller.state.commandFlow).toMatchObject({ kind: 'root', query: '/mo', inputDriven: true });
    await controller.handleKey({ type: 'tab' });

    expect(controller.state.input).toBe('/mode ');
    expect(controller.state.commandFlow).toBeNull();
    expect(controller.state.overlay).toBe('none');
  });

  it('executes aliases from the slash palette without a second runtime loop', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    await controller.handleKey({ type: 'character', value: '/' });
    await controller.handleKey({ type: 'character', value: 'q' });
    await controller.handleKey({ type: 'enter' });

    expect(controller.state.shouldQuit).toBe(true);
    expect(runtime.requests.map((request) => request.method)).toEqual(['initialize']);
  });
});

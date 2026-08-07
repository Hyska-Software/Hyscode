import { describe, expect, it } from 'vitest';
import type { BridgeRequest, BridgeResponse, RuntimeReadyPayload } from '@hyscode/tui-runtime';
import { CliUpdater } from '@hyscode/tui-runtime';
import { TuiController, type RuntimeClient } from './controller';

function readyPayload(workspacePath: string, includeThinkingModel = false): RuntimeReadyPayload {
  const thinkingModel = {
    id: 'thinking-model',
    name: 'Thinking Model',
    provider: 'test-provider',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    thinkingVariants: { kind: 'openai' as const, levels: ['low', 'medium', 'high'] as const, defaultLevel: 'medium' as const },
  };
  return {
    protocolVersion: 1,
    workspacePath,
    projectId: workspacePath,
    providers: includeThinkingModel ? [{ id: 'test-provider', name: 'Test Provider', configured: true, models: [thinkingModel] }] : [],
    models: includeThinkingModel ? [thinkingModel] : [],
    agentTypes: ['chat', 'build', 'review', 'debug', 'plan'],
    modes: ['manual', 'yolo', 'smart', 'notify', 'session-trust', 'custom'],
    activeAgentType: 'chat',
    activeProviderId: includeThinkingModel ? 'test-provider' : '',
    activeModelId: includeThinkingModel ? 'thinking-model' : '',
    activeThinking: { enabled: false },
  };
}

class FakeRuntime implements RuntimeClient {
  readonly requests: BridgeRequest[] = [];
  private onRequest: ((request: BridgeRequest) => void) | null = null;

  constructor(private readonly createReadyPayload: (workspacePath: string) => RuntimeReadyPayload = readyPayload) {}

  setRequestObserver(observer: (request: BridgeRequest) => void): void {
    this.onRequest = observer;
  }

  async handle(request: BridgeRequest): Promise<BridgeResponse> {
    this.requests.push(request);
    this.onRequest?.(request);
    const result = request.method === 'initialize' || request.method === 'set_config' ? this.createReadyPayload(String(request.params?.workspacePath ?? 'C:/workspace')) : request.method === 'diagnostics' ? [] : request.method === 'shutdown' ? { shutdown: true } : request.method === 'resolve_interaction' ? { resolved: true } : { ok: true };
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

  it('projects terminal updates by id, normalizes framing, and ignores stale sequences', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    const terminal = {
      terminalId: 'agent-terminal',
      ptyId: 'pty-agent',
      name: 'Agent Terminal',
      alive: true,
      sequence: 4,
      outputPreview: '\u001b[31m__HYSCODE_BEGIN_nonce__\r\nvisible output\r\n__HYSCODE_END_nonce__:0\r\n',
      frameLanguage: 'powershell' as const,
      role: 'agent' as const,
      cwd: 'c:/workspace',
      ownerConversationId: 'conversation-1',
      activeToolCallId: 'tool-terminal',
      awaitingInput: false,
      exitCode: null,
      truncated: false,
      canUserWrite: false,
    };
    controller.handleRuntimeMessage({ type: 'event', event: 'terminal_updated', payload: { terminal, cause: 'created' } });
    expect(controller.state.terminals).toHaveLength(1);
    expect(controller.state.terminals[0]?.outputPreview).toBe('visible output');

    controller.handleRuntimeMessage({
      type: 'event',
      event: 'harness_event',
      payload: {
        type: 'terminal_progress',
        progress: { toolCallId: 'tool-terminal', terminalId: 'agent-terminal', sequence: 3, chunk: 'stale', state: 'running' },
      },
    });
    expect(controller.state.tools).toHaveLength(0);

    controller.handleRuntimeMessage({
      type: 'event',
      event: 'harness_event',
      payload: {
        type: 'terminal_progress',
        progress: { toolCallId: 'tool-terminal', terminalId: 'agent-terminal', sequence: 5, chunk: '\u001b[32m__HYSCODE_BEGIN_nonce__\nnew output\n__HYSCODE_END_nonce__:0\n', state: 'running' },
      },
    });
    expect(controller.state.tools[0]).toMatchObject({ terminalId: 'agent-terminal', outputSequence: 5 });
    expect(controller.state.tools[0]?.liveOutput).toBe('new output');
  });

  it('enters guarded terminal input mode and forwards the response without trimming it', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    const terminal = {
      terminalId: 'waiting-terminal',
      ptyId: 'pty-waiting',
      name: 'Waiting Agent Terminal',
      alive: true,
      sequence: 10,
      outputPreview: 'Continue? [Y/n]',
      frameLanguage: 'powershell' as const,
      role: 'agent' as const,
      cwd: 'c:/workspace',
      ownerConversationId: 'conversation-1',
      activeToolCallId: null,
      awaitingInput: true,
      exitCode: null,
      truncated: false,
      canUserWrite: true,
    };
    controller.handleRuntimeMessage({ type: 'event', event: 'terminal_updated', payload: { terminal, cause: 'state' } });
    expect(controller.state.terminalInput).toEqual({ terminalId: 'waiting-terminal', masked: false });

    await controller.handleKey({ type: 'character', value: '  yes  ' });
    await controller.handleKey({ type: 'enter' });

    expect(runtime.requests.at(-1)).toMatchObject({
      method: 'terminal_write',
      params: { terminalId: 'waiting-terminal', data: '  yes  \r\n' },
    });
    expect(controller.state.terminalInput).toBeNull();
  });

  it('rejects terminal events from an older turn or conversation', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    controller.handleRuntimeMessage({
      type: 'event',
      event: 'harness_event',
      payload: { type: 'turn_start', turnId: 'turn-current', conversationId: 'conversation-current', iteration: 1 },
    });
    const terminal = {
      terminalId: 'stale-terminal',
      ptyId: 'pty-stale',
      name: 'Stale Terminal',
      alive: true,
      sequence: 12,
      outputPreview: 'stale output',
      frameLanguage: 'bash' as const,
      role: 'agent' as const,
      ownerConversationId: 'conversation-current',
    };
    controller.handleRuntimeMessage({
      type: 'event',
      event: 'terminal_updated',
      payload: { terminal, cause: 'output', turnId: 'turn-old', conversationId: 'conversation-current' },
    });
    controller.handleRuntimeMessage({
      type: 'event',
      event: 'harness_event',
      payload: {
        type: 'terminal_progress',
        turnId: 'turn-old',
        conversationId: 'conversation-current',
        progress: { toolCallId: 'stale-tool', terminalId: 'stale-terminal', sequence: 12, chunk: 'stale', state: 'running' },
      },
    });
    expect(controller.state.terminals).toHaveLength(0);
    expect(controller.state.tools).toHaveLength(0);

    controller.handleRuntimeMessage({
      type: 'event',
      event: 'terminal_updated',
      payload: {
        terminal: {
          ...terminal,
          terminalId: 'child-terminal',
          ownerId: 'sub-agent-1',
          sequence: 13,
          awaitingInput: true,
          canUserWrite: true,
        },
        cause: 'state',
        conversationId: 'conversation-current',
      },
    });
    expect(controller.state.terminalInput).toBeNull();
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

  it('uses dedicated controls for mandatory external access', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    controller.handleRuntimeMessage({
      type: 'event',
      event: 'interaction',
      payload: {
        kind: 'approval',
        requestId: 'external-1',
        toolCall: {
          id: 'external-1',
          toolName: 'read_file',
          input: { path: 'C:/external/file.txt' },
          description: 'read external file',
          riskLevel: 'safe',
          externalAccess: {
            operation: 'read',
            paths: ['c:/external/file.txt'],
            directories: ['c:/external'],
            directoryScopes: [],
          },
        },
      },
    });
    await controller.handleKey({ type: 'character', value: 'd' });

    expect(runtime.requests.at(-1)).toMatchObject({
      method: 'resolve_interaction',
      params: { requestId: 'external-1', approved: true, grant: 'session-directory' },
    });
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

  it('opens the interactive theme selector and persists the selected theme through the runtime', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();

    await controller.handleKey({ type: 'character', value: '/theme' });
    await controller.handleKey({ type: 'enter' });
    expect(controller.state.commandFlow).toMatchObject({ kind: 'theme', selected: 0 });

    await controller.handleKey({ type: 'down' });
    await controller.handleKey({ type: 'enter' });

    expect(runtime.requests.at(-1)).toMatchObject({ method: 'set_config', params: { themeId: 'aura' } });
    expect(controller.state.themeId).toBe('aura');
    expect(controller.state.status).toBe('Theme set to Aura');
    expect(controller.state.commandFlow).toBeNull();
  });

  it('toggles the persisted sidebar setting through the slash command', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    controller.state.focus = 'sidebar';

    await controller.handleKey({ type: 'character', value: '/sidebar' });
    await controller.handleKey({ type: 'enter' });

    expect(runtime.requests.at(-1)).toMatchObject({ method: 'set_config', params: { sidebarVisible: false } });
    expect(controller.state.sidebarVisible).toBe(false);
    expect(controller.state.focus).toBe('composer');
    expect(controller.state.status).toBe('Sidebar disabled');

    await controller.handleKey({ type: 'character', value: '/sidebar on' });
    await controller.handleKey({ type: 'enter' });

    expect(runtime.requests.at(-1)).toMatchObject({ method: 'set_config', params: { sidebarVisible: true } });
    expect(controller.state.sidebarVisible).toBe(true);
  });

  it('persists VORTEX update preferences through the shared runtime command', async () => {
    const updater = new CliUpdater({ version: '0.8.2', platform: 'win32', architecture: 'x64' });
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime, { updater, interactive: false });
    await controller.start();

    await controller.handleKey({ type: 'character', value: '/update startup off' });
    await controller.handleKey({ type: 'enter' });
    await controller.handleKey({ type: 'character', value: '/update auto-download on' });
    await controller.handleKey({ type: 'enter' });
    await controller.handleKey({ type: 'character', value: '/update channel pre-release' });
    await controller.handleKey({ type: 'enter' });

    expect(runtime.requests.slice(-3).map((request) => request.params)).toEqual([
      { checkForUpdatesOnStartup: false },
      { autoDownload: true },
      { updateChannel: 'pre-release' },
    ]);
    expect(controller.state.updates).toMatchObject({
      checkForUpdatesOnStartup: false,
      autoDownload: true,
      channel: 'pre-release',
    });
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

  it('supports paging and boundary navigation in selection flows', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    await controller.handleKey({ type: 'character', value: '/mode' });
    await controller.handleKey({ type: 'enter' });

    expect(controller.state.commandFlow).toMatchObject({ kind: 'mode', selected: 0 });
    await controller.handleKey({ type: 'page_down' });
    expect(controller.state.commandFlow).toMatchObject({ kind: 'mode', selected: 4 });
    await controller.handleKey({ type: 'home' });
    expect(controller.state.commandFlow).toMatchObject({ kind: 'mode', selected: 0 });
    await controller.handleKey({ type: 'end' });
    expect(controller.state.commandFlow).toMatchObject({ kind: 'mode', selected: 4 });
  });

  it('scrolls the transcript with the mouse wheel regardless of composer focus', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();

    await controller.handleKey({ type: 'mouse', action: 'scroll_up', x: 42, y: 8 });
    expect(controller.state.scroll).toBe(3);

    await controller.handleKey({ type: 'mouse', action: 'scroll_down', x: 42, y: 8 });
    expect(controller.state.scroll).toBe(0);
  });

  it('keeps context usage current as provider usage events arrive during a turn', async () => {
    const runtime = new FakeRuntime((workspacePath) => readyPayload(workspacePath, true));
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();

    expect(controller.state.usage.contextWindow).toBe(128000);
    controller.handleRuntimeMessage({
      type: 'event',
      event: 'harness_event',
      payload: { type: 'stream_chunk', chunk: { type: 'usage', usage: { inputTokens: 32000, outputTokens: 1200, totalTokens: 33200 } } },
    });

    expect(controller.state.usage.inputTokens).toBe(32000);
  });

  it('uses the mouse wheel to navigate open selection lists', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    await controller.handleKey({ type: 'character', value: '/mode' });
    await controller.handleKey({ type: 'enter' });

    await controller.handleKey({ type: 'mouse', action: 'scroll_down', x: 42, y: 8 });
    expect(controller.state.commandFlow).toMatchObject({ kind: 'mode', selected: 1 });
  });

  it('opens the thinking selector after choosing a model with thinking levels', async () => {
    const runtime = new FakeRuntime((workspacePath) => readyPayload(workspacePath, true));
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();

    await controller.handleKey({ type: 'character', value: '/models' });
    await controller.handleKey({ type: 'enter' });
    await controller.handleKey({ type: 'enter' });
    await controller.handleKey({ type: 'enter' });

    expect(runtime.requests.map((request) => request.method)).toEqual(['initialize', 'set_config']);
    expect(controller.state.commandFlow).toMatchObject({ kind: 'thinking', selected: 2 });
    expect(controller.state.status).toContain('choose thinking level');

    await controller.handleKey({ type: 'enter' });

    expect(runtime.requests.at(-1)).toMatchObject({
      method: 'set_config',
      params: { providerId: 'test-provider', modelId: 'thinking-model', thinking: { enabled: true, level: 'medium' } },
    });
    expect(controller.state.commandFlow).toBeNull();
  });

  it('opens the approval selector so the policy can be changed with the keyboard', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();

    await controller.handleKey({ type: 'character', value: '/approval' });
    await controller.handleKey({ type: 'enter' });

    expect(controller.state.commandFlow).toMatchObject({ kind: 'action', action: 'approval', selected: 0 });
    await controller.handleKey({ type: 'down' });
    await controller.handleKey({ type: 'enter' });

    expect(runtime.requests.at(-1)).toMatchObject({ method: 'set_config', params: { approvalMode: 'smart' } });
    expect(controller.state.approvalMode).toBe('smart');
    expect(controller.state.commandFlow).toBeNull();
  });

  it('turns SDD start into a guided description input instead of requiring inline arguments', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();

    await controller.handleKey({ type: 'character', value: '/sdd' });
    await controller.handleKey({ type: 'enter' });
    expect(controller.state.commandFlow).toMatchObject({ kind: 'action', action: 'sdd', selected: 0 });

    await controller.handleKey({ type: 'enter' });

    expect(controller.state.input).toBe('/sdd ');
    expect(controller.state.status).toContain('Describe the SDD request');
    expect(controller.state.commandFlow).toBeNull();
  });

  it('lets the user choose which pending file change to accept', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    controller.state.fileChanges = [
      { toolCallId: 'change-1', toolName: 'write_file', filePath: 'src/first.ts', originalContent: '', newContent: 'one', status: 'pending', expanded: false },
      { toolCallId: 'change-2', toolName: 'write_file', filePath: 'src/second.ts', originalContent: '', newContent: 'two', status: 'pending', expanded: false },
    ];

    await controller.handleKey({ type: 'character', value: '/diffs' });
    await controller.handleKey({ type: 'enter' });
    await controller.handleKey({ type: 'down' });
    await controller.handleKey({ type: 'enter' });

    expect(controller.state.commandFlow).toMatchObject({ kind: 'diff_file', action: 'accept', selected: 0 });
    await controller.handleKey({ type: 'down' });
    await controller.handleKey({ type: 'enter' });

    expect(runtime.requests.at(-1)).toMatchObject({ method: 'file_change_resolve', params: { toolCallId: 'change-2', action: 'accept' } });
    expect(controller.state.commandFlow).toBeNull();
  });

  it('lets the context menu attach an existing terminal without typing its id', async () => {
    const runtime = new FakeRuntime();
    const controller = new TuiController({ workspace: 'C:/workspace' }, runtime);
    await controller.start();
    controller.state.terminals = [{ terminalId: 'term-1', ptyId: 'pty-1', name: 'PowerShell', alive: true, sequence: 0, outputPreview: '', frameLanguage: 'powershell' }];

    await controller.handleKey({ type: 'character', value: '/context' });
    await controller.handleKey({ type: 'enter' });
    await controller.handleKey({ type: 'down' });
    await controller.handleKey({ type: 'down' });
    await controller.handleKey({ type: 'enter' });
    expect(controller.state.commandFlow).toMatchObject({ kind: 'terminal_attach', selected: 0 });

    await controller.handleKey({ type: 'enter' });

    expect(runtime.requests.at(-1)).toMatchObject({ method: 'context_attach', params: { kind: 'terminal', terminalId: 'term-1' } });
    expect(controller.state.commandFlow).toBeNull();
  });
});

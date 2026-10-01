/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnOutcome, TurnRecord } from '@hyscode/agent-harness';
import { createAgentStore, type AgentStoreApi } from '@/stores/agent-store';
import { useEditorStore } from '@/stores/editor-store';
import { useFileStore } from '@/stores/file-store';
import { useProjectStore } from '@/stores/project-store';
import { useSettingsStore } from '@/stores/settings-store';

const { invokeRawMock, invokeMock } = vi.hoisted(() => ({
  invokeRawMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock('./tauri-invoke', () => ({
  tauriInvokeRaw: invokeRawMock,
  tauriInvoke: invokeMock,
}));

vi.mock('./init-providers', () => ({ configureProviderResilience: vi.fn() }));
vi.mock('./goal-runtime', () => ({ createDesktopGoalService: vi.fn() }));
vi.mock('./task-execution-coordinator', () => ({
  desktopKanbanHarnessIntegration: {},
  kanbanTaskExecutionCoordinator: {
    registerTarget: vi.fn(() => vi.fn()),
  },
}));
vi.mock('./vortex-project-sessions', () => ({
  notifyVortexProjectSessionIndexUpdated: vi.fn(),
}));
vi.mock('@hyscode/agent-harness', () => ({
  Harness: class {},
  SkillLoader: class {},
  RuleLoader: class {},
  applyPolicyOverride: vi.fn(),
  resolveEffectiveAgentPolicy: vi.fn(() => ({})),
  effectivePolicyConfig: vi.fn(() => ({})),
  MemoryManager: class {},
  SAFE_TOOLS: new Set<string>(),
  projectTerminalProgress: vi.fn(),
  projectTerminalRuntimeSummary: vi.fn(),
  isTerminalRecord: vi.fn(() => false),
  asTerminalRuntimeFailure: vi.fn(),
  validateTerminalExitEvent: vi.fn(),
  validateTerminalFailure: vi.fn(),
  createGoalTools: vi.fn(() => []),
  authorizeToolInvocationArgs: vi.fn((args: Record<string, unknown> | undefined) => args),
}));

import { HarnessBridge } from './harness-bridge';
import { resolveSubAgentMirrorTarget } from './harness-bridge';

type HarnessDouble = {
  workspacePath: string;
  sources: Array<{ id: string; content: string }>;
  run: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  setConfig: ReturnType<typeof vi.fn>;
  setAgentType: ReturnType<typeof vi.fn>;
  setDelegationChain: ReturnType<typeof vi.fn>;
  setMode: ReturnType<typeof vi.fn>;
  setConversationId: ReturnType<typeof vi.fn>;
  getWorkspacePath: () => string;
  getConversationId: () => string;
  getSkillLoader: () => { getActive: () => [] };
  getRuleLoader: () => { getActive: () => [] };
  addContextSource: (source: { id: string; content: string }) => void;
  injectEnvironmentContext: ReturnType<typeof vi.fn>;
  getContextTurnNumber: () => number;
  removeContextSource: ReturnType<typeof vi.fn>;
};

type BridgeTestAccess = {
  buildEnvironmentContext: () => Promise<{ activeFile?: { path: string; content: string } }>;
  handleFileChangePending: (
    change: {
      filePath: string;
      toolName: string;
      toolCallId: string;
      originalContent: string | null;
      newContent: string;
    },
    turnId?: string,
  ) => void;
  mutationSnapshots: Map<
    string,
    {
      diskBefore: string | null;
      bufferBefore: string | null;
      wasDirty: boolean;
      tabId: string | null;
      expectedContent?: string | null;
    }
  >;
};

function createOutcome(conversationId: string, response = 'Assistant answer'): TurnOutcome {
  const tokenUsage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 };
  const turnRecord: TurnRecord = {
    id: 'turn-1',
    conversationId,
    mode: 'chat',
    iterations: 1,
    toolCalls: [],
    tokenUsage,
    stopReason: 'complete',
    verificationPerformed: false,
    verificationForced: false,
    filesModified: [],
    durationMs: 1,
    timestamp: new Date(0).toISOString(),
  };
  return { turnId: 'turn-1', status: 'complete', response, toolCalls: [], turnRecord };
}

function createBridge(options: { isolatedRuntime?: boolean; workspacePath?: string } = {}): {
  bridge: HarnessBridge;
  harness: HarnessDouble;
  store: AgentStoreApi;
} {
  const store = createAgentStore();
  const workspacePath = options.workspacePath ?? 'C:/project';
  const harness: HarnessDouble = {
    workspacePath,
    sources: [],
    run: vi.fn(async () => createOutcome(store.getState().conversationId ?? 'conversation')),
    cancel: vi.fn(),
    setConfig: vi.fn(),
    setAgentType: vi.fn(),
    setDelegationChain: vi.fn(),
    setMode: vi.fn(),
    setConversationId: vi.fn(),
    getWorkspacePath: () => workspacePath,
    getConversationId: () => store.getState().conversationId ?? '',
    getSkillLoader: () => ({ getActive: () => [] }),
    getRuleLoader: () => ({ getActive: () => [] }),
    addContextSource: (source) => harness.sources.push(source),
    injectEnvironmentContext: vi.fn(),
    getContextTurnNumber: () => 1,
    removeContextSource: vi.fn(),
  };

  const bridge = Object.create(HarnessBridge.prototype) as HarnessBridge;
  Object.assign(bridge, {
    harness,
    agentStore: store,
    isolatedRuntime: options.isolatedRuntime ?? true,
    disposed: false,
    _projectId: workspacePath,
    approvalResolvers: new Map(),
    modeSwitchResolvers: new Map(),
    resolvedModeSwitchIds: new Set(),
    userQuestionResolvers: new Map(),
    _subAgentRunners: new Map(),
    _approvalOwner: new Map(),
    _turnHadSubAgents: false,
    subAgentCoordinator: { cancelAllQueued: vi.fn(), queueLength: 0 },
    mutationSnapshotPromises: new Map(),
    memoryManager: null,
    ruleDiagnostics: [],
    externalMcpTools: new Map(),
    mutationSnapshots: new Map(),
    activeTurnTabId: null,
    activeTurnConversationId: null,
    activeTurnId: null,
    lastCompletedTurnId: null,
    activeTaskContext: null,
    taskTargetUnregister: null,
    ptyExitUnsubscribe: null,
    goalService: { getState: vi.fn(async () => null) },
    goalContinuationTimers: new Map(),
    goalContinuationInFlight: new Set(),
    _lastTerminalCommands: new Map(),
    turnSequence: 0,
    activeTurn: null,
    editorTurnQueue: Promise.resolve(),
    queuedTurns: [],
    loadRules: vi.fn(async () => []),
    syncActiveSkills: vi.fn(),
    syncActiveRules: vi.fn(),
    syncSharedAgentPreferences: vi.fn(),
    bindTaskExecutionTarget: vi.fn(),
    clearTabContext: vi.fn(),
    ensureConversationExists: vi.fn(async () => undefined),
    injectEnvironmentContext: vi.fn(async () => undefined),
    injectContextHints: vi.fn(async () => undefined),
    commitTurn: vi.fn(async () => undefined),
    persistTurnRecord: vi.fn(async () => undefined),
    refreshSessionUsage: vi.fn(async () => undefined),
  });
  return { bridge, harness, store };
}

function addEditorFile(path: string, rootPath: string, dirty: boolean): void {
  useFileStore.getState().setRootPath(rootPath);
  useFileStore.getState().setFileContent(path, 'dirty editor buffer');
  useEditorStore.getState().openTab({
    id: `tab:${path}`,
    filePath: path,
    fileName: path.split(/[\\/]/).pop() ?? path,
    language: 'typescript',
  });
  useEditorStore.getState().markDirty(`tab:${path}`, dirty);
}

describe('HarnessBridge Desktop turn boundaries', () => {
  beforeEach(() => {
    invokeRawMock.mockReset().mockImplementation(async (command: string) => {
      if (command === 'read_file') return 'disk file contents';
      if (command === 'list_dir_all') return [];
      return null;
    });
    invokeMock.mockReset().mockImplementation(async (command: string) => {
      if (command === 'git_repository_snapshot') {
        return {
          staged: [],
          unstaged: [],
          untracked: [],
          conflicts: [],
          current_branch: 'main',
          head_state: 'attached',
          operation_state: 'clean',
        };
      }
      return null;
    });
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useFileStore.getState().setRootPath('');
    useProjectStore.setState({ rootPath: null });
    useSettingsStore.setState({ approvalMode: 'manual' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  afterEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useFileStore.getState().setRootPath('');
    useProjectStore.setState({ rootPath: null });
    useSettingsStore.setState({ approvalMode: 'manual' });
  });

  it('forwards opaque native external-path grants only to authorized filesystem IPC', async () => {
    const { bridge } = createBridge();
    const authorization = {
      workspacePath: 'C:/project',
      externalPathAccess: { resolve: (path: string) => path },
      nativeGrantIds: ['native-grant-1'],
      revokeNativeGrantIds: ['native-grant-1'],
    };

    await bridge.invokeForHarness('read_file', { path: 'C:/external/approved.txt' }, authorization);
    await bridge.invokeForHarness('git_status', { repoPath: 'C:/project' }, authorization);

    expect(invokeRawMock).toHaveBeenCalledWith('read_file', {
      path: 'C:/external/approved.txt',
      nativeGrantIds: ['native-grant-1'],
    });
    expect(invokeRawMock).toHaveBeenCalledWith('git_status', {
      repoPath: 'C:/project',
    });
  });

  it('binds native external-access confirmation to the current workspace', async () => {
    const { bridge } = createBridge();
    invokeMock.mockResolvedValue('opaque-native-grant');
    const request = {
      operation: 'read' as const,
      paths: ['C:/external/file.ts'],
      directories: ['C:/external'],
      directoryScopes: [],
    };

    await expect(bridge.confirmExternalPathAccess(request, 'once')).resolves.toBe(
      'opaque-native-grant',
    );
    expect(invokeMock).toHaveBeenCalledWith('workspace_confirm_external_access', {
      request,
      grantType: 'once',
      workspacePath: 'C:/project',
    });
  });

  it('requires and revokes a native diagnostics approval around project commands', async () => {
    const { bridge } = createBridge();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'workspace_confirm_diagnostics') return 'diagnostics-grant';
      if (command === 'get_diagnostics') return [];
      return null;
    });

    await bridge.invokeForHarness('get_diagnostics', {});

    expect(invokeMock).toHaveBeenCalledWith('workspace_confirm_diagnostics', {
      workspacePath: 'C:/project',
    });
    expect(invokeMock).toHaveBeenCalledWith('get_diagnostics', {
      workspacePath: 'C:/project',
      nativeGrantIds: ['diagnostics-grant'],
    });
    expect(invokeMock).toHaveBeenCalledWith('workspace_revoke_external_grants', {
      grantIds: ['diagnostics-grant'],
    });
  });

  it('does not run project diagnostics when native confirmation is denied', async () => {
    const { bridge } = createBridge();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'workspace_confirm_diagnostics') {
        throw new Error('Project diagnostics were not approved');
      }
      return [];
    });

    await expect(bridge.invokeForHarness('get_diagnostics', {})).rejects.toThrow(
      'Project diagnostics were not approved',
    );
    expect(invokeMock).not.toHaveBeenCalledWith('get_diagnostics', expect.anything());
  });

  it('does not inject an editor buffer from a different project into runtime context', async () => {
    const { bridge } = createBridge({ workspacePath: 'C:/runtime-project' });
    addEditorFile('C:/editor-project/src/app.ts', 'C:/editor-project', true);

    const { buildEnvironmentContext } = bridge as unknown as BridgeTestAccess;
    const context = await buildEnvironmentContext.call(bridge);

    expect(context.activeFile).toBeUndefined();
  });

  it('uses a dirty editor buffer when reading a context chip', async () => {
    const { bridge, harness, store } = createBridge();
    const path = 'C:/project/src/app.ts';
    addEditorFile(path, 'C:/project', true);
    useFileStore.getState().setFileContent(path, 'latest unsaved content');
    store.setState({ contextFiles: [path] });

    await bridge.sendMessage('Review this file');

    expect(harness.sources).toContainEqual(
      expect.objectContaining({
        id: `ctx-file-${path}`,
        content: expect.stringContaining('latest unsaved content'),
      }),
    );
    expect(invokeRawMock).not.toHaveBeenCalledWith('read_file', { path });
  });

  it('does not call Harness.run when cancellation arrives during preflight', async () => {
    const { bridge, harness } = createBridge();
    let releaseRules!: () => void;
    const rulesReady = new Promise<void>((resolve) => {
      releaseRules = resolve;
    });
    Object.assign(bridge, { loadRules: vi.fn(() => rulesReady) });

    const sending = bridge.sendMessage('cancel during rule preflight');
    await vi.waitFor(() =>
      expect(
        (bridge as unknown as { loadRules: ReturnType<typeof vi.fn> }).loadRules,
      ).toHaveBeenCalled(),
    );
    bridge.cancel();
    releaseRules();

    await expect(sending).resolves.toBeNull();
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.cancel).not.toHaveBeenCalled();
  });

  it('drops preflight completion after the conversation identity changes', async () => {
    const { bridge, harness, store } = createBridge();
    let releaseRules!: () => void;
    const rulesReady = new Promise<void>((resolve) => {
      releaseRules = resolve;
    });
    Object.assign(bridge, { loadRules: vi.fn(() => rulesReady) });

    const sending = bridge.sendMessage('stale conversation submit');
    await vi.waitFor(() =>
      expect(
        (bridge as unknown as { loadRules: ReturnType<typeof vi.fn> }).loadRules,
      ).toHaveBeenCalled(),
    );
    store.getState().setConversationId('different-conversation');
    releaseRules();

    await expect(sending).resolves.toBeNull();
    expect(harness.run).not.toHaveBeenCalled();
  });

  it('drops preflight completion after the active project changes', async () => {
    useProjectStore.setState({ rootPath: 'C:/project' });
    const { bridge, harness } = createBridge({ isolatedRuntime: false });
    let releaseRules!: () => void;
    const rulesReady = new Promise<void>((resolve) => {
      releaseRules = resolve;
    });
    Object.assign(bridge, { loadRules: vi.fn(() => rulesReady) });

    const sending = bridge.sendMessage('stale project submit');
    await vi.waitFor(() =>
      expect(
        (bridge as unknown as { loadRules: ReturnType<typeof vi.fn> }).loadRules,
      ).toHaveBeenCalled(),
    );
    useProjectStore.setState({ rootPath: 'C:/another-project' });
    releaseRules();

    await expect(sending).resolves.toBeNull();
    expect(harness.run).not.toHaveBeenCalled();
  });

  it('does not overlap queued EDITOR submits on one bridge', async () => {
    useProjectStore.setState({ rootPath: 'C:/project' });
    const { bridge, harness } = createBridge({ isolatedRuntime: false });
    const pending: Array<(outcome: TurnOutcome) => void> = [];
    harness.run.mockImplementation(
      () => new Promise<TurnOutcome>((resolve) => pending.push(resolve)),
    );

    const first = bridge.sendMessage('first submit');
    await vi.waitFor(() => expect(harness.run).toHaveBeenCalledTimes(1));
    const second = bridge.sendMessage('second submit');
    await Promise.resolve();
    expect(harness.run).toHaveBeenCalledTimes(1);

    pending[0](createOutcome('first-conversation', 'first response'));
    await first;
    await vi.waitFor(() => expect(harness.run).toHaveBeenCalledTimes(2));
    pending[1](createOutcome('second-conversation', 'second response'));
    await second;

    expect(harness.run).toHaveBeenCalledTimes(2);
  });

  it('clears the mutation snapshot when yolo automatically accepts an edit', async () => {
    const { bridge, store } = createBridge();
    const path = 'C:/project/src/accepted.ts';
    addEditorFile(path, 'C:/project', true);
    const access = bridge as unknown as BridgeTestAccess;
    access.mutationSnapshots.set(path, {
      diskBefore: 'before',
      bufferBefore: 'before',
      wasDirty: true,
      tabId: `tab:${path}`,
    });
    useSettingsStore.setState({ approvalMode: 'yolo' });

    access.handleFileChangePending(
      {
        filePath: path,
        toolName: 'write_file',
        toolCallId: 'call-1',
        originalContent: 'before',
        newContent: 'after',
      },
      'turn-1',
    );
    await vi.waitFor(() => expect(store.getState().agentEditSessions[0]?.phase).toBe('accepted'));

    expect(access.mutationSnapshots.has(path)).toBe(false);
    expect(useEditorStore.getState().tabs.find((tab) => tab.id === `tab:${path}`)?.isDirty).toBe(
      false,
    );
    expect(store.getState().pendingFileChanges[0]?.status).toBe('accepted');
  });

  it('refuses to revert an edit when the on-disk revision changed after review began', async () => {
    const { bridge, store } = createBridge();
    const path = 'C:/project/src/revised.ts';
    const access = bridge as unknown as BridgeTestAccess;
    access.mutationSnapshots.set(path, {
      diskBefore: 'original content',
      bufferBefore: 'original content',
      wasDirty: false,
      tabId: null,
      expectedContent: 'agent content',
    });
    access.handleFileChangePending(
      {
        filePath: path,
        toolName: 'write_file',
        toolCallId: 'call-stale-review',
        originalContent: 'original content',
        newContent: 'agent content',
      },
      'turn-stale-review',
    );
    await vi.waitFor(() =>
      expect(store.getState().agentEditSessions[0]?.phase).toBe('pending_review'),
    );

    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'path_exists') return true;
      return null;
    });
    invokeRawMock.mockImplementation(async (command: string) => {
      if (command === 'read_file') return 'newer external content';
      return null;
    });

    await expect(
      bridge.resolveEditSession(store.getState().agentEditSessions[0]!.id, false),
    ).rejects.toThrow('refusing to revert');

    expect(invokeRawMock).not.toHaveBeenCalledWith(
      'write_file',
      expect.objectContaining({ path, content: 'original content' }),
    );
    expect(store.getState().agentEditSessions[0]?.phase).toBe('pending_review');
    expect(access.mutationSnapshots.has(path)).toBe(true);
  });

  it('refuses to restore over a file that disappeared after an edit', async () => {
    const { bridge, store } = createBridge();
    const path = 'C:/project/src/missing-after-edit.ts';
    const access = bridge as unknown as BridgeTestAccess;
    access.mutationSnapshots.set(path, {
      diskBefore: 'original content',
      bufferBefore: 'original content',
      wasDirty: false,
      tabId: null,
      expectedContent: 'agent content',
    });
    access.handleFileChangePending(
      {
        filePath: path,
        toolName: 'write_file',
        toolCallId: 'call-missing-review',
        originalContent: 'original content',
        newContent: 'agent content',
      },
      'turn-missing-review',
    );

    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'path_exists') return false;
      return null;
    });

    await expect(
      bridge.resolveEditSession(store.getState().agentEditSessions[0]!.id, false),
    ).rejects.toThrow('refusing to revert');

    expect(invokeRawMock).not.toHaveBeenCalledWith('write_file', expect.anything());
    expect(store.getState().agentEditSessions[0]?.phase).toBe('pending_review');
  });

  it('deletes an unchanged agent-created file when its edit is rejected', async () => {
    const { bridge, store } = createBridge();
    const path = 'C:/project/src/new-agent-file.ts';
    const access = bridge as unknown as BridgeTestAccess;
    access.mutationSnapshots.set(path, {
      diskBefore: null,
      bufferBefore: null,
      wasDirty: false,
      tabId: null,
      expectedContent: 'agent content',
    });
    access.handleFileChangePending(
      {
        filePath: path,
        toolName: 'write_file',
        toolCallId: 'call-new-file-review',
        originalContent: null,
        newContent: 'agent content',
      },
      'turn-new-file-review',
    );
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'path_exists') return true;
      return null;
    });
    invokeRawMock.mockImplementation(async (command: string) => {
      if (command === 'read_file') return 'agent content';
      return null;
    });

    await bridge.resolveEditSession(store.getState().agentEditSessions[0]!.id, false);

    expect(invokeRawMock).toHaveBeenCalledWith('delete_path', { path });
    expect(store.getState().agentEditSessions[0]?.phase).toBe('rejected');
  });

  it('restores a deleted file when the path is still absent', async () => {
    const { bridge, store } = createBridge();
    const path = 'C:/project/src/deleted-by-agent.ts';
    const access = bridge as unknown as BridgeTestAccess;
    access.mutationSnapshots.set(path, {
      diskBefore: 'original content',
      bufferBefore: 'original content',
      wasDirty: false,
      tabId: null,
      expectedContent: null,
    });
    access.handleFileChangePending(
      {
        filePath: path,
        toolName: 'delete_file',
        toolCallId: 'call-delete-review',
        originalContent: 'original content',
        newContent: '',
      },
      'turn-delete-review',
    );
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'path_exists') return false;
      return null;
    });

    await bridge.resolveEditSession(store.getState().agentEditSessions[0]!.id, false);

    expect(invokeRawMock).toHaveBeenCalledWith('write_file', {
      path,
      content: 'original content',
    });
    expect(store.getState().agentEditSessions[0]?.phase).toBe('rejected');
  });

  it('preserves completed assistant output when turn persistence fails', async () => {
    const { bridge, store } = createBridge();
    Object.assign(bridge, {
      commitTurn: vi.fn(async () => {
        throw new Error('SQLite unavailable');
      }),
    });

    await bridge.sendMessage('answer this');

    const assistant = [...store.getState().messages]
      .reverse()
      .find((message) => message.role === 'assistant');
    expect(assistant?.content).toBe('Assistant answer');
    expect(assistant?.isError).not.toBe(true);
  });
});

describe('resolveSubAgentMirrorTarget', () => {
  it('resolves direct spawn_subagent calls by tool-call id', () => {
    expect(resolveSubAgentMirrorTarget('call-1', 'spawn_subagent', () => undefined)).toEqual({
      spawnId: 'call-1',
    });
  });

  it('strips the :external suffix from nested dispatches', () => {
    expect(
      resolveSubAgentMirrorTarget('call-1:external', 'spawn_subagent', () => undefined),
    ).toEqual({ spawnId: 'call-1' });
  });

  it('resolves invoke_external_tool wrappers that target spawn_subagent', () => {
    const nestedInput = { task: 'Review this', mode: 'review' };
    const target = resolveSubAgentMirrorTarget('call-9', 'invoke_external_tool', (id) =>
      id === 'call-9' ? { name: 'spawn_subagent', input: nestedInput } : undefined,
    );
    expect(target).toEqual({ spawnId: 'call-9', nestedInput });
  });

  it('ignores invoke_external_tool wrappers around other tools', () => {
    expect(
      resolveSubAgentMirrorTarget('call-9', 'invoke_external_tool', () => ({
        name: 'read_file',
        input: {},
      })),
    ).toBeNull();
  });

  it('ignores unrelated tools', () => {
    expect(resolveSubAgentMirrorTarget('call-1', 'read_file', () => undefined)).toBeNull();
    expect(resolveSubAgentMirrorTarget('', 'spawn_subagent', () => undefined)).toBeNull();
  });
});

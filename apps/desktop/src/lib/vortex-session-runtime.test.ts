/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentStore, type AgentStoreApi } from '@/stores/agent-store';
import { useProjectStore } from '@/stores/project-store';

type PendingRun = {
  release: () => void;
};

type DatabaseConversationFixture = {
  id: string;
  title: string;
  mode: string;
  model_id: string | null;
  provider_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

type DatabaseMessageFixture = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls: string | null;
  blocks: string | null;
  turn_summary: string | null;
  created_at: string;
};

const { createSessionMock, pendingRuns, createdBridges, databaseConversations, databaseMessages } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  pendingRuns: new Map<string, PendingRun>(),
  createdBridges: [] as FakeHarnessBridge[],
  databaseConversations: new Map<string, DatabaseConversationFixture>(),
  databaseMessages: new Map<string, DatabaseMessageFixture[]>(),
}));

class FakeHarnessBridge {
  readonly store: AgentStoreApi;
  private currentMessage: string | null = null;
  private cancelled = false;

  constructor(store: AgentStoreApi) {
    this.store = store;
    createdBridges.push(this);
  }

  async loadSkills(): Promise<[]> {
    return [];
  }

  async registerMcpTools(): Promise<void> {}

  restoreSession(conversationId: string): void {
    this.store.getState().setConversationId(conversationId);
  }

  setAgentType(mode: Parameters<ReturnType<AgentStoreApi['getState']>['setMode']>[0]): void {
    this.store.getState().setMode(mode);
  }

  async sendMessage(message: string): Promise<void> {
    this.currentMessage = message;
    this.cancelled = false;
    this.store.getState().addMessage({
      id: `${message}-user`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });
    this.store.getState().setStreaming(true);
    await new Promise<void>((resolve) => {
      pendingRuns.set(message, { release: resolve });
    });
    this.store.getState().setStreaming(false);
    this.store.getState().setTerminalStatus(this.cancelled ? 'cancelled' : 'complete');
  }

  async retryTurn(): Promise<void> {
    await this.sendMessage('retry');
  }

  cancel(): void {
    this.cancelled = true;
    this.store.getState().setStreaming(false);
    if (this.currentMessage) pendingRuns.get(this.currentMessage)?.release();
  }

  dispose(): void {
    this.cancel();
  }
}

vi.mock('@/lib/harness-bridge', () => ({
  HarnessBridge: {
    createSession: createSessionMock,
  },
}));
vi.mock('@/lib/tauri-invoke', () => ({
  tauriInvoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const conversationId = typeof args?.conversationId === 'string' ? args.conversationId : null;
    if (command === 'db_get_conversation') {
      return conversationId ? databaseConversations.get(conversationId) ?? null : null;
    }
    if (command === 'db_list_messages') {
      return conversationId ? databaseMessages.get(conversationId) ?? [] : [];
    }
    throw new Error(`Unexpected command: ${command}`);
  }),
}));

import {
  getVortexRuntimeKey,
  useVortexRuntimeStore,
  VortexSessionRuntimeManager,
} from './vortex-session-runtime';

function release(message: string): void {
  pendingRuns.get(message)?.release();
}

describe('VortexSessionRuntimeManager', () => {
  beforeEach(() => {
    createSessionMock.mockReset().mockImplementation(async (_path: string, _projectId: string, store: AgentStoreApi) => {
      return new FakeHarnessBridge(store);
    });
    pendingRuns.clear();
    createdBridges.length = 0;
    databaseConversations.clear();
    databaseMessages.clear();
    useAgentStore.getState().resetProjectState();
    useProjectStore.setState({ rootPath: 'C:/project-a', isLoading: false });
    useVortexRuntimeStore.setState({ snapshots: {}, focusedKey: null });
  });

  it('runs two sessions concurrently in the same project with isolated stores', async () => {
    const manager = new VortexSessionRuntimeManager();
    await manager.focusSession('C:/project-a', 'session-a', { allowMissing: true });
    const first = manager.sendFocusedMessage('first');
    await vi.waitFor(() => expect(pendingRuns.has('first')).toBe(true));

    await manager.focusSession('C:/project-a', 'session-b', { allowMissing: true });
    const second = manager.sendFocusedMessage('second');
    await vi.waitFor(() => expect(pendingRuns.has('second')).toBe(true));

    expect(createdBridges).toHaveLength(2);
    expect(createdBridges[0].store).not.toBe(createdBridges[1].store);
    expect(useVortexRuntimeStore.getState().snapshots[getVortexRuntimeKey('C:/project-a', 'session-a')].status).toBe('running');
    expect(useVortexRuntimeStore.getState().snapshots[getVortexRuntimeKey('C:/project-a', 'session-b')].status).toBe('running');

    release('first');
    release('second');
    await Promise.all([first, second]);

    expect(useVortexRuntimeStore.getState().snapshots[getVortexRuntimeKey('C:/project-a', 'session-a')].status).toBe('completed');
    expect(useVortexRuntimeStore.getState().snapshots[getVortexRuntimeKey('C:/project-a', 'session-b')].status).toBe('completed');
    expect(createdBridges[0].store.getState().messages.map((message) => message.content)).toEqual(['first']);
    expect(createdBridges[1].store.getState().messages.map((message) => message.content)).toEqual(['second']);
  });

  it('reopens a persisted session after creating a new empty session and keeps its title', async () => {
    databaseConversations.set('session-old', {
      id: 'session-old',
      title: 'New Chat',
      mode: 'chat',
      model_id: null,
      provider_id: null,
      project_id: 'C:/project-a',
      created_at: '2026-08-04 10:00:00',
      updated_at: '2026-08-04 10:01:00',
    });
    databaseMessages.set('session-old', [
      {
        id: 'old-user',
        role: 'user',
        content: 'Investigate the existing VORTEX session',
        tool_calls: null,
        blocks: null,
        turn_summary: null,
        created_at: '2026-08-04 10:00:00',
      },
      {
        id: 'old-assistant',
        role: 'assistant',
        content: 'The persisted session is available.',
        tool_calls: null,
        blocks: null,
        turn_summary: null,
        created_at: '2026-08-04 10:01:00',
      },
    ]);

    const manager = new VortexSessionRuntimeManager();
    await manager.focusSession('C:/project-a', 'session-old');
    await manager.createAndFocus('C:/project-a');

    expect(useAgentStore.getState().conversationId).not.toBe('session-old');
    expect(useAgentStore.getState().messages).toHaveLength(0);
    expect(manager.getFocusedSnapshot()?.title).toBe('New Chat');

    await manager.focusSession('C:/project-a', 'session-old');

    expect(useAgentStore.getState().conversationId).toBe('session-old');
    expect(useAgentStore.getState().messages.map((message) => message.content)).toEqual([
      'Investigate the existing VORTEX session',
      'The persisted session is available.',
    ]);
    expect(manager.getFocusedSnapshot()?.title).toBe('Investigate the existing VORTEX session');
  });

  it('keeps the latest focus request when an older runtime hydrates later', async () => {
    let releaseOldRuntime!: () => void;
    const oldRuntimeReady = new Promise<void>((resolve) => {
      releaseOldRuntime = resolve;
    });
    createSessionMock.mockImplementation(async (_path: string, _projectId: string, store: AgentStoreApi) => {
      if (store.getState().conversationId === 'session-old') await oldRuntimeReady;
      return new FakeHarnessBridge(store);
    });

    const manager = new VortexSessionRuntimeManager();
    const oldFocus = manager.focusSession('C:/project-a', 'session-old', { allowMissing: true });
    await vi.waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));

    await manager.focusSession('C:/project-a', 'session-new', { allowMissing: true });
    expect(useAgentStore.getState().conversationId).toBe('session-new');

    releaseOldRuntime();
    await oldFocus;

    expect(useAgentStore.getState().conversationId).toBe('session-new');
    expect(manager.getFocusedSnapshot()?.conversationId).toBe('session-new');
  });

  it('keeps sessions in different projects running while focus changes', async () => {
    const manager = new VortexSessionRuntimeManager();
    await manager.focusSession('C:/project-a', 'session-a', { allowMissing: true });
    const first = manager.sendFocusedMessage('project-a');
    await vi.waitFor(() => expect(pendingRuns.has('project-a')).toBe(true));

    useProjectStore.setState({ rootPath: 'C:/project-b', isLoading: false });
    await manager.focusSession('C:/project-b', 'session-b', { allowMissing: true });
    const second = manager.sendFocusedMessage('project-b');
    await vi.waitFor(() => expect(pendingRuns.has('project-b')).toBe(true));

    const snapshots = useVortexRuntimeStore.getState().snapshots;
    expect(snapshots[getVortexRuntimeKey('C:/project-a', 'session-a')].status).toBe('running');
    expect(snapshots[getVortexRuntimeKey('C:/project-b', 'session-b')].status).toBe('running');
    expect(manager.getFocusedSnapshot()?.projectPath).toBe('C:/project-b');

    release('project-a');
    release('project-b');
    await Promise.all([first, second]);
    expect(createdBridges[0].store.getState().conversationId).toBe('session-a');
    expect(createdBridges[1].store.getState().conversationId).toBe('session-b');
  });

  it('cancels only the selected runtime and preserves the other run', async () => {
    const manager = new VortexSessionRuntimeManager();
    await manager.focusSession('C:/project-a', 'session-a', { allowMissing: true });
    const first = manager.sendFocusedMessage('cancel-me');
    await vi.waitFor(() => expect(pendingRuns.has('cancel-me')).toBe(true));

    await manager.focusSession('C:/project-a', 'session-b', { allowMissing: true });
    const second = manager.sendFocusedMessage('keep-me');
    await vi.waitFor(() => expect(pendingRuns.has('keep-me')).toBe(true));

    manager.cancelSession('C:/project-a', 'session-a');
    await first;

    expect(useVortexRuntimeStore.getState().snapshots[getVortexRuntimeKey('C:/project-a', 'session-a')].status).toBe('cancelled');
    expect(useVortexRuntimeStore.getState().snapshots[getVortexRuntimeKey('C:/project-a', 'session-b')].status).toBe('running');

    release('keep-me');
    await second;
    expect(useVortexRuntimeStore.getState().snapshots[getVortexRuntimeKey('C:/project-a', 'session-b')].status).toBe('completed');
  });

  it('projects the focused runtime without copying another session into it', async () => {
    const manager = new VortexSessionRuntimeManager();
    await manager.focusSession('C:/project-a', 'session-a', { allowMissing: true });
    useAgentStore.getState().addMessage({
      id: 'focused-a',
      role: 'user',
      content: 'Only A',
      timestamp: Date.now(),
    });
    expect(createdBridges[0].store.getState().messages.map((message) => message.content)).toEqual(['Only A']);

    await manager.focusSession('C:/project-a', 'session-b', { allowMissing: true });
    expect(useAgentStore.getState().conversationId).toBe('session-b');
    expect(useAgentStore.getState().messages).toHaveLength(0);
    expect(createdBridges[0].store.getState().messages.map((message) => message.content)).toEqual(['Only A']);
  });

  it('recreates a runtime after bridge initialization fails', async () => {
    const manager = new VortexSessionRuntimeManager();
    createSessionMock.mockRejectedValueOnce(new Error('Provider setup failed'));

    await expect(
      manager.focusSession('C:/project-a', 'session-a', { allowMissing: true }),
    ).rejects.toThrow('Provider setup failed');
    expect(
      useVortexRuntimeStore.getState().snapshots[getVortexRuntimeKey('C:/project-a', 'session-a')]
        .status,
    ).toBe('error');

    await manager.focusSession('C:/project-a', 'session-a', { allowMissing: true });
    expect(
      useVortexRuntimeStore.getState().snapshots[getVortexRuntimeKey('C:/project-a', 'session-a')]
        .status,
    ).toBe('idle');
    expect(createdBridges).toHaveLength(1);
  });
});

import { create } from 'zustand';
import { HarnessBridge } from './harness-bridge';
import { normalizeProjectPath, projectPathKey } from './project-path';
import { tauriInvoke } from './tauri-invoke';
import {
  createAgentStore,
  extractAgentStateData,
  type AgentMode,
  type AgentState,
  type AgentStoreApi,
  type ChatMessage,
} from '@/stores/agent-store';
import { useAgentStore } from '@/stores/agent-store';
import { useMemoryStore } from '@/stores/memory-store';
import { useProjectStore } from '@/stores/project-store';
import {
  isVortexRuntimeActive,
  type VortexRuntimeSnapshot,
  type VortexRuntimeStatus,
} from './vortex-runtime-types';
import {
  isPlaceholderVortexSessionTitle,
  resolveVortexSessionTitle,
} from './vortex-session-titles';

interface VortexRuntimeRegistryState {
  snapshots: Record<string, VortexRuntimeSnapshot>;
  focusedKey: string | null;
}

export const useVortexRuntimeStore = create<VortexRuntimeRegistryState>(() => ({
  snapshots: {},
  focusedKey: null,
}));

type RuntimeRecord = {
  key: string;
  projectPath: string;
  projectName: string;
  conversationId: string;
  title: string;
  mode: AgentMode;
  status: VortexRuntimeStatus;
  startedAt: number;
  updatedAt: number;
  error: string | null;
  hasRun: boolean;
  cancelRequested: boolean;
  agentStore: AgentStoreApi;
  bridge: HarnessBridge | null;
  unsubscribe: () => void;
};

type EnsureRuntimeOptions = {
  initialData?: Partial<AgentState>;
  title?: string;
  mode?: AgentMode;
  allowMissing?: boolean;
};

type DatabaseConversation = {
  id: string;
  title: string;
  mode: string;
  project_id: string | null;
};

type DatabaseMessage = {
  id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  blocks: string | null;
  turn_summary: string | null;
  created_at: string;
};

const AGENT_MODES: readonly AgentMode[] = ['chat', 'build', 'review', 'debug', 'plan'];

function toAgentMode(mode: string | undefined): AgentMode {
  return AGENT_MODES.includes(mode as AgentMode) ? (mode as AgentMode) : 'chat';
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function mapDatabaseMessage(row: DatabaseMessage): ChatMessage | null {
  if (row.role === 'system' || (row.role !== 'user' && row.role !== 'assistant')) return null;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    toolCalls: parseJson<ChatMessage['toolCalls']>(row.tool_calls),
    blocks: parseJson<NonNullable<ChatMessage['blocks']>>(row.blocks),
    turnSummary: parseJson<ChatMessage['turnSummary']>(row.turn_summary),
    timestamp: Date.parse(row.created_at),
  };
}

function projectNameFromPath(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts.at(-1) || path;
}

export function getVortexRuntimeKey(projectPath: string, conversationId: string): string {
  return `${projectPathKey(normalizeProjectPath(projectPath))}::${conversationId}`;
}

function isTerminalStatus(status: string | null): boolean {
  return status === 'cancelled' || status === 'cancelled_partial';
}

function isErrorStatus(status: string | null): boolean {
  return status === 'error' || status === 'recoverable_error' || status === 'loop_detected';
}

function lastAssistantError(state: AgentState): string | null {
  const message = [...state.messages].reverse().find((item) => item.role === 'assistant');
  return message?.isError ? message.content : null;
}

export class VortexSessionRuntimeManager {
  private readonly records = new Map<string, RuntimeRecord>();
  private readonly initialization = new Map<string, Promise<RuntimeRecord>>();
  private focusedKey: string | null = null;
  private focusGeneration = 0;
  private projectionSuspended = false;
  private projecting = false;
  private syncingFromUi = false;

  constructor() {
    useAgentStore.subscribe((state) => {
      if (this.projecting || this.projectionSuspended || !this.focusedKey) return;
      const record = this.records.get(this.focusedKey);
      if (!record) return;
      this.syncingFromUi = true;
      record.agentStore.setState(extractAgentStateData(state));
      this.syncingFromUi = false;
    });
  }

  getFocusedBridge(): HarnessBridge | null {
    return this.focusedKey ? (this.records.get(this.focusedKey)?.bridge ?? null) : null;
  }

  getFocusedSnapshot(): VortexRuntimeSnapshot | null {
    if (!this.focusedKey) return null;
    return useVortexRuntimeStore.getState().snapshots[this.focusedKey] ?? null;
  }

  hasActiveRuntimes(): boolean {
    return Object.values(useVortexRuntimeStore.getState().snapshots).some((snapshot) =>
      ['starting', 'queued', 'running', 'waiting', 'cancelling'].includes(snapshot.status),
    );
  }

  getSnapshot(projectPath: string, conversationId: string): VortexRuntimeSnapshot | null {
    return useVortexRuntimeStore.getState().snapshots[getVortexRuntimeKey(projectPath, conversationId)] ?? null;
  }

  suspendProjection(): void {
    this.projectionSuspended = true;
  }

  clearFocus(): void {
    this.focusGeneration += 1;
    this.focusedKey = null;
    useVortexRuntimeStore.setState({ focusedKey: null });
  }

  resumeProjection(): void {
    this.projectionSuspended = false;
    if (this.focusedKey) {
      const record = this.records.get(this.focusedKey);
      if (record) this.projectRuntimeToUi(record);
    }
  }

  async focusSession(
    projectPath: string,
    conversationId: string,
    options: EnsureRuntimeOptions = {},
  ): Promise<HarnessBridge> {
    const focusGeneration = ++this.focusGeneration;
    const normalizedPath = normalizeProjectPath(projectPath);
    const record = await this.ensureRuntime(normalizedPath, conversationId, options);
    if (focusGeneration !== this.focusGeneration) {
      if (!record.bridge) throw new Error('The VORTEX session runtime is not ready.');
      return record.bridge;
    }
    this.projectionSuspended = false;
    this.focusedKey = record.key;
    useVortexRuntimeStore.setState({ focusedKey: record.key });
    this.projectRuntimeToUi(record);
    if (!record.bridge) throw new Error('The VORTEX session runtime is not ready.');
    return record.bridge;
  }

  async createAndFocus(projectPath: string): Promise<{ conversationId: string; bridge: HarnessBridge }> {
    const conversationId = crypto.randomUUID();
    const bridge = await this.focusSession(projectPath, conversationId, {
      allowMissing: true,
      mode: 'chat',
      title: 'New Chat',
    });
    return { conversationId, bridge };
  }

  private async ensureFocusedRuntime(): Promise<RuntimeRecord> {
    const projectPath = useProjectStore.getState().rootPath;
    if (!projectPath) throw new Error('Open a project before starting an agent session.');
    let conversationId = useAgentStore.getState().conversationId;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      useAgentStore.getState().setConversationId(conversationId);
    }
    const existing = this.records.get(getVortexRuntimeKey(projectPath, conversationId));
    const initialData = existing ? undefined : extractAgentStateData(useAgentStore.getState());
    await this.focusSession(projectPath, conversationId, { initialData, allowMissing: true });
    const record = this.records.get(getVortexRuntimeKey(projectPath, conversationId));
    if (!record) throw new Error('The VORTEX session runtime could not be created.');
    return record;
  }

  async sendFocusedMessage(
    userMessage: string,
    options: { hidden?: boolean; excludeLastAssistantFromHistory?: boolean } = {},
  ): Promise<void> {
    const record = await this.ensureFocusedRuntime();
    if (!record.bridge) throw new Error('The VORTEX session runtime is not ready.');
    if (isVortexRuntimeActive(record.status)) return;

    record.hasRun = true;
    record.cancelRequested = false;
    record.error = null;
    record.status = 'queued';
    record.updatedAt = Date.now();
    this.publish(record);

    try {
      await record.bridge.sendMessage(userMessage, options);
      this.finishRun(record);
    } catch (error) {
      record.status = 'error';
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = Date.now();
      this.publish(record);
      throw error;
    }
  }

  async setFocusedAgentType(mode: AgentMode): Promise<void> {
    const record = await this.ensureFocusedRuntime();
    record.bridge?.setAgentType(mode);
  }

  cancelSession(projectPath: string, conversationId: string): void {
    const record = this.records.get(getVortexRuntimeKey(projectPath, conversationId));
    if (!record?.bridge || !['starting', 'queued', 'running', 'waiting'].includes(record.status)) return;
    record.cancelRequested = true;
    record.status = 'cancelling';
    record.updatedAt = Date.now();
    this.publish(record);
    record.bridge.cancel();
  }

  updateSessionTitle(projectPath: string, conversationId: string, title: string): void {
    const record = this.records.get(getVortexRuntimeKey(projectPath, conversationId));
    if (!record) return;
    record.title = title;
    record.agentStore.getState().updateTabTitle(record.agentStore.getState().activeTabId, title);
    record.updatedAt = Date.now();
    this.publish(record);
  }

  forgetSession(projectPath: string, conversationId: string): void {
    const key = getVortexRuntimeKey(projectPath, conversationId);
    const record = this.records.get(key);
    if (!record) return;
    record.bridge?.dispose();
    record.unsubscribe();
    this.records.delete(key);
    useVortexRuntimeStore.setState((registry) => {
      const snapshots = { ...registry.snapshots };
      delete snapshots[key];
      return {
        snapshots,
        focusedKey: registry.focusedKey === key ? null : registry.focusedKey,
      };
    });
    if (this.focusedKey === key) {
      this.focusedKey = null;
      this.projecting = true;
      useAgentStore.getState().resetProjectState();
      this.projecting = false;
    }
  }

  async retrySession(projectPath: string, conversationId: string): Promise<void> {
    const record = await this.ensureRuntime(normalizeProjectPath(projectPath), conversationId, {
      allowMissing: true,
    });
    await this.retryRecord(record);
  }

  async retryFocusedSession(): Promise<void> {
    const record = await this.ensureFocusedRuntime();
    await this.retryRecord(record);
  }

  async continueFocusedSession(): Promise<void> {
    const record = await this.ensureFocusedRuntime();
    if (!record.bridge) throw new Error('The VORTEX session runtime is not ready.');
    const recovery = record.agentStore.getState().recoverableError;
    if (!recovery || recovery.action !== 'continue') {
      throw new Error('The VORTEX session has no partial response to continue.');
    }
    record.hasRun = true;
    record.cancelRequested = false;
    record.status = 'queued';
    record.error = null;
    record.updatedAt = Date.now();
    this.publish(record);
    try {
      await record.bridge.continuePartialTurn();
      this.finishRun(record);
    } catch (cause) {
      record.status = 'error';
      record.error = cause instanceof Error ? cause.message : 'The VORTEX continuation failed.';
      record.updatedAt = Date.now();
      this.publish(record);
      throw cause;
    }
  }

  private async retryRecord(record: RuntimeRecord): Promise<void> {
    if (!record.bridge) throw new Error('The VORTEX session runtime is not ready.');
    if (isVortexRuntimeActive(record.status)) return;
    record.hasRun = true;
    record.cancelRequested = false;
    record.status = 'queued';
    record.error = null;
    record.updatedAt = Date.now();
    this.publish(record);
    try {
      const state = record.agentStore.getState();
      const lastUserMessage = [...state.messages].reverse().find((message) => message.role === 'user');
      if (!lastUserMessage) throw new Error('There is no user message to retry.');
      if (state.recoverableError) await record.bridge.retryTurn();
      else {
        await record.bridge.sendMessage(lastUserMessage.content, {
          hidden: true,
          excludeLastAssistantFromHistory: true,
        });
      }
      this.finishRun(record);
    } catch (cause) {
      record.status = 'error';
      record.error = cause instanceof Error ? cause.message : 'The VORTEX session retry failed.';
      record.updatedAt = Date.now();
      this.publish(record);
      throw cause;
    }
  }

  private async ensureRuntime(
    projectPath: string,
    conversationId: string,
    options: EnsureRuntimeOptions,
  ): Promise<RuntimeRecord> {
    const key = getVortexRuntimeKey(projectPath, conversationId);
    const pending = this.initialization.get(key);
    if (pending) return pending;

    const existing = this.records.get(key);
    if (existing?.bridge) return existing;
    if (existing) {
      existing.unsubscribe();
      this.records.delete(key);
      useVortexRuntimeStore.setState((registry) => {
        const snapshots = { ...registry.snapshots };
        delete snapshots[key];
        return { snapshots, focusedKey: registry.focusedKey };
      });
    }

    const promise = this.initializeRuntime(projectPath, conversationId, options);
    this.initialization.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.initialization.get(key) === promise) this.initialization.delete(key);
    }
  }

  private async initializeRuntime(
    projectPath: string,
    conversationId: string,
    options: EnsureRuntimeOptions,
  ): Promise<RuntimeRecord> {
    const key = getVortexRuntimeKey(projectPath, conversationId);
    const agentStore = createAgentStore();
    const databaseConversation = options.initialData
      ? null
      : await this.hydrateStoreFromDatabase(agentStore, projectPath, conversationId, options.allowMissing === true);

    if (options.initialData) agentStore.setState(options.initialData);
    if (!agentStore.getState().conversationId) agentStore.getState().setConversationId(conversationId);

    const storeState = agentStore.getState();
    const title = resolveVortexSessionTitle({
      explicitTitle: options.title,
      persistedTitle: databaseConversation?.title,
      tabTitle: storeState.openTabs.find((tab) => tab.id === storeState.activeTabId)?.title,
      firstUserMessage: storeState.messages.find((message) => message.role === 'user')?.content,
    });
    const mode = options.mode ?? storeState.mode ?? toAgentMode(databaseConversation?.mode);
    agentStore.getState().setMode(mode);
    agentStore.getState().updateTabTitle(agentStore.getState().activeTabId, title);

    const now = Date.now();
    const record: RuntimeRecord = {
      key,
      projectPath,
      projectName: projectNameFromPath(projectPath),
      conversationId,
      title,
      mode,
      status: 'starting',
      startedAt: now,
      updatedAt: now,
      error: null,
      hasRun: false,
      cancelRequested: false,
      agentStore,
      bridge: null,
      unsubscribe: () => undefined,
    };
    this.records.set(key, record);
    record.unsubscribe = agentStore.subscribe(() => this.handleRuntimeStoreChange(record));
    this.publish(record);

    try {
      const bridge = await HarnessBridge.createSession(projectPath, projectPath, agentStore);
      record.bridge = bridge;
      await bridge.loadSkills();
      await bridge.registerMcpTools();
      bridge.restoreSession(conversationId);
      record.status = 'idle';
      record.updatedAt = Date.now();
      this.publish(record);
      return record;
    } catch (error) {
      record.status = 'error';
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = Date.now();
      this.publish(record);
      throw error;
    }
  }

  private async hydrateStoreFromDatabase(
    store: AgentStoreApi,
    projectPath: string,
    conversationId: string,
    allowMissing: boolean,
  ): Promise<DatabaseConversation | null> {
    const conversation = await tauriInvoke('db_get_conversation', {
      conversationId,
    });
    if (!conversation) {
      if (allowMissing) return null;
      throw new Error('The selected session is no longer available.');
    }
    if (conversation.project_id && projectPathKey(conversation.project_id) !== projectPathKey(projectPath)) {
      throw new Error('The selected session belongs to a different project.');
    }
    store.getState().setMode(toAgentMode(conversation.mode));
    store.getState().setConversationId(conversationId);
    store.getState().updateTabTitle(store.getState().activeTabId, conversation.title || 'Conversation');
    const rows = await tauriInvoke('db_list_messages', { conversationId });
    for (const row of rows) {
      const message = mapDatabaseMessage(row);
      if (!message) continue;
      store.getState().addMessage(message);
      if (message.turnSummary) store.getState().hydrateTurnSummary(message.turnSummary);
    }
    return conversation;
  }

  private handleRuntimeStoreChange(record: RuntimeRecord): void {
    const state = record.agentStore.getState();
    if (state.pendingApprovals.length > 0 || state.pendingUserQuestion) record.status = 'waiting';
    else if (state.isStreaming && record.status !== 'cancelling') record.status = 'running';
    record.mode = state.mode;
    const tabTitle = state.openTabs.find((tab) => tab.id === state.activeTabId)?.title;
    if (tabTitle && (!isPlaceholderVortexSessionTitle(tabTitle) || isPlaceholderVortexSessionTitle(record.title))) {
      record.title = tabTitle;
    }
    record.updatedAt = Date.now();
    this.publish(record);
    if (this.focusedKey === record.key && !this.projectionSuspended && !this.syncingFromUi) {
      this.projectRuntimeToUi(record);
    }
  }

  private finishRun(record: RuntimeRecord): void {
    const state = record.agentStore.getState();
    const terminalStatus = state.terminalStatus;
    if (record.cancelRequested || isTerminalStatus(terminalStatus)) record.status = 'cancelled';
    else if (state.recoverableError || isErrorStatus(terminalStatus) || lastAssistantError(state)) {
      record.status = 'error';
      record.error = state.recoverableError?.error.userMessage ?? lastAssistantError(state);
    } else record.status = 'completed';
    record.cancelRequested = false;
    record.updatedAt = Date.now();
    this.publish(record);
  }

  private publish(record: RuntimeRecord): void {
    const state = record.agentStore.getState();
    const next: VortexRuntimeSnapshot = {
      key: record.key,
      projectPath: record.projectPath,
      projectName: record.projectName,
      conversationId: record.conversationId,
      title: record.title,
      mode: record.mode,
      status: record.status,
      messageCount: state.messages.length,
      pendingApprovals: state.pendingApprovals.length,
      pendingUserQuestion: state.pendingUserQuestion !== null,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      error: record.error,
    };
    const current = useVortexRuntimeStore.getState().snapshots[record.key];
    if (
      current &&
      current.title === next.title &&
      current.mode === next.mode &&
      current.status === next.status &&
      current.messageCount === next.messageCount &&
      current.pendingApprovals === next.pendingApprovals &&
      current.pendingUserQuestion === next.pendingUserQuestion &&
      current.error === next.error
    ) {
      return;
    }
    useVortexRuntimeStore.setState((registry) => ({
      snapshots: { ...registry.snapshots, [record.key]: next },
      focusedKey: registry.focusedKey,
    }));
  }

  private projectRuntimeToUi(record: RuntimeRecord): void {
    this.projecting = true;
    useMemoryStore.getState().setProjectId(record.projectPath);
    useAgentStore.setState(extractAgentStateData(record.agentStore.getState()));
    this.projecting = false;
  }
}

export const vortexSessionRuntimeManager = new VortexSessionRuntimeManager();

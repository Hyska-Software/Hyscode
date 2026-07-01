import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  AgentType,
  SddStatus,
  SddTask,
  ModeSwitchRequest,
  AgentQuestion,
  TurnTerminalStatus,
} from '@hyscode/agent-harness';
import type { MessageContent, TokenUsage } from '@hyscode/ai-providers';
import type { ProviderErrorDetails } from '@hyscode/ai-providers';

export type { TokenUsage };

export type AgentConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'retry_wait'
  | 'offline'
  | 'degraded';
export type AgentTurnError = {
  error: ProviderErrorDetails;
  action: 'continue' | 'retry';
  partialText: string;
  retryCount: number;
  possibleDuplicateCharge: boolean;
};

// ─── Types ──────────────────────────────────────────────────────────────────

/** AgentMode mirrors AgentType — single source of truth for active agent. */
export type AgentMode = 'chat' | 'build' | 'review' | 'debug' | 'plan';

/** State for an active or completed sub-agent task. */
export interface SubAgentState {
  id: string;
  task: string;
  mode: AgentMode;
  status: 'running' | 'done' | 'error';
  output: string;
  toolCalls: ToolCallDisplay[];
  startedAt: number;
  completedAt?: number;
}

/** All per-conversation state fields (mirrored to flat AgentState fields for active tab). */
export interface PerTabState {
  mode: AgentMode;
  conversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  contextFiles: string[];
  attachedImages: AttachedImage[];
  gatheredContext: Array<{ path: string; relevance: number; tokenEstimate: number }>;
  pendingToolCalls: ToolCallDisplay[];
  pendingApprovals: PendingApproval[];
  pendingFileChanges: PendingFileChange[];
  agentEditSessions: AgentEditSession[];
  sddPhase: import('@hyscode/agent-harness').SddStatus | null;
  sddSpec: string | null;
  sddTasks: import('@hyscode/agent-harness').SddTask[];
  sddProgress: number;
  sddFailedTask: import('@hyscode/agent-harness').SddTask | null;
  tokenUsage: TokenUsage | null;
  sessionTokenUsage: TokenUsage | null;
  apiRequestCount: number;
  lastApiRequestAt: number | null;
  agentTasks: Array<{ id: number; title: string; status: string }>;
  pendingModeSwitch: import('@hyscode/agent-harness').ModeSwitchRequest | null;
  delegationChain: Array<{ fromMode: AgentMode; toMode: AgentMode; reason: string }>;
  pendingUserQuestion: PendingUserQuestion | null;
  /** Active and completed sub-agent tasks spawned during this conversation. */
  subAgents: SubAgentState[];
  terminalStatus: TurnTerminalStatus | null;
  connectionState: AgentConnectionState;
  connectionMessage: string | null;
  recoverableError: AgentTurnError | null;
}

export interface TabMeta {
  id: string;
  title: string;
}

export function defaultPerTabState(mode: AgentMode = 'chat'): PerTabState {
  return {
    mode,
    conversationId: null,
    messages: [],
    isStreaming: false,
    streamingText: '',
    contextFiles: [],
    attachedImages: [],
    gatheredContext: [],
    pendingToolCalls: [],
    pendingApprovals: [],
    pendingFileChanges: [],
    agentEditSessions: [],
    sddPhase: null,
    sddSpec: null,
    sddTasks: [],
    sddProgress: 0,
    sddFailedTask: null,
    tokenUsage: null,
    sessionTokenUsage: null,
    apiRequestCount: 0,
    lastApiRequestAt: null,
    agentTasks: [],
    pendingModeSwitch: null,
    delegationChain: [],
    pendingUserQuestion: null,
    subAgents: [],
    terminalStatus: null,
    connectionState: 'idle',
    connectionMessage: null,
    recoverableError: null,
  };
}
export type MessageRole = 'user' | 'assistant' | 'tool';

export interface ToolCallDisplay {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'approved' | 'running' | 'cancelling' | 'success' | 'error';
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  thinking?: string;
  toolCalls?: ToolCallDisplay[];
  /** When true, `content` is a user-facing error message to render in the error UI. */
  isError?: boolean;
  /** Structured LLM content blocks for faithful history reconstruction.
   *  When present, buildHistory() uses these instead of `content` string. */
  blocks?: MessageContent[];
  timestamp: number;
}

export interface PendingApproval {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  description: string;
}

export type FileChangeStatus = 'pending' | 'accepted' | 'rejected';

/** @deprecated Use AgentEditSession instead */
export interface PendingFileChange {
  id: string;
  filePath: string;
  toolName: string;
  toolCallId: string;
  /** null when the file was newly created */
  originalContent: string | null;
  newContent: string;
  status: FileChangeStatus;
}

// ─── Agent Edit Session ─────────────────────────────────────────────────────

export type AgentEditPhase = 'streaming' | 'pending_review' | 'accepted' | 'rejected';

export interface DiffHunk {
  type: 'add' | 'modify' | 'delete';
  /** 1-based start line in the new content */
  newStart: number;
  newLines: number;
  /** 1-based start line in the original content */
  oldStart: number;
  oldLines: number;
}

export interface AgentEditSession {
  id: string;
  filePath: string;
  toolName: string;
  toolCallId: string;
  /** null when the file was newly created */
  originalContent: string | null;
  /** Original on-disk content; differs from originalContent when Monaco was dirty. */
  diskOriginalContent?: string | null;
  wasDirty?: boolean;
  /** Content as it should appear after the edit */
  newContent: string;
  /** Current phase of the edit lifecycle */
  phase: AgentEditPhase;
  /** true if the file did not exist before this edit */
  isNewFile: boolean;
  /** Precomputed diff hunks for decoration */
  hunks: DiffHunk[];
  /** Timestamp of creation */
  createdAt: number;
}

export interface AttachedImage {
  id: string;
  name: string;
  base64: string;
  mediaType: string;
  previewUrl: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  mode: AgentMode;
  modelId: string | null;
  providerId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PendingUserQuestion {
  id: string;
  title?: string;
  questions: AgentQuestion[];
}

// ─── State ──────────────────────────────────────────────────────────────────

interface AgentState {
  // Core — mode IS the agent type (single source of truth)
  mode: AgentMode;
  conversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  contextFiles: string[];
  attachedImages: AttachedImage[];

  // Agent gathered context (working memory)
  gatheredContext: Array<{ path: string; relevance: number; tokenEstimate: number }>;

  // Tool calls & approval
  pendingToolCalls: ToolCallDisplay[];
  pendingApprovals: PendingApproval[];

  // Agent file changes (write-through with visual tracking)
  pendingFileChanges: PendingFileChange[];
  /** New session-based agent edit tracking */
  agentEditSessions: AgentEditSession[];

  // SDD (Spec-Driven Development)
  sddPhase: SddStatus | null;
  sddSpec: string | null;
  sddTasks: SddTask[];
  sddProgress: number; // 0-100
  sddFailedTask: SddTask | null;

  // Token usage
  tokenUsage: TokenUsage | null;
  /** Cumulative token usage across all turns in the current conversation. */
  sessionTokenUsage: TokenUsage | null;

  // API request / credit tracking (per-turn counter, reset each conversation)
  apiRequestCount: number;
  /** Timestamp of last API request for UI display */
  lastApiRequestAt: number | null;

  // Agent task tracking
  agentTasks: Array<{ id: number; title: string; status: string }>;

  // Mode switch / delegation
  pendingModeSwitch: ModeSwitchRequest | null;
  delegationChain: Array<{ fromMode: AgentMode; toMode: AgentMode; reason: string }>;

  // User questions (ask_user tool)
  pendingUserQuestion: PendingUserQuestion | null;
  terminalStatus: TurnTerminalStatus | null;
  connectionState: AgentConnectionState;
  connectionMessage: string | null;
  recoverableError: AgentTurnError | null;

  // ─── Multi-tab management ─────────────────────────────────────────────
  /** Ordered list of open tabs (visible in the switcher). */
  openTabs: TabMeta[];
  /** Currently visible tab id. */
  activeTabId: string;
  /** Cached state for background tabs (keyed by tab id). */
  tabStates: Record<string, PerTabState>;
  /** Open a new empty tab; returns the new tab id. */
  openNewTab: (mode?: AgentMode) => string;
  /** Switch active tab (blocked while isStreaming). */
  switchTab: (id: string) => void;
  /** Close tab by id. Activates the nearest remaining tab. */
  closeTab: (id: string) => void;
  /** Update a tab's display title. */
  updateTabTitle: (id: string, title: string) => void;
  /** Load previously saved tabs into the store (called on app init). */
  loadSavedTabs: (
    tabs: Array<{
      id: string;
      title: string;
      conversationId: string | null;
      mode: AgentMode;
      messages: ChatMessage[];
    }>,
  ) => void;

  // Session history
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  historyOpen: boolean;

  // ─── Debug ────────────────────────────────────────────────────────────
  debugLines: string[];
  debugExpanded: boolean;
  addDebugLine: (line: string) => void;
  clearDebugLines: () => void;
  setDebugExpanded: (v: boolean) => void;

  // ─── Actions ──────────────────────────────────────────────────────────

  setMode: (mode: AgentMode) => void;
  /** @deprecated Use setMode() instead. Kept as alias for compatibility. */
  setAgentType: (type: AgentType) => void;
  setConversationId: (id: string) => void;
  addMessage: (message: ChatMessage) => void;
  updateLastAssistantContent: (content: string) => void;
  updateLastAssistantError: (errorMessage: string) => void;
  appendStreamingText: (text: string) => void;
  appendThinkingText: (text: string) => void;
  flushStreamingText: () => void;
  setStreaming: (streaming: boolean) => void;
  addContextFile: (path: string) => void;
  removeContextFile: (path: string) => void;
  addAttachedImage: (img: AttachedImage) => void;
  removeAttachedImage: (id: string) => void;
  clearAttachedImages: () => void;
  setGatheredContext: (
    entries: Array<{ path: string; relevance: number; tokenEstimate: number }>,
  ) => void;
  addGatheredContextFile: (entry: {
    path: string;
    relevance: number;
    tokenEstimate: number;
  }) => void;
  removeGatheredContextFile: (path: string) => void;
  clearConversation: () => void;

  // Tool calls
  addToolCall: (tc: ToolCallDisplay) => void;
  updateToolCall: (id: string, patch: Partial<ToolCallDisplay>) => void;

  // Approvals
  addPendingApproval: (approval: PendingApproval) => void;
  removePendingApproval: (id: string) => void;

  // File changes
  addPendingFileChange: (change: PendingFileChange) => void;
  resolvePendingFileChange: (id: string, accepted: boolean) => void;
  resolveAllPendingFileChanges: (accepted: boolean) => void;

  // Agent edit sessions
  upsertEditSession: (session: AgentEditSession) => void;
  resolveEditSession: (id: string, accepted: boolean) => void;
  resolveAllEditSessions: (accepted: boolean) => void;

  // SDD
  setSddPhase: (phase: SddStatus | null) => void;
  setSddSpec: (spec: string | null) => void;
  setSddTasks: (tasks: SddTask[]) => void;
  updateSddTask: (id: string, patch: Partial<SddTask>) => void;
  setSddProgress: (progress: number) => void;
  setSddFailedTask: (task: SddTask | null) => void;

  // Token usage
  setTokenUsage: (usage: TokenUsage | null) => void;
  setSessionTokenUsage: (usage: TokenUsage | null) => void;

  // API request / credit tracking
  incrementApiRequestCount: () => void;
  resetApiRequestCount: () => void;

  // Agent task tracking
  setAgentTasks: (tasks: Array<{ id: number; title: string; status: string }>) => void;

  // Mode switch / delegation
  setPendingModeSwitch: (request: ModeSwitchRequest | null) => void;
  resolveModeSwitch: (approved: boolean) => void;

  // User questions (ask_user tool)
  setPendingUserQuestion: (question: PendingUserQuestion | null) => void;
  setTerminalStatus: (status: TurnTerminalStatus | null) => void;
  setConnectionState: (state: AgentConnectionState, message?: string | null) => void;
  setRecoverableError: (error: AgentTurnError | null) => void;

  // Sub-agents
  subAgents: SubAgentState[];
  addSubAgent: (agent: SubAgentState) => void;
  updateSubAgent: (id: string, patch: Partial<SubAgentState>) => void;

  // Session history
  setSessions: (sessions: SessionSummary[]) => void;
  setSessionsLoading: (loading: boolean) => void;
  setHistoryOpen: (open: boolean) => void;
  deleteSession: (id: string) => void;
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useAgentStore = create<AgentState>()(
  immer((set) => ({
    // Defaults
    mode: 'chat',
    conversationId: null,
    messages: [],
    isStreaming: false,
    streamingText: '',
    pendingToolCalls: [],
    pendingApprovals: [],
    pendingFileChanges: [],
    agentEditSessions: [],
    contextFiles: [],
    attachedImages: [],
    gatheredContext: [],
    sddPhase: null,
    sddSpec: null,
    sddTasks: [],
    sddProgress: 0,
    sddFailedTask: null,
    tokenUsage: null,
    sessionTokenUsage: null,
    apiRequestCount: 0,
    lastApiRequestAt: null,
    agentTasks: [],
    pendingModeSwitch: null,
    delegationChain: [],
    pendingUserQuestion: null,
    subAgents: [],
    terminalStatus: null,
    connectionState: 'idle',
    connectionMessage: null,
    recoverableError: null,
    sessions: [],
    sessionsLoading: false,
    historyOpen: false,

    // ─── Multi-tab initialization (one default tab) ──────────────────
    openTabs: [{ id: '__default__', title: 'New Chat' }],
    activeTabId: '__default__',
    tabStates: {},

    // Debug
    debugLines: [],
    debugExpanded: false,

    // ─── Core Actions ─────────────────────────────────────────────────

    setMode: (mode) =>
      set((state) => {
        state.mode = mode;
      }),

    setAgentType: (type) =>
      set((state) => {
        state.mode = type as AgentMode;
      }),

    setConversationId: (id) =>
      set((state) => {
        state.conversationId = id;
      }),

    addMessage: (message) =>
      set((state) => {
        state.messages.push(message);
      }),

    updateLastAssistantContent: (content) =>
      set((state) => {
        const last = state.messages[state.messages.length - 1];
        if (last?.role === 'assistant') {
          last.content = content;
          last.isError = false;
        }
      }),

    updateLastAssistantError: (errorMessage) =>
      set((state) => {
        const last = state.messages[state.messages.length - 1];
        if (last?.role === 'assistant') {
          last.content = errorMessage;
          last.isError = true;
        }
      }),

    appendStreamingText: (text) =>
      set((state) => {
        state.streamingText += text;
        // Also update the last assistant message content in the same mutation
        // to avoid a second set() call per token
        const last = state.messages[state.messages.length - 1];
        if (last?.role === 'assistant') {
          last.content = state.streamingText;
        }
      }),

    appendThinkingText: (text) =>
      set((state) => {
        const last = state.messages[state.messages.length - 1];
        if (last?.role === 'assistant') {
          last.thinking = (last.thinking ?? '') + text;
        }
      }),

    flushStreamingText: () =>
      set((state) => {
        if (!state.streamingText) return;
        const last = state.messages[state.messages.length - 1];
        if (last?.role === 'assistant') {
          last.content = state.streamingText;
        } else {
          state.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: state.streamingText,
            timestamp: Date.now(),
          });
        }
        state.streamingText = '';
      }),

    setStreaming: (streaming) =>
      set((state) => {
        state.isStreaming = streaming;
        if (!streaming) {
          state.streamingText = '';
        }
      }),

    addContextFile: (path) =>
      set((state) => {
        if (!state.contextFiles.includes(path)) {
          state.contextFiles.push(path);
        }
      }),

    removeContextFile: (path) =>
      set((state) => {
        state.contextFiles = state.contextFiles.filter((f) => f !== path);
      }),

    addAttachedImage: (img) =>
      set((state) => {
        state.attachedImages.push(img);
      }),

    removeAttachedImage: (id) =>
      set((state) => {
        const img = state.attachedImages.find((i) => i.id === id);
        if (img?.previewUrl) URL.revokeObjectURL(img.previewUrl);
        state.attachedImages = state.attachedImages.filter((i) => i.id !== id);
      }),

    clearAttachedImages: () =>
      set((state) => {
        for (const img of state.attachedImages) {
          if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
        }
        state.attachedImages = [];
      }),

    setGatheredContext: (entries) =>
      set((state) => {
        state.gatheredContext = entries;
      }),

    addGatheredContextFile: (entry) =>
      set((state) => {
        const idx = state.gatheredContext.findIndex((g) => g.path === entry.path);
        if (idx >= 0) {
          state.gatheredContext[idx] = entry;
        } else {
          state.gatheredContext.push(entry);
        }
      }),

    removeGatheredContextFile: (path) =>
      set((state) => {
        state.gatheredContext = state.gatheredContext.filter((g) => g.path !== path);
      }),

    clearConversation: () =>
      set((state) => {
        state.messages = [];
        state.conversationId = null;
        state.pendingToolCalls = [];
        state.pendingApprovals = [];
        state.pendingFileChanges = [];
        state.agentEditSessions = [];
        state.contextFiles = [];
        state.attachedImages = [];
        state.gatheredContext = [];
        state.streamingText = '';
        state.sddPhase = null;
        state.sddSpec = null;
        state.sddTasks = [];
        state.sddProgress = 0;
        state.sddFailedTask = null;
        state.tokenUsage = null;
        state.sessionTokenUsage = null;
        state.apiRequestCount = 0;
        state.lastApiRequestAt = null;
        state.agentTasks = [];
        state.pendingModeSwitch = null;
        state.delegationChain = [];
        state.pendingUserQuestion = null;
      }),

    // ─── Tool Calls ──────────────────────────────────────────────────

    addToolCall: (tc) =>
      set((state) => {
        state.pendingToolCalls.push(tc);
        // Also attach to last assistant message
        const last = state.messages[state.messages.length - 1];
        if (last?.role === 'assistant') {
          if (!last.toolCalls) last.toolCalls = [];
          last.toolCalls.push(tc);
        }
      }),

    updateToolCall: (id, patch) =>
      set((state) => {
        const tc = state.pendingToolCalls.find((t) => t.id === id);
        if (tc) Object.assign(tc, patch);
        // Also update in message
        for (const msg of state.messages) {
          const msgTc = msg.toolCalls?.find((t) => t.id === id);
          if (msgTc) Object.assign(msgTc, patch);
        }
      }),

    // ─── Approvals ───────────────────────────────────────────────────

    addPendingApproval: (approval) =>
      set((state) => {
        state.pendingApprovals.push(approval);
      }),

    removePendingApproval: (id) =>
      set((state) => {
        state.pendingApprovals = state.pendingApprovals.filter((a) => a.id !== id);
      }),

    // ─── File Changes ────────────────────────────────────────────────

    addPendingFileChange: (change) =>
      set((state) => {
        // Collapse: if same filePath already pending, update newContent in place
        const existing = state.pendingFileChanges.find(
          (c) => c.filePath === change.filePath && c.status === 'pending',
        );
        if (existing) {
          existing.newContent = change.newContent;
          existing.toolCallId = change.toolCallId;
        } else {
          state.pendingFileChanges.push(change);
        }
      }),

    resolvePendingFileChange: (id, accepted) =>
      set((state) => {
        const change = state.pendingFileChanges.find((c) => c.id === id);
        if (change) {
          change.status = accepted ? 'accepted' : 'rejected';
        }
      }),

    resolveAllPendingFileChanges: (accepted) =>
      set((state) => {
        for (const change of state.pendingFileChanges) {
          if (change.status === 'pending') {
            change.status = accepted ? 'accepted' : 'rejected';
          }
        }
      }),

    // ─── Agent Edit Sessions ─────────────────────────────────────────

    upsertEditSession: (session) =>
      set((state) => {
        const existing = state.agentEditSessions.find(
          (s) =>
            s.filePath === session.filePath &&
            (s.phase === 'streaming' || s.phase === 'pending_review'),
        );
        if (existing) {
          existing.newContent = session.newContent;
          existing.toolCallId = session.toolCallId;
          existing.hunks = session.hunks;
        } else {
          state.agentEditSessions.push(session);
        }
      }),

    resolveEditSession: (id, accepted) =>
      set((state) => {
        const session = state.agentEditSessions.find((s) => s.id === id);
        if (session) {
          session.phase = accepted ? 'accepted' : 'rejected';
        }
      }),

    resolveAllEditSessions: (accepted) =>
      set((state) => {
        for (const session of state.agentEditSessions) {
          if (session.phase === 'streaming' || session.phase === 'pending_review') {
            session.phase = accepted ? 'accepted' : 'rejected';
          }
        }
      }),

    // ─── SDD ─────────────────────────────────────────────────────────

    setSddPhase: (phase) =>
      set((state) => {
        state.sddPhase = phase;
      }),

    setSddSpec: (spec) =>
      set((state) => {
        state.sddSpec = spec;
      }),

    setSddTasks: (tasks) =>
      set((state) => {
        state.sddTasks = tasks as SddTask[];
      }),

    updateSddTask: (id, patch) =>
      set((state) => {
        const task = state.sddTasks.find((t) => t.id === id);
        if (task) Object.assign(task, patch);
        // Recalculate progress
        const total = state.sddTasks.length;
        if (total > 0) {
          const done = state.sddTasks.filter(
            (t) => t.status === 'completed' || t.status === 'skipped',
          ).length;
          state.sddProgress = Math.round((done / total) * 100);
        }
      }),

    setSddProgress: (progress) =>
      set((state) => {
        state.sddProgress = progress;
      }),

    setSddFailedTask: (task) =>
      set((state) => {
        state.sddFailedTask = task;
      }),

    // ─── Token Usage ─────────────────────────────────────────────────

    setTokenUsage: (usage) =>
      set((state) => {
        state.tokenUsage = usage;
      }),

    setSessionTokenUsage: (usage) =>
      set((state) => {
        state.sessionTokenUsage = usage;
      }),

    // ─── API Request / Credit Tracking ───────────────────────────────

    incrementApiRequestCount: () =>
      set((state) => {
        state.apiRequestCount += 1;
        state.lastApiRequestAt = Date.now();
      }),

    resetApiRequestCount: () =>
      set((state) => {
        state.apiRequestCount = 0;
        state.lastApiRequestAt = null;
      }),

    // ─── Agent Task Tracking ─────────────────────────────────────────

    setAgentTasks: (tasks) =>
      set((state) => {
        state.agentTasks = tasks;
      }),

    // ─── Mode Switch / Delegation ────────────────────────────────────

    setPendingModeSwitch: (request) =>
      set((state) => {
        state.pendingModeSwitch = request;
      }),

    resolveModeSwitch: (approved) =>
      set((state) => {
        const req = state.pendingModeSwitch;
        if (!req) return;
        if (approved) {
          state.delegationChain.push({
            fromMode: req.fromMode as AgentMode,
            toMode: req.toMode as AgentMode,
            reason: req.reason,
          });
          state.mode = req.toMode as AgentMode;
        }
        state.pendingModeSwitch = null;
      }),

    // ─── User Questions ──────────────────────────────────────────────

    setPendingUserQuestion: (question) =>
      set((state) => {
        state.pendingUserQuestion = question;
      }),

    setTerminalStatus: (status) =>
      set((state) => {
        state.terminalStatus = status;
      }),

    setConnectionState: (connectionState, connectionMessage = null) =>
      set((state) => {
        state.connectionState = connectionState;
        state.connectionMessage = connectionMessage;
      }),

    setRecoverableError: (recoverableError) =>
      set((state) => {
        state.recoverableError = recoverableError;
      }),

    // ─── Sub-Agent Actions ────────────────────────────────────────────

    addSubAgent: (agent) =>
      set((state) => {
        state.subAgents.push(agent);
      }),

    updateSubAgent: (id, patch) =>
      set((state) => {
        const idx = state.subAgents.findIndex((a) => a.id === id);
        if (idx !== -1) Object.assign(state.subAgents[idx], patch);
      }),

    // ─── Session History ─────────────────────────────────────────────

    setSessions: (sessions) =>
      set((state) => {
        state.sessions = sessions;
      }),

    setSessionsLoading: (loading) =>
      set((state) => {
        state.sessionsLoading = loading;
      }),

    setHistoryOpen: (open) =>
      set((state) => {
        state.historyOpen = open;
      }),

    deleteSession: (id) =>
      set((state) => {
        state.sessions = state.sessions.filter((s) => s.id !== id);
      }),

    // ─── Multi-tab Actions ────────────────────────────────────────────

    openNewTab: (mode = 'chat') => {
      const tabId = crypto.randomUUID();
      set((state) => {
        // Snapshot current active tab to cache
        if (state.activeTabId) {
          state.tabStates[state.activeTabId] = _extractTab(state);
        }
        state.openTabs.push({ id: tabId, title: 'New Chat' });
        state.activeTabId = tabId;
        // Reset flat fields to fresh defaults
        _applyTab(state, defaultPerTabState(mode));
      });
      return tabId;
    },

    switchTab: (id) =>
      set((state) => {
        if (state.activeTabId === id) return;
        // Block switch during streaming
        if (state.isStreaming) return;
        // Save current flat state to cache
        state.tabStates[state.activeTabId] = _extractTab(state);
        // Load target tab's cached state (or default)
        const cached = state.tabStates[id];
        _applyTab(state, cached ?? defaultPerTabState('chat'));
        state.activeTabId = id;
        // Clean up the new active tab from the cache (it's now in flat fields)
        delete state.tabStates[id];
      }),

    closeTab: (id) =>
      set((state) => {
        // Can't close last tab
        if (state.openTabs.length <= 1) return;
        // The active turn owns the flat state until its terminal event arrives.
        if (state.activeTabId === id && state.isStreaming) return;
        const idx = state.openTabs.findIndex((t) => t.id === id);
        if (idx === -1) return;
        state.openTabs.splice(idx, 1);
        delete state.tabStates[id];
        // If closing the active tab, switch to neighbour
        if (state.activeTabId === id) {
          const nextTab = state.openTabs[Math.max(0, idx - 1)];
          const cached = state.tabStates[nextTab.id];
          _applyTab(state, cached ?? defaultPerTabState('chat'));
          state.activeTabId = nextTab.id;
          delete state.tabStates[nextTab.id];
        }
      }),

    updateTabTitle: (id, title) =>
      set((state) => {
        const tab = state.openTabs.find((t) => t.id === id);
        if (tab) tab.title = title;
      }),

    loadSavedTabs: (tabs) =>
      set((state) => {
        if (tabs.length === 0) return;
        // Replace the default single tab with saved tabs
        state.openTabs = tabs.map((t) => ({ id: t.id, title: t.title }));
        // First tab becomes active
        const first = tabs[0];
        state.activeTabId = first.id;
        _applyTab(state, {
          ...defaultPerTabState(first.mode),
          conversationId: first.conversationId,
          messages: first.messages,
        });
        // Cache remaining tabs
        for (const t of tabs.slice(1)) {
          state.tabStates[t.id] = {
            ...defaultPerTabState(t.mode),
            conversationId: t.conversationId,
            messages: t.messages,
          };
        }
      }),

    // ─── Debug ───────────────────────────────────────────────────────

    addDebugLine: (line) =>
      set((state) => {
        state.debugLines.push(line);
        // Keep only last 100 lines
        if (state.debugLines.length > 100) {
          state.debugLines = state.debugLines.slice(-100);
        }
      }),

    clearDebugLines: () =>
      set((state) => {
        state.debugLines = [];
      }),

    setDebugExpanded: (v) =>
      set((state) => {
        state.debugExpanded = v;
      }),
  })),
);

// ─── Tab helpers (used inside immer set() callbacks) ────────────────────────

/** Snapshot the flat per-conversation fields into a PerTabState object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _extractTab(s: any): PerTabState {
  return {
    mode: s.mode,
    conversationId: s.conversationId,
    messages: s.messages,
    isStreaming: s.isStreaming,
    streamingText: s.streamingText,
    contextFiles: s.contextFiles,
    attachedImages: s.attachedImages,
    gatheredContext: s.gatheredContext,
    pendingToolCalls: s.pendingToolCalls,
    pendingApprovals: s.pendingApprovals,
    pendingFileChanges: s.pendingFileChanges,
    agentEditSessions: s.agentEditSessions,
    sddPhase: s.sddPhase,
    sddSpec: s.sddSpec,
    sddTasks: s.sddTasks,
    sddProgress: s.sddProgress,
    sddFailedTask: s.sddFailedTask,
    tokenUsage: s.tokenUsage,
    sessionTokenUsage: s.sessionTokenUsage,
    apiRequestCount: s.apiRequestCount,
    lastApiRequestAt: s.lastApiRequestAt,
    agentTasks: s.agentTasks,
    pendingModeSwitch: s.pendingModeSwitch,
    delegationChain: s.delegationChain,
    pendingUserQuestion: s.pendingUserQuestion,
    subAgents: s.subAgents ?? [],
    terminalStatus: s.terminalStatus ?? null,
    connectionState: s.connectionState ?? 'idle',
    connectionMessage: s.connectionMessage ?? null,
    recoverableError: s.recoverableError ?? null,
  };
}

/** Apply a PerTabState snapshot to the flat fields of an immer draft. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _applyTab(s: any, ps: PerTabState): void {
  s.mode = ps.mode;
  s.conversationId = ps.conversationId;
  s.messages = ps.messages;
  s.isStreaming = ps.isStreaming;
  s.streamingText = ps.streamingText;
  s.contextFiles = ps.contextFiles;
  s.attachedImages = ps.attachedImages;
  s.gatheredContext = ps.gatheredContext;
  s.pendingToolCalls = ps.pendingToolCalls;
  s.pendingApprovals = ps.pendingApprovals;
  s.pendingFileChanges = ps.pendingFileChanges;
  s.agentEditSessions = ps.agentEditSessions;
  s.sddPhase = ps.sddPhase;
  s.sddSpec = ps.sddSpec;
  s.sddTasks = ps.sddTasks;
  s.sddProgress = ps.sddProgress;
  s.sddFailedTask = ps.sddFailedTask;
  s.tokenUsage = ps.tokenUsage;
  s.sessionTokenUsage = ps.sessionTokenUsage;
  s.apiRequestCount = ps.apiRequestCount;
  s.lastApiRequestAt = ps.lastApiRequestAt;
  s.agentTasks = ps.agentTasks;
  s.pendingModeSwitch = ps.pendingModeSwitch;
  s.delegationChain = ps.delegationChain;
  s.pendingUserQuestion = ps.pendingUserQuestion;
  s.subAgents = ps.subAgents ?? [];
  s.terminalStatus = ps.terminalStatus ?? null;
  s.connectionState = ps.connectionState ?? 'idle';
  s.connectionMessage = ps.connectionMessage ?? null;
  s.recoverableError = ps.recoverableError ?? null;
}

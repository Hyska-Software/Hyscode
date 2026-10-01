// ─── Harness Bridge ─────────────────────────────────────────────────────────
// Owns a Harness instance and wires its events to an isolated AgentStoreApi.
// EDITOR uses the legacy singleton instance; VORTEX creates one bridge per runtime.
// Lives outside React to avoid re-renders during streaming.

import {
  Harness,
  SkillLoader,
  RuleLoader,
  applyPolicyOverride,
  resolveEffectiveAgentPolicy,
  effectivePolicyConfig,
  MemoryManager,
  SAFE_TOOLS,
  projectTerminalProgress,
  projectTerminalRuntimeSummary,
  isTerminalRecord,
  asTerminalRuntimeFailure,
  validateTerminalExitEvent,
  validateTerminalFailure,
  createGoalTools,
  GoalService,
  authorizeToolInvocationArgs,
  type GoalChangeEvent,
  type GoalState,
} from '@hyscode/agent-harness';
import type {
  HarnessEvent,
  AgentType,
  ConversationMode,
  Skill,
  SddTask,
  ToolHandler,
  ToolResult,
  ToolExecutionContext,
  ToolCategory,
  EnvironmentContext,
  TurnRecord,
  SddDatabase,
  SddSession,
  RuleDiagnostic,
  ApprovalDecision,
  ToolApprovalRequest,
  AgentTaskContext,
  GoalEditInput,
  GoalRun,
  ToolInvocationAuthorization,
  ExternalPathAccessRequest,
  FileChangePending,
  GoalRunSource,
  GoalCompletionRequest,
  TurnOutcome,
} from '@hyscode/agent-harness';
import type { Message, ToolDefinition, MessageContent, TokenUsage } from '@hyscode/ai-providers';
import { tauriInvoke, tauriInvokeRaw } from './tauri-invoke';
import { diagnosticPathsEqual, type DiagnosticContract } from './diagnostics-types';
import { getEditorDiagnostics, getOpenDiagnosticFiles } from './diagnostics-tracker';
import { mergeDiagnostics } from './diagnostics-merge';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { McpBridge } from './mcp-bridge';
import { useAgentStore, type AgentStoreApi } from '@/stores/agent-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useMemoryStore } from '@/stores/memory-store';
import { useSkillsStore } from '@/stores/skills-store';
import { useRulesStore } from '@/stores/rules-store';
import { useFileStore } from '@/stores/file-store';
import { useEditorStore } from '@/stores/editor-store';
import { useProjectStore } from '@/stores/project-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { desktopTerminalRuntime } from './terminal-runtime';
import type {
  ToolCallDisplay,
  PendingApproval,
  AgentEditSession,
  SubAgentState,
  AgentMode,
} from '@/stores/agent-store';
import { computeDiffHunks } from './compute-diff';
import { buildTurnSummary } from './turn-summary';
import { SubAgentRunner } from './sub-agent-runner';
import { SubAgentCoordinator, type SubAgentResourceMode } from './sub-agent-coordinator';
import { eventBelongsToOwner } from './turn-event-ownership';
import { configureProviderResilience } from './init-providers';
import { notifyVortexProjectSessionIndexUpdated } from './vortex-project-sessions';
import {
  isPlaceholderVortexSessionTitle,
  resolveVortexSessionTitle,
} from './vortex-session-titles';
import {
  desktopKanbanHarnessIntegration,
  kanbanTaskExecutionCoordinator,
  type TaskExecutionRequest,
  type TaskExecutionTarget,
} from './task-execution-coordinator';
import { normalizeAgentHistory } from './agent-history';
import { createDesktopGoalService } from './goal-runtime';
import { normalizeProjectPath, projectPathKey } from './project-path';

const NATIVE_AUTHORIZED_FILESYSTEM_COMMANDS = new Set([
  'read_file',
  'read_file_chunk',
  'write_file',
  'create_file',
  'delete_path',
  'trash_path',
  'list_dir',
  'stat_path',
  'path_exists',
  'search_files',
  'rename_path',
  'move_path',
  'find_files',
  'create_directory',
  'list_dir_all',
  'copy_path',
  'reveal_path',
  'open_path',
]);

function expectedContentAfterChange(
  change: Pick<FileChangePending, 'toolName' | 'newContent'>,
): string | null {
  return change.toolName === 'delete_file' ? null : change.newContent;
}

export interface SubAgentMirrorTarget {
  /** Store id of the sub-agent entry (the spawn tool-call id). */
  spawnId: string;
  /** Inline spawn input when the outer call wraps it (invoke_external_tool). */
  nestedInput?: Record<string, unknown>;
}

/**
 * Resolve which sub-agent store entry a tool result belongs to.
 * Covers direct spawn_subagent calls, nested `:external` dispatches
 * (invoke_external_tool reuses the outer toolCallId as its context id),
 * and invoke_external_tool wrappers (matched via `input.name`).
 * Returns null for unrelated tools. Pure — unit-tested below.
 */
export function resolveSubAgentMirrorTarget(
  toolCallId: string,
  toolName: string,
  findInput: (id: string) => Record<string, unknown> | undefined,
): SubAgentMirrorTarget | null {
  if (toolName === 'spawn_subagent') {
    const spawnId = toolCallId.endsWith(':external')
      ? toolCallId.slice(0, -':external'.length)
      : toolCallId;
    if (!spawnId) return null;
    return { spawnId };
  }
  if (toolName === 'invoke_external_tool') {
    const input = findInput(toolCallId);
    if (input?.name !== 'spawn_subagent') return null;
    const nested =
      input.input !== null && typeof input.input === 'object' && !Array.isArray(input.input)
        ? (input.input as Record<string, unknown>)
        : undefined;
    return { spawnId: toolCallId, ...(nested ? { nestedInput: nested } : {}) };
  }
  return null;
}

// ─── Error Parser ────────────────────────────────────────────────────────────
// Converts raw technical error messages into friendly user-facing text.

function parseProviderError(raw: string): string {
  // Extract JSON body from messages like "Anthropic API error: 400 {...}"
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      // Anthropic error shape: { error: { message: string, type: string } }
      const msg: string | undefined =
        parsed?.error?.message ?? parsed?.message ?? parsed?.error ?? undefined;
      if (msg) return humanizeErrorMessage(msg, raw);
    } catch {
      // not JSON, fall through
    }
  }
  return humanizeErrorMessage(raw, raw);
}

function humanizeErrorMessage(msg: string, raw: string): string {
  const lower = msg.toLowerCase();

  if (lower.includes('credit') || lower.includes('billing') || lower.includes('balance')) {
    return 'Insufficient credits. Please top up your API account balance to continue.';
  }
  if (
    lower.includes('invalid_api_key') ||
    lower.includes('authentication') ||
    lower.includes('unauthorized') ||
    raw.includes('401')
  ) {
    return 'Invalid API key. Check your key in Settings → Providers.';
  }
  if (lower.includes('rate limit') || lower.includes('rate_limit') || raw.includes('429')) {
    return 'Rate limit reached. Please wait a moment before sending another message.';
  }
  if (lower.includes('overloaded') || lower.includes('529')) {
    return 'The AI provider is temporarily overloaded. Please try again in a moment.';
  }
  if (
    lower.includes('context') &&
    (lower.includes('length') || lower.includes('window') || lower.includes('token'))
  ) {
    return 'The conversation is too long for this model. Try starting a new conversation.';
  }
  if (lower.includes('model') && lower.includes('not found')) {
    return 'The selected model is not available. Please choose a different model in Settings.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The request timed out. Check your connection and try again.';
  }
  if (lower.includes('no api key') || (lower.includes('missing') && lower.includes('key'))) {
    return 'No API key configured. Add your API key in Settings → Providers.';
  }
  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return 'Network error. Check your internet connection and try again.';
  }
  if (lower.includes('aborted') || lower.includes('cancelled')) {
    return 'Request cancelled.';
  }

  // If the raw provider message is short and readable, use it directly
  if (msg.length < 200 && !msg.includes('{') && !msg.includes('request_id')) {
    return msg;
  }

  return 'An unexpected error occurred. Please try again.';
}

function collectRuleTargetPaths(workspacePath: string, contextFiles: readonly string[]): string[] {
  const editorState = useEditorStore.getState();
  const activeTab = editorState.tabs.find((tab) => tab.id === editorState.activeTabId);
  const fileStoreRoot = useFileStore.getState().rootPath;
  const activeFilePath =
    activeTab?.type === 'file' &&
    projectPathKey(fileStoreRoot ?? '') === projectPathKey(workspacePath) &&
    isPathInsideWorkspace(activeTab.filePath, workspacePath)
      ? activeTab.filePath
      : undefined;
  const candidates = [workspacePath, activeFilePath, ...contextFiles];
  return Array.from(
    new Set(
      candidates.filter(
        (path): path is string =>
          typeof path === 'string' && path.trim().length > 0 && !path.startsWith('untitled:'),
      ),
    ),
  );
}

function isPathInsideWorkspace(path: string, workspacePath: string): boolean {
  const normalizedPathname = normalizeProjectPath(path);
  const normalizedWorkspaceName = normalizeProjectPath(workspacePath);
  if (
    normalizedPathname.split('/').includes('..') ||
    normalizedWorkspaceName.split('/').includes('..')
  ) {
    return false;
  }
  const normalizedPath = projectPathKey(normalizedPathname);
  const normalizedWorkspace = projectPathKey(normalizedWorkspaceName);
  if (!normalizedPath || !normalizedWorkspace) return false;
  const workspacePrefix = normalizedWorkspace.endsWith('/')
    ? normalizedWorkspace
    : `${normalizedWorkspace}/`;
  return normalizedPath === normalizedWorkspace || normalizedPath.startsWith(workspacePrefix);
}

type BridgeTurn = {
  id: number;
  projectId: string;
  conversationId: string;
  tabId: string | null;
  cancelled: boolean;
  harnessStarted: boolean;
  assistantMessageStarted: boolean;
};

type QueuedBridgeTurn = {
  projectId: string;
  conversationId: string;
  tabId: string | null;
  cancelled: boolean;
};

function extractGoalCompletionRequest(
  record: TurnRecord,
  turnId: string,
): GoalCompletionRequest | undefined {
  for (let index = record.toolCalls.length - 1; index >= 0; index -= 1) {
    const metadata = record.toolCalls[index].output.metadata;
    if (!metadata || metadata.action !== 'goal_completion_requested') continue;
    const summary = typeof metadata.summary === 'string' ? metadata.summary.trim() : '';
    if (!summary) return undefined;
    return {
      summary,
      evidence: typeof metadata.evidence === 'string' ? metadata.evidence : undefined,
      turnId,
    };
  }
  return undefined;
}

function createSddDatabase(): SddDatabase {
  const parseSession = (value: string): SddSession =>
    ({ ...JSON.parse(value), tasks: [] }) as SddSession;
  const parseTask = (value: string): SddTask => JSON.parse(value) as SddTask;
  const taskCache = new Map<string, SddTask>();
  return {
    createSession: async (session) => {
      await tauriInvokeRaw('db_sdd_upsert_session', { sessionJson: JSON.stringify(session) });
    },
    updateSession: async (id, updates) => {
      const raw = await tauriInvokeRaw<string | null>('db_sdd_get_session', { id });
      if (!raw) throw new Error(`SDD session ${id} not found`);
      await tauriInvokeRaw('db_sdd_upsert_session', {
        sessionJson: JSON.stringify({ ...parseSession(raw), ...updates }),
      });
    },
    getSession: async (id) => {
      const raw = await tauriInvokeRaw<string | null>('db_sdd_get_session', { id });
      return raw ? parseSession(raw) : null;
    },
    listSessions: async (projectId) => {
      const rows = await tauriInvokeRaw<string[]>('db_sdd_list_sessions', { projectId });
      return rows.map(parseSession);
    },
    createTask: async (task) => {
      await tauriInvokeRaw('db_sdd_upsert_task', { taskJson: JSON.stringify(task) });
      taskCache.set(task.id, task);
    },
    updateTask: async (id, updates) => {
      const current = taskCache.get(id);
      if (!current) throw new Error(`SDD task ${id} is not loaded`);
      const updated = { ...current, ...updates };
      await tauriInvokeRaw('db_sdd_upsert_task', { taskJson: JSON.stringify(updated) });
      taskCache.set(id, updated);
    },
    getTasksForSession: async (sessionId) => {
      const rows = await tauriInvokeRaw<string[]>('db_sdd_get_tasks', { sessionId });
      const tasks = rows.map(parseTask);
      for (const task of tasks) taskCache.set(task.id, task);
      return tasks;
    },
  };
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance: HarnessBridge | null = null;
let _lifecycleGeneration = 0;

type MutationSnapshot = {
  diskBefore: string | null;
  bufferBefore: string | null;
  wasDirty: boolean;
  tabId: string | null;
  nativeGrantIds?: string[];
  expectedContent?: string | null;
};

export class HarnessBridge {
  private harness: Harness;
  private readonly agentStore: AgentStoreApi;
  private readonly isolatedRuntime: boolean;
  private disposed = false;
  private _projectId: string = '';
  private approvalResolvers = new Map<string, (decision: ApprovalDecision) => void>();
  private modeSwitchResolvers = new Map<string, (approved: boolean) => void>();
  private resolvedModeSwitchIds = new Set<string>();
  private userQuestionResolvers = new Map<
    string,
    (answers: import('@hyscode/agent-harness').AgentQuestionAnswer[]) => void
  >();
  /** Active sub-agent runners keyed by their id (toolCallId of spawn_subagent). */
  private _subAgentRunners = new Map<string, SubAgentRunner>();
  /** Maps unique approval ids to their owning sub-agent id. */
  private _approvalOwner = new Map<string, string>();
  /** True when the current parent turn spawned at least one sub-agent. */
  private _turnHadSubAgents = false;
  /** Bounds concurrent child execution and serializes workspace-exclusive modes. */
  private subAgentCoordinator: SubAgentCoordinator;
  /** Bridge-local mutation snapshots; cross-session workspace coordination is not included. */
  private mutationSnapshotPromises = new Map<string, Promise<void>>();
  private memoryManager: MemoryManager | null = null;
  private ruleDiagnostics: RuleDiagnostic[] = [];
  private externalMcpTools = new Map<
    string,
    { handler: ToolHandler; serverId: string; agentSafe: boolean }
  >();
  private mutationSnapshots = new Map<string, MutationSnapshot>();
  private activeTurnTabId: string | null = null;
  private activeTurnConversationId: string | null = null;
  private activeTurnId: string | null = null;
  private lastCompletedTurnId: string | null = null;
  private activeTaskContext: AgentTaskContext | null = null;
  private taskTargetUnregister: (() => void) | null = null;
  private ptyExitUnsubscribe: (() => void) | null = null;
  private goalService: GoalService;
  private goalContinuationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private goalContinuationInFlight = new Set<string>();
  private turnSequence = 0;
  private activeTurn: BridgeTurn | null = null;
  private editorTurnQueue: Promise<void> = Promise.resolve();
  private queuedTurns: QueuedBridgeTurn[] = [];

  // ─── Agent Terminal Integration ───────────────────────────────────
  /** Last terminal command, isolated by conversation for deterministic context injection. */
  private _lastTerminalCommands = new Map<
    string,
    {
      command: string;
      output: string;
      exitCode: number | null;
    }
  >();

  /** Record a completed terminal command under the active conversation. */
  private recordTerminalCommand(command: string, output: string, exitCode: number | null): void {
    if (this.disposed || (this.activeTurn && !this.isTurnIdentityCurrent(this.activeTurn))) return;
    const useAgentStore = this.agentStore;
    const conversationId = useAgentStore.getState().conversationId;
    if (!conversationId) return;
    this._lastTerminalCommands.set(conversationId, {
      command,
      output: output.slice(-16_000),
      exitCode,
    });
  }

  /** Drop approval-owner registrations that belong to a finished sub-agent. */
  private clearSubAgentApprovalOwners(subAgentId: string): void {
    for (const [approvalId, ownerId] of this._approvalOwner) {
      if (ownerId === subAgentId) this._approvalOwner.delete(approvalId);
    }
  }

  private constructor(
    workspacePath: string,
    projectId: string,
    homePath: string,
    agentStore: AgentStoreApi = useAgentStore,
    isolatedRuntime = false,
  ) {
    this.agentStore = agentStore;
    this.isolatedRuntime = isolatedRuntime;
    const useAgentStore = this.agentStore;
    this._projectId = projectId;
    this.goalService = createDesktopGoalService(tauriInvokeRaw, (event) =>
      this.handleGoalChange(event),
    );
    const settings = useSettingsStore.getState();
    this.subAgentCoordinator = new SubAgentCoordinator(
      settings.subAgentMaxConcurrent ?? 2,
      (positions) => {
        const agentStore = useAgentStore.getState();
        for (const { id, queuePosition } of positions) {
          agentStore.updateSubAgent(id, { queuePosition });
        }
      },
    );
    window.addEventListener('offline', () => {
      if (this.disposed) return;
      if (useAgentStore.getState().isStreaming) {
        useAgentStore
          .getState()
          .setConnectionState('offline', 'No internet — waiting for connection');
      }
    });
    window.addEventListener('online', () => {
      if (this.disposed) return;
      if (useAgentStore.getState().isStreaming) {
        useAgentStore
          .getState()
          .setConnectionState('connecting', 'Connection restored — reconnecting');
      }
    });

    // Instantiate MemoryManager (bridges to Tauri SQLite memory commands)
    const memoryManager = new MemoryManager(tauriInvokeRaw);
    this.memoryManager = memoryManager;

    // Trigger one-time relevance decay on startup (best-effort, non-blocking)
    memoryManager.decayRelevance(projectId).catch(() => {});

    // Only the legacy active workspace bridge owns the shared memory-panel
    // projection. Background VORTEX runtimes keep memory execution scoped to
    // their own MemoryManager until the runtime is focused.
    if (!isolatedRuntime) useMemoryStore.getState().setProjectId(projectId);

    // Create SkillLoader with Tauri-backed file system callbacks
    const skillLoader = new SkillLoader({
      builtInPath: `${workspacePath}/node_modules/@hyscode/skills/dist`,
      globalPath: `${homePath}/.agents/skills`,
      workspacePath,
      readDir: async (path: string) => {
        try {
          // Use list_dir_all to include hidden entries and skill folders
          return await tauriInvokeRaw<Array<{ name: string; is_dir: boolean }>>('list_dir_all', {
            path,
          });
        } catch {
          return [];
        }
      },
      readFile: async (path: string) => {
        return await tauriInvokeRaw<string>('read_file', { path });
      },
      pathExists: async (path: string) => {
        try {
          await tauriInvokeRaw('stat_path', { path });
          return true;
        } catch {
          return false;
        }
      },
    });

    // Create RuleLoader with Tauri-backed file system callbacks
    const ruleLoader = new RuleLoader({
      globalPath: settings.globalRulesPath.trim() || `${homePath}/.config/hyscode/rules`,
      workspacePath,
      readDir: async (path: string) => {
        try {
          return await tauriInvokeRaw<Array<{ name: string; is_dir: boolean }>>('list_dir_all', {
            path,
          });
        } catch {
          return [];
        }
      },
      readFile: async (path: string) => {
        return await tauriInvokeRaw<string>('read_file', { path });
      },
      pathExists: async (path: string) => {
        try {
          await tauriInvokeRaw('stat_path', { path });
          return true;
        } catch {
          return false;
        }
      },
    });

    this.harness = new Harness({
      workspacePath,
      projectId,
      invoke: <T>(
        command: string,
        args?: Record<string, unknown>,
        authorization?: ToolInvocationAuthorization,
      ): Promise<T> => this.invokeForHarness<T>(command, args, authorization),
      memoryManager,
      sddDb: createSddDatabase(),
      hasDirtyBuffers: () =>
        useEditorStore.getState().tabs.some((tab) => tab.type === 'file' && tab.isDirty),
      listen: async (event: string, handler: (payload: unknown) => void) => {
        const unlisten = await tauriListen(event, (e) => handler(e.payload));
        return unlisten;
      },
      savePlanFile: async (sessionId, spec, tasks) => {
        const planDir = `${workspacePath}/.hyscode/plans`;
        const planPath = `${planDir}/PLAN-${sessionId}.md`;
        const taskList = tasks
          .map(
            (t, i) =>
              `${i + 1}. **${t.title}**\n   - Files: ${t.files.join(', ') || 'N/A'}\n   - Description: ${t.description}`,
          )
          .join('\n\n');
        const content = `# Implementation Plan\n\n## Specification\n\n${spec}\n\n## Tasks\n\n${taskList}\n`;
        try {
          await tauriInvokeRaw('create_directory', { path: planDir });
        } catch {
          // directory may already exist
        }
        await tauriInvokeRaw('write_file', { path: planPath, content });
        this.debug(`SDD plan saved to ${planPath}`);
      },
      config: {
        providerId: settings.activeProviderId ?? '',
        modelId: settings.activeModelId ?? '',
        maxIterations: settings.interactionLimitEnabled ? settings.maxIterations : null,
        maxOutputTokens: settings.maxTokens,
        maxInputTokens: 200_000,
        turnTimeoutMs: 300_000,
        approval: {
          mode: settings.approvalMode,
          ...(settings.approvalMode === 'custom' && {
            // Settings store uses: true = auto-approve. Harness uses: true = needs approval.
            categoryOverrides: Object.fromEntries(
              Object.entries(settings.customApprovalRules.categoryRules).map(([k, autoApprove]) => [
                k,
                !autoApprove,
              ]),
            ) as Record<string, boolean>,
            toolOverrides: Object.fromEntries(
              Object.entries(settings.customApprovalRules.toolRules).map(([k, autoApprove]) => [
                k,
                !autoApprove,
              ]),
            ),
          }),
        },
        thinking: this.buildThinkingConfig(settings.activeProviderId, settings.activeModelId),
      },
      onEvent: (event) => this.handleEvent(event),
      onApprovalRequest: (pending, signal) => this.handleApprovalRequest(pending, signal),
      onModeSwitchRequest: (request, signal) => this.handleModeSwitchRequest(request, signal),
      onUserQuestionRequest: (id, questions, title, signal) =>
        this.handleUserQuestionRequest(id, questions, title, signal),
      terminalRuntime: desktopTerminalRuntime,
      goalTools: createGoalTools(
        this.goalService,
        projectId,
        () => this.agentStore.getState().mode === 'build',
      ),
      goalToolsEnabled: () => this.agentStore.getState().mode === 'build',
      onTerminalCommand: (command, output, exitCode) =>
        this.recordTerminalCommand(command, output, exitCode),
      skillLoader,
      ruleLoader,
      taskIntegration: desktopKanbanHarnessIntegration,
      onRulesResolved: (rules, diagnostics) => {
        if (this.disposed) return;
        this.ruleDiagnostics = diagnostics;
        if (this.isolatedRuntime) {
          this.syncSharedAgentPreferences();
          return;
        }
        const rulesStore = useRulesStore.getState();
        rulesStore.setDiscoveredRules(rules);
        this.syncActiveRules(rulesStore.getActiveRules().map((rule) => rule.id));
      },
    });

    // Listen for PTY exits so we can mark agent sessions as dead and avoid reuse.
    void tauriListen<unknown>('pty:exit', (e) => {
      if (this.disposed || !isTerminalRecord(e.payload)) return;
      const payload = e.payload;
      if (typeof payload.pty_id !== 'string') return;
      const ts = useTerminalStore.getState();
      const session = ts.sessions.find((s) => s.ptyId === payload.pty_id && s.isAgentSession);
      if (!session) return;
      const expectedToolCallId = session.activeToolCallId ?? undefined;
      const projectExit = (
        sequence: number,
        exitCode: number | null,
        failure: Parameters<typeof projectTerminalRuntimeSummary>[1]['failure'],
      ): void => {
        if (!expectedToolCallId) return;
        const current = useAgentStore
          .getState()
          .pendingToolCalls.find((toolCall) => toolCall.id === expectedToolCallId);
        if (
          !current ||
          !(
            current.status === 'running' ||
            current.status === 'cancelling' ||
            current.terminalState === 'started' ||
            current.terminalState === 'running' ||
            current.terminalState === 'awaiting_input'
          )
        )
          return;
        const projection = projectTerminalRuntimeSummary(
          {
            terminalId: current.terminalId,
            terminalState: current.terminalState,
            outputSequence: current.outputSequence,
            liveOutput: current.liveOutput,
            failure: current.failure,
            provisional: current.terminalProvisional,
            canonical: current.terminalCanonical,
          },
          { terminalId: session.id, sequence, alive: false, exitCode, failure },
        );
        if (!projection) return;
        useAgentStore.getState().updateToolCall(expectedToolCallId, {
          status: 'error',
          terminalId: projection.terminalId,
          terminalState: projection.terminalState,
          outputSequence: projection.outputSequence,
          liveOutput: projection.liveOutput,
          failure: projection.failure,
          error: projection.failure?.message,
          terminalProvisional: true,
          terminalCanonical: false,
        });
      };
      try {
        const exit = validateTerminalExitEvent(payload);
        projectExit(exit.sequence, exit.code, exit.failure);
        ts.markPtyDead(session.id, exit.code, exit.failure, expectedToolCallId);
      } catch (error) {
        const failure = asTerminalRuntimeFailure(error, 'event');
        projectExit(
          typeof payload.sequence === 'number' &&
            Number.isSafeInteger(payload.sequence) &&
            payload.sequence >= 0
            ? payload.sequence
            : 0,
          null,
          failure,
        );
        ts.markPtyDead(session.id, null, failure, expectedToolCallId);
      }
    })
      .then((unsubscribe) => {
        if (this.disposed) {
          try {
            unsubscribe();
          } catch (error) {
            console.error(
              '[HarnessBridge] PTY exit listener cleanup failed after disposal.',
              error,
            );
          }
        } else {
          this.ptyExitUnsubscribe = unsubscribe;
        }
      })
      .catch((error: unknown) => {
        this.debug(
          `Could not subscribe to PTY exits: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private static _homePathCache: string | null = null;

  /** Fallback home path when Tauri command is not available */
  private static getHomePathFallback(): string {
    const isWin = typeof navigator !== 'undefined' && navigator.userAgent?.includes('Windows');
    const username = (globalThis as Record<string, unknown>).__TAURI_USERNAME__ as
      | string
      | undefined;
    if (isWin) {
      return 'C:/Users/' + (username || 'user');
    }
    return '/home/' + (username || 'user');
  }

  /** Get the resolved home path (available after init) */
  static getHomePath(): string {
    return HarnessBridge._homePathCache ?? HarnessBridge.getHomePathFallback();
  }

  // ─── Singleton access ───────────────────────────────────────────────

  static async init(workspacePath: string, projectId: string): Promise<HarnessBridge> {
    if (_instance) return _instance;
    const generation = _lifecycleGeneration;

    // Resolve home directory via Rust (reliable cross-platform)
    let homePath: string;
    try {
      homePath = await tauriInvokeRaw<string>('get_home_dir', {});
    } catch {
      homePath = HarnessBridge.getHomePathFallback();
    }
    HarnessBridge._homePathCache = homePath;

    if (generation !== _lifecycleGeneration) {
      throw new Error('HarnessBridge initialization was cancelled by a project switch.');
    }

    const instance = new HarnessBridge(workspacePath, projectId, homePath);
    _instance = instance;

    try {
      // Load mode policy overrides from the database (best-effort)
      await instance.loadModePolicies();

      // Load rules and sync with store so they're active from the first turn
      await instance.loadAndSyncRules();

      // Register the spawn_subagent built-in tool
      instance.registerSpawnSubagentTool();

      // Subscribe to tab switches: keep harness in sync with the active tab
      instance.subscribeToTabSwitches();

      if (generation !== _lifecycleGeneration || _instance !== instance) {
        instance.disposed = true;
        instance.cancel();
        throw new Error('HarnessBridge initialization was cancelled by a project switch.');
      }

      return instance;
    } catch (error) {
      if (_instance === instance) _instance = null;
      instance.disposed = true;
      instance.cancel();
      throw error;
    }
  }

  /**
   * Create an isolated bridge for a VORTEX conversation.
   *
   * The legacy `init()` method remains the singleton bridge used by EDITOR.
   * VORTEX runtimes provide their own AgentStoreApi so concurrent sessions do
   * not share transcript, approval, or turn lifecycle state.
   */
  static async createSession(
    workspacePath: string,
    projectId: string,
    agentStore: AgentStoreApi,
  ): Promise<HarnessBridge> {
    let homePath: string;
    try {
      homePath = await tauriInvokeRaw<string>('get_home_dir', {});
    } catch {
      homePath = HarnessBridge.getHomePathFallback();
    }
    HarnessBridge._homePathCache = homePath;

    const instance = new HarnessBridge(workspacePath, projectId, homePath, agentStore, true);
    try {
      await instance.loadModePolicies();
      await instance.loadAndSyncRules();
      instance.registerSpawnSubagentTool();
      instance.subscribeToTabSwitches();
      return instance;
    } catch (error) {
      instance.disposed = true;
      instance.cancel();
      throw error;
    }
  }

  static get(): HarnessBridge {
    if (!_instance)
      throw new Error('HarnessBridge not initialized. Call HarnessBridge.init() first.');
    return _instance;
  }

  static destroy(): void {
    _lifecycleGeneration += 1;
    const instance = _instance;
    _instance = null;
    if (instance) {
      instance.disposed = true;
      instance.cancel();
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────

  sendMessage(
    userMessage: string,
    options: {
      hidden?: boolean;
      excludeLastAssistantFromHistory?: boolean;
      providerId?: string;
      modelId?: string;
      taskContext?: AgentTaskContext;
      goalContext?: string;
      goalRunId?: string;
      goalSource?: GoalRunSource;
    } = {},
  ): Promise<TurnOutcome | null> {
    if (this.disposed) return Promise.resolve(null);
    if (
      !this.isolatedRuntime &&
      projectPathKey(useProjectStore.getState().rootPath ?? '') !== projectPathKey(this._projectId)
    ) {
      return Promise.resolve(null);
    }
    const state = this.agentStore.getState();
    const conversationId = state.conversationId ?? crypto.randomUUID();
    if (!state.conversationId) state.setConversationId(conversationId);
    const request: QueuedBridgeTurn = {
      projectId: this._projectId,
      conversationId,
      tabId: state.activeTabId,
      cancelled: false,
    };
    this.queuedTurns.push(request);
    const queuedTurn = this.editorTurnQueue.then(() => {
      this.queuedTurns = this.queuedTurns.filter((queued) => queued !== request);
      return this.executeSendMessage(userMessage, options, request);
    });
    this.editorTurnQueue = queuedTurn.then(
      () => undefined,
      () => undefined,
    );
    return queuedTurn;
  }

  private async executeSendMessage(
    userMessage: string,
    options: {
      hidden?: boolean;
      excludeLastAssistantFromHistory?: boolean;
      providerId?: string;
      modelId?: string;
      taskContext?: AgentTaskContext;
      goalContext?: string;
      goalRunId?: string;
      goalSource?: GoalRunSource;
    },
    request: QueuedBridgeTurn,
  ): Promise<TurnOutcome | null> {
    if (this.disposed) return null;
    const useAgentStore = this.agentStore;
    const initialState = useAgentStore.getState();
    if (
      request.projectId !== this._projectId ||
      request.conversationId !== initialState.conversationId ||
      request.tabId !== initialState.activeTabId
    ) {
      return null;
    }
    if (
      !this.isolatedRuntime &&
      projectPathKey(useProjectStore.getState().rootPath ?? '') !== projectPathKey(this._projectId)
    ) {
      return null;
    }
    if (request.cancelled) {
      useAgentStore.getState().setTerminalStatus('cancelled');
      return null;
    }

    const conversationId = request.conversationId;
    this.harness.setConversationId(conversationId);
    const turn: BridgeTurn = {
      id: ++this.turnSequence,
      projectId: this._projectId,
      conversationId,
      tabId: initialState.activeTabId,
      cancelled: false,
      harnessStarted: false,
      assistantMessageStarted: false,
    };
    this.activeTurn = turn;
    this.activeTurnTabId = turn.tabId;
    this.activeTurnConversationId = conversationId;
    this.activeTurnId = null;
    this.lastCompletedTurnId = null;
    useAgentStore.getState().setStreaming(true);
    useAgentStore.getState().setTerminalStatus(null);
    useAgentStore.getState().setRecoverableError(null);

    try {
      return await this.runMessage(userMessage, options, turn);
    } catch (error) {
      if (this.isTurnIdentityCurrent(turn)) {
        const message = error instanceof Error ? error.message : String(error);
        useAgentStore.getState().addDebugLine(`[HarnessBridge] Pre-turn error: ${message}`);
        if (turn.assistantMessageStarted) {
          useAgentStore.getState().updateLastAssistantError(parseProviderError(message));
        }
      }
      return null;
    } finally {
      if (this.activeTurn === turn) {
        if (this.isTurnIdentityCurrent(turn)) {
          useAgentStore.getState().setStreaming(false);
          if (useAgentStore.getState().connectionState !== 'degraded') {
            useAgentStore.getState().setConnectionState('idle');
          }
        }
        this.activeTurn = null;
        this.activeTurnTabId = null;
        this.activeTurnConversationId = null;
        this.activeTurnId = null;
        this.activeTaskContext = null;
      }
    }
  }

  private async runMessage(
    userMessage: string,
    options: {
      hidden?: boolean;
      excludeLastAssistantFromHistory?: boolean;
      providerId?: string;
      modelId?: string;
      taskContext?: AgentTaskContext;
      goalContext?: string;
      goalRunId?: string;
      goalSource?: GoalRunSource;
    },
    turn: BridgeTurn,
  ): Promise<TurnOutcome | null> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const settings = useSettingsStore.getState();

    const providerId = options.providerId ?? settings.activeProviderId ?? '';
    const modelId = options.modelId ?? settings.activeModelId ?? '';
    this.activeTaskContext = options.taskContext ?? null;

    const customApproval = {
      categoryOverrides: Object.fromEntries(
        Object.entries(settings.customApprovalRules.categoryRules).map(([key, autoApprove]) => [
          key,
          !autoApprove,
        ]),
      ) as Record<ToolCategory, boolean>,
      toolOverrides: Object.fromEntries(
        Object.entries(settings.customApprovalRules.toolRules).map(([key, autoApprove]) => [
          key,
          !autoApprove,
        ]),
      ),
    };
    const effectivePolicy = resolveEffectiveAgentPolicy(
      store.mode as AgentType,
      modelId,
      providerId,
      {
        approvalMode: settings.approvalMode,
        customApproval,
        maxIterations: settings.interactionLimitEnabled ? settings.maxIterations : null,
        maxOutputTokens: settings.maxTokens,
      },
    );

    // Sync settings → harness config
    this.harness.setConfig({
      providerId,
      modelId,
      ...effectivePolicyConfig(effectivePolicy),
      thinking: this.buildThinkingConfig(providerId, modelId),
    });
    // mode IS the agent type — single source of truth
    this.harness.setAgentType(store.mode as AgentType);

    // Sync delegation chain so the agent is aware of mode switches
    this.harness.setDelegationChain(store.delegationChain);

    const dbg = (msg: string) => {
      const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
      console.log('[HarnessBridge]', msg);
      useAgentStore.getState().addDebugLine(line);
    };

    dbg(`Starting with provider="${providerId || '(default)'}" model="${modelId || '(default)'}"`);

    // Reset per-turn credit counter
    useAgentStore.getState().resetApiRequestCount();
    useAgentStore.getState().setTokenUsage(null);
    this._turnHadSubAgents = false;

    // Map store.mode → ConversationMode for the harness
    let harnessMode: ConversationMode = 'agent';
    if (store.mode === 'chat') harnessMode = 'chat';
    // SDD phases are driven by the explicit start/approve/resume methods. Chat
    // messages in a build tab must still execute as normal agent turns.
    this.harness.setMode(harnessMode);
    dbg(`Mode: ${harnessMode} (agent: ${store.mode})`);

    if (this.isolatedRuntime) this.syncSharedAgentPreferences();

    const contextFiles = store.contextFiles;
    const ruleTargetPaths = collectRuleTargetPaths(this.harness.getWorkspacePath(), contextFiles);
    await this.loadRules(ruleTargetPaths);
    if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);

    // Sync active skills from skills store → harness (respects per-mode assignments)
    const activeSkillNames = this.isolatedRuntime
      ? (this.harness
          .getSkillLoader()
          ?.getActive()
          .map((skill) => skill.frontmatter.name) ?? [])
      : useSkillsStore
          .getState()
          .getActiveForMode(store.mode as AgentType)
          .map((skill) => skill.name);
    this.syncActiveSkills(activeSkillNames);
    dbg(`Skills ativas: ${activeSkillNames.length}`);

    // Sync active rules from rules store → harness
    const activeRules = this.isolatedRuntime
      ? (this.harness.getRuleLoader()?.getActive() ?? [])
      : useRulesStore.getState().getActiveRules();
    this.syncActiveRules(activeRules.map((r) => r.id));
    dbg(`Rules ativas: ${activeRules.length}`);

    this.bindTaskExecutionTarget(this.harness.getConversationId());

    // Start indexing immediately, but do not hold back the local message and
    // working state while SQLite responds. The agent run still awaits this
    // promise before contacting the provider, so VORTEX sees the session as
    // soon as the user submits while persistence remains ordered.
    const conversationReady = this.ensureConversationExists(userMessage, providerId, modelId).catch(
      (error) => {
        if (this.isTurnIdentityCurrent(turn)) {
          dbg(
            `Could not index the conversation before the turn: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    );

    // Clear any context carried over from a previous tab before injecting fresh sources
    if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);
    this.clearTabContext();

    // Inject context files into the harness context manager
    if (contextFiles.length > 0) {
      dbg(`Injetando ${contextFiles.length} arquivo(s) de contexto`);
      for (const filePath of contextFiles) {
        if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);
        try {
          const content = await this.invokeForHarness<string>('read_file', { path: filePath });
          if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);
          const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
          const tokenEstimate = Math.ceil(content.length / 4);
          this.harness.addContextSource({
            id: `ctx-file-${filePath}`,
            type: 'context_chip',
            priority: 'high',
            content: `<file path="${filePath}">\n${content}\n</file>`,
            tokenEstimate,
            origin: 'explicit',
            identity: `file:${filePath.replace(/\\/g, '/').toLowerCase()}`,
            metadata: { filePath, fileName },
          });
        } catch {
          if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);
          // Might be a directory — list its tree instead
          try {
            const entries = await tauriInvokeRaw<Array<{ name: string; is_dir: boolean }>>(
              'list_dir_all',
              { path: filePath },
            );
            if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);
            const tree = entries.map((e) => `${e.is_dir ? '📁' : '📄'} ${e.name}`).join('\n');
            const dirName = filePath.split(/[\\/]/).pop() ?? filePath;
            const tokenEstimate = Math.ceil(tree.length / 4);
            this.harness.addContextSource({
              id: `ctx-dir-${filePath}`,
              type: 'context_chip',
              priority: 'high',
              content: `<directory path="${filePath}">\n${tree}\n</directory>`,
              tokenEstimate,
              origin: 'explicit',
              identity: `directory:${filePath.replace(/\\/g, '/').toLowerCase()}`,
              metadata: { filePath, fileName: dirName, isDirectory: true },
            });
          } catch (dirErr) {
            dbg(`Error reading context ${filePath}: ${dirErr}`);
          }
        }
      }
    }

    if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);

    const attachedTerminal = store.attachedTerminal;
    if (attachedTerminal) {
      this.harness.addContextSource({
        id: `terminal-${attachedTerminal.terminalId}-${attachedTerminal.sequence}`,
        type: 'terminal',
        priority: 'high',
        content: `<terminal_snapshot id="${attachedTerminal.terminalId}" name="${attachedTerminal.name}">\n${attachedTerminal.output}\n</terminal_snapshot>`,
        tokenEstimate: Math.ceil(attachedTerminal.output.length / 4),
        origin: 'explicit',
        identity: `terminal:${attachedTerminal.terminalId}:${attachedTerminal.sequence}`,
        metadata: {
          terminalId: attachedTerminal.terminalId,
          terminalName: attachedTerminal.name,
          sequence: attachedTerminal.sequence,
        },
      });
      useAgentStore.getState().setAttachedTerminal(null);
    }

    // Snapshot attached images and clear them from the store
    const attachedImages = store.attachedImages.slice();
    if (attachedImages.length > 0) {
      useAgentStore.getState().clearAttachedImages();
      dbg(`${attachedImages.length} imagem(ns) anexada(s)`);
    }

    // Build structured content blocks for the user message (text + images)
    const userBlocks: MessageContent[] = [{ type: 'text', text: userMessage }];
    const imageContent: Array<{ base64: string; mediaType: string }> = [];
    for (const img of attachedImages) {
      userBlocks.push({ type: 'image', base64: img.base64, mediaType: img.mediaType });
      imageContent.push({ base64: img.base64, mediaType: img.mediaType });
    }

    if (!options.hidden) {
      const userMsgId = crypto.randomUUID();
      useAgentStore.getState().addMessage({
        id: userMsgId,
        role: 'user',
        content: userMessage,
        blocks: userBlocks.length > 1 ? userBlocks : undefined,
        timestamp: Date.now(),
      });
    }

    // Auto-title the tab from first user message if still untitled
    {
      const s = useAgentStore.getState();
      const activeTab = s.openTabs.find((t) => t.id === s.activeTabId);
      if (activeTab && isPlaceholderVortexSessionTitle(activeTab.title)) {
        const autoTitle = resolveVortexSessionTitle({
          tabTitle: activeTab.title,
          firstUserMessage: userMessage,
        });
        s.updateTabTitle(s.activeTabId, autoTitle);
      }
    }

    configureProviderResilience({
      maxRetries: settings.agentMaxRetries,
      baseDelayMs: settings.agentRetryBaseDelayMs,
      maxDelayMs: settings.agentRetryMaxDelayMs,
      requestTimeoutMs: settings.agentRequestTimeoutMs,
      streamIdleTimeoutMs: settings.agentStreamIdleTimeoutMs,
    });
    // Create the first assistant row and bind streaming updates to its identity.
    const assistantMsgId = crypto.randomUUID();
    useAgentStore.getState().beginAssistantMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });
    turn.assistantMessageStarted = true;

    let notificationOutcome: 'success' | 'cancelled' | 'error' = 'error';
    let goalRun: GoalRun | null = null;
    let goalState: GoalState | null = null;
    try {
      // Build history from store messages (use fresh state after addMessage calls)
      // Exclude the last 2 messages (user + placeholder assistant for this turn)
      const storedMessages = useAgentStore.getState().messages;
      const historyMessages = storedMessages.slice(0, options.hidden ? -1 : -2);
      if (
        options.excludeLastAssistantFromHistory &&
        historyMessages[historyMessages.length - 1]?.role === 'assistant'
      ) {
        historyMessages.pop();
      }
      const history = normalizeAgentHistory(this.buildHistory(historyMessages));

      await conversationReady;
      if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);

      const conversationId = turn.conversationId;
      if (conversationId && store.mode === 'build') {
        goalState = await this.goalService.getState(conversationId);
        if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);
        if (goalState?.goal.status === 'active') {
          if (options.goalRunId) {
            goalRun = goalState.runs.find((run) => run.id === options.goalRunId) ?? null;
            if (!goalRun) throw new Error(`Goal run ${options.goalRunId} was not found.`);
          } else {
            goalRun = await this.goalService.startRun(conversationId, options.goalSource ?? 'user');
            if (!this.canContinueTurn(turn)) {
              await this.finishCancelledGoalRun(goalRun, goalState);
              return this.cancelBeforeHarness(turn);
            }
          }
        }
      }

      // Reset iteration tracking for the new turn
      // The conversation-scoped terminal runtime acquires a visible session only
      // when a terminal tool actually executes.

      // ── Inject deterministic environment context ──
      // Gives the agent awareness of the current workspace state before it starts
      await this.injectEnvironmentContext(turn);
      if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);

      // ── Pre-turn context hints ──
      // Analyze user message for file references and provide hints to the agent
      await this.injectContextHints(userMessage, turn);
      if (!this.canContinueTurn(turn)) return this.cancelBeforeHarness(turn);

      dbg(`Sending to LLM (${history.length} msgs in history)...`);

      turn.harnessStarted = true;
      const outcome = await this.harness.run({
        userMessage,
        history,
        images: imageContent.length > 0 ? imageContent : undefined,
        ruleTargetPaths,
        taskContext: options.taskContext,
        goalContext:
          options.goalContext ?? (goalState ? this.goalService.buildContext(goalState) : undefined),
      });
      if (!this.isTurnIdentityCurrent(turn)) return outcome;
      const { turnId, response, turnRecord, status } = outcome;
      this.lastCompletedTurnId = turnId;
      notificationOutcome =
        status === 'complete'
          ? 'success'
          : status === 'cancelled' || status === 'cancelled_partial'
            ? 'cancelled'
            : 'error';

      dbg(
        `Response received (${response.length} chars, ${turnRecord.iterations} iterations, ${turnRecord.toolCalls.length} tool calls)`,
      );

      // Flush any remaining streaming text
      useAgentStore.getState().flushStreamingText();

      // Update the last assistant message with the final response
      if (status === 'error')
        useAgentStore.getState().updateLastAssistantError(parseProviderError(response));
      else if (status !== 'recoverable_error')
        useAgentStore.getState().updateLastAssistantContent(response);

      const summary = buildTurnSummary(
        turnId,
        turnRecord,
        useAgentStore.getState().agentEditSessions,
      );
      useAgentStore.getState().setTurnSummary(turnId, summary);
      try {
        await this.commitTurn(userMessage, turnRecord, providerId, modelId);
      } catch (error) {
        if (this.isTurnIdentityCurrent(turn)) {
          dbg(
            `Could not persist completed turn: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (!this.isTurnIdentityCurrent(turn)) return outcome;
      try {
        await this.persistTurnRecord(turnRecord, true);
      } catch (error) {
        if (this.isTurnIdentityCurrent(turn)) {
          dbg(
            `Could not persist completed turn record: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (!this.isTurnIdentityCurrent(turn)) return outcome;
      await this.refreshSessionUsage();
      if (goalRun && goalState) {
        try {
          const decision = await this.goalService.finishTurn(goalState.goal.conversationId, {
            runId: goalRun.id,
            turnId,
            status,
            response,
            tokenUsage: turnRecord.tokenUsage,
            toolCalls: turnRecord.toolCalls,
            durationMs: turnRecord.durationMs,
            completionRequest: extractGoalCompletionRequest(turnRecord, turnId),
          });
          this.handleGoalChange({
            state: decision.state,
            type: decision.state.goal.status === 'complete' ? 'completed' : 'run_completed',
          });
          if (decision.shouldContinue)
            this.scheduleGoalContinuation(decision.state.goal.conversationId);
        } catch (goalError) {
          if (this.isTurnIdentityCurrent(turn)) {
            dbg(
              `Failed to persist goal turn: ${goalError instanceof Error ? goalError.message : String(goalError)}`,
            );
          }
        }
      }
      return outcome;
    } catch (err) {
      if (!this.isTurnIdentityCurrent(turn)) return null;
      const rawMsg = err instanceof Error ? err.message : 'Unknown error';
      if (turn.cancelled) {
        useAgentStore.getState().setTerminalStatus('cancelled');
        if (goalRun && goalState) await this.finishCancelledGoalRun(goalRun, goalState);
        return null;
      }
      const friendlyMsg = parseProviderError(rawMsg);
      dbg(`ERROR: ${rawMsg}`);
      useAgentStore.getState().updateLastAssistantError(friendlyMsg);
      if (goalRun && goalState) {
        try {
          const decision = await this.goalService.finishTurn(goalState.goal.conversationId, {
            runId: goalRun.id,
            turnId: this.activeTurnId ?? crypto.randomUUID(),
            status: 'error',
            tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            toolCalls: [],
            durationMs: 0,
            error: rawMsg,
          });
          this.handleGoalChange({ state: decision.state, type: 'run_completed' });
        } catch (goalError) {
          if (this.isTurnIdentityCurrent(turn)) {
            dbg(
              `Failed to account goal turn: ${goalError instanceof Error ? goalError.message : String(goalError)}`,
            );
          }
        }
      }
      return null;
    } finally {
      // OS notification when the app is in the background
      if (document.hidden && this.isTurnIdentityCurrent(turn)) {
        try {
          const { openTabs, activeTabId } = useAgentStore.getState();
          const tabTitle = openTabs.find((t) => t.id === activeTabId)?.title ?? 'Agent';
          await tauriInvokeRaw('notify_agent_done', {
            title: tabTitle,
            body:
              turn.cancelled || notificationOutcome === 'cancelled'
                ? 'Agent run was cancelled'
                : notificationOutcome === 'success'
                  ? 'Agent finished working'
                  : 'Agent needs your attention',
          });
        } catch {
          // Notification is best-effort — non-fatal
        }
      }
    }
  }

  async retryTurn(): Promise<void> {
    const useAgentStore = this.agentStore;
    const state = useAgentStore.getState();
    if (state.isStreaming || !state.recoverableError) return;
    const lastUserMessage = [...state.messages]
      .reverse()
      .find((message) => message.role === 'user');
    if (!lastUserMessage) return;
    state.setRecoverableError(null);
    await this.sendMessage(lastUserMessage.content, {
      hidden: true,
      excludeLastAssistantFromHistory: true,
    });
  }

  async continuePartialTurn(): Promise<void> {
    const useAgentStore = this.agentStore;
    const state = useAgentStore.getState();
    const recovery = state.recoverableError;
    if (state.isStreaming || !recovery || recovery.action !== 'continue') return;
    state.setRecoverableError(null);
    await this.sendMessage(
      `Continue the interrupted response from exactly where it stopped. Do not repeat completed content. The preserved partial response was:\n\n${recovery.partialText}`,
      { hidden: true },
    );
  }

  private bindTaskExecutionTarget(conversationId: string): void {
    this.taskTargetUnregister?.();
    let taskTurnActive = false;
    const target: TaskExecutionTarget = {
      prepare: async (request, context) => {
        if (context.signal.aborted) throw new Error('Task execution was cancelled.');
        await this.ensureConversationPersisted(
          `Task: ${request.task.title}`,
          context.providerId,
          context.modelId,
        );
      },
      run: async (request: TaskExecutionRequest, context) => {
        if (context.signal.aborted) throw new Error('Task execution was cancelled.');
        await this.waitForTurnIdle(context.signal);
        if (this.disposed) throw new Error('The Desktop agent runtime is unavailable.');
        if (context.signal.aborted) throw new Error('Task execution was cancelled.');
        taskTurnActive = true;
        try {
          await this.sendMessage(request.instructions, {
            providerId: context.providerId,
            modelId: context.modelId,
            taskContext: context.taskContext,
          });
        } finally {
          taskTurnActive = false;
        }
        return {
          conversationId: this.agentStore.getState().conversationId,
          turnId: this.lastCompletedTurnId,
          summary: `Task completed: ${request.task.title}`,
        };
      },
      cancel: () => {
        if (taskTurnActive) this.cancel();
      },
    };
    this.taskTargetUnregister = kanbanTaskExecutionCoordinator.registerTarget(
      conversationId,
      target,
    );
  }

  getLastCompletedTurnId(): string | null {
    return this.lastCompletedTurnId;
  }

  async ensureConversationPersisted(
    titleSource: string,
    providerId?: string,
    modelId?: string,
  ): Promise<void> {
    await this.ensureConversationExists(titleSource, providerId, modelId);
  }

  private updateActiveTaskRunState(stateName: 'waiting' | 'running'): void {
    const taskContext = this.activeTaskContext;
    if (!taskContext || !this._projectId) return;
    void kanbanTaskExecutionCoordinator
      .updateTaskRunState(this._projectId, taskContext.taskRunId, stateName)
      .catch((error: unknown) => {
        console.warn('[kanban] Failed to update task waiting state:', error);
      });
  }

  private waitForTurnIdle(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error('Task execution was cancelled.'));
    if (!this.agentStore.getState().isStreaming) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let unsubscribe: () => void = () => undefined;
      const finish = (error?: Error) => {
        unsubscribe();
        signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => finish(new Error('Task execution was cancelled.'));
      unsubscribe = this.agentStore.subscribe((state) => {
        if (!state.isStreaming) finish();
      });
      signal.addEventListener('abort', onAbort, { once: true });
      if (!this.agentStore.getState().isStreaming) finish();
    });
  }

  cancel(): void {
    const useAgentStore = this.agentStore;
    const turn = this.activeTurn;
    if (turn) {
      turn.cancelled = true;
      if (!turn.harnessStarted && this.isTurnIdentityCurrent(turn)) {
        useAgentStore.getState().setTerminalStatus('cancelled');
        useAgentStore.getState().setStreaming(false);
      }
    }
    const queuedTurn = turn ? undefined : this.queuedTurns.find((request) => !request.cancelled);
    if (queuedTurn) queuedTurn.cancelled = true;
    useAgentStore.setState((draft) => {
      for (const toolCall of draft.pendingToolCalls) {
        if (toolCall.status === 'running' || toolCall.status === 'approved') {
          toolCall.status = 'cancelling';
        }
      }
    });
    // Cancel queued children first so they never start.
    this.subAgentCoordinator.cancelAllQueued();
    // Cancel all active sub-agent runners.
    for (const runner of this._subAgentRunners.values()) {
      runner.cancel();
    }
    this._subAgentRunners.clear();
    this._approvalOwner.clear();
    if ((!turn && !queuedTurn) || turn?.harnessStarted) this.harness.cancel();
  }

  private isTurnIdentityCurrent(turn: BridgeTurn): boolean {
    if (this.disposed || this.activeTurn !== turn || turn.projectId !== this._projectId)
      return false;
    const state = this.agentStore.getState();
    if (state.conversationId !== turn.conversationId || state.activeTabId !== turn.tabId)
      return false;
    return this.isProjectCurrent(turn.projectId);
  }

  private isProjectCurrent(projectId = this._projectId): boolean {
    return (
      this.isolatedRuntime ||
      projectPathKey(useProjectStore.getState().rootPath ?? '') === projectPathKey(projectId)
    );
  }

  private canContinueTurn(turn: BridgeTurn): boolean {
    return !turn.cancelled && this.isTurnIdentityCurrent(turn);
  }

  private cancelBeforeHarness(turn: BridgeTurn): null {
    if (this.isTurnIdentityCurrent(turn)) {
      this.agentStore.getState().setTerminalStatus('cancelled');
    }
    return null;
  }

  private async finishCancelledGoalRun(goalRun: GoalRun, goalState: GoalState): Promise<void> {
    try {
      const decision = await this.goalService.finishTurn(goalState.goal.conversationId, {
        runId: goalRun.id,
        turnId: goalRun.turnId ?? crypto.randomUUID(),
        status: 'cancelled',
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        toolCalls: [],
        durationMs: 0,
      });
      const turn = this.activeTurn;
      if (turn && this.isTurnIdentityCurrent(turn)) {
        this.handleGoalChange({ state: decision.state, type: 'run_completed' });
      }
    } catch (error) {
      const turn = this.activeTurn;
      if (turn && this.isTurnIdentityCurrent(turn)) {
        this.agentStore
          .getState()
          .addDebugLine(
            `[HarnessBridge] Failed to account cancelled goal run: ${error instanceof Error ? error.message : String(error)}`,
          );
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const unregisterTasks = this.taskTargetUnregister;
    this.taskTargetUnregister = null;
    if (unregisterTasks) {
      try {
        unregisterTasks();
      } catch (error) {
        console.error('[HarnessBridge] Task target cleanup failed.', error);
      }
    }
    const unsubscribePtyExit = this.ptyExitUnsubscribe;
    this.ptyExitUnsubscribe = null;
    if (unsubscribePtyExit) {
      try {
        unsubscribePtyExit();
      } catch (error) {
        console.error('[HarnessBridge] PTY exit listener cleanup failed.', error);
      }
    }
    this.cancel();
    this.clearExternalPathGrants();
    for (const timer of this.goalContinuationTimers.values()) clearTimeout(timer);
    this.goalContinuationTimers.clear();
    this.goalContinuationInFlight.clear();
  }

  /** Cancel a single sub-agent: queued children never start; active ones abort. */
  cancelSubAgent(id: string): void {
    const runner = this._subAgentRunners.get(id);
    if (runner) {
      runner.cancel();
      return;
    }
    this.subAgentCoordinator.cancelQueued((candidate) => candidate === id);
  }

  /** Pause SDD execution after the current task finishes */
  pauseSdd(): void {
    this.harness.getSddEngine()?.pause();
    this.debug('SDD paused');
  }

  /** Resume SDD execution */
  async resumeSdd(): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    store.setStreaming(true);
    try {
      const result = await this.harness.resumeSddPlan();
      if (!result.startsWith('SDD execution ')) {
        store.addMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result,
          timestamp: Date.now(),
        });
      }
      this.debug(result);
    } finally {
      store.setStreaming(false);
    }
  }

  /** Skip a specific SDD task */
  async skipSddTask(taskId: string): Promise<void> {
    await this.harness.getSddEngine()?.skipTask(taskId);
    this.debug(`SDD task skipped: ${taskId}`);
  }

  async retrySddTask(taskId: string): Promise<void> {
    const useAgentStore = this.agentStore;
    await this.harness.getSddEngine()?.retryTask(taskId);
    useAgentStore.getState().updateSddTask(taskId, { status: 'pending', agentOutput: null });
    this.debug(`SDD task queued for retry: ${taskId}`);
  }

  /**
   * Delegate a failed SDD task to the Debug agent.
   * Switches mode to debug and sends the error context as a message.
   */
  async debugFailedSddTask(): Promise<void> {
    const useAgentStore = this.agentStore;
    const failedTask = this.harness.getSddFailedTask();
    if (!failedTask) {
      this.debug('No failed SDD task to debug');
      return;
    }

    const store = useAgentStore.getState();
    store.setMode('debug');
    this.setAgentType('debug');

    const prompt = `A task in an SDD implementation plan has failed. Please investigate and fix the root cause.

## Failed Task
- Title: ${failedTask.title}
- Description: ${failedTask.description}
- Affected Files: ${failedTask.files.join(', ') || 'Not specified'}

## Error Output
${failedTask.agentOutput || 'No output captured'}

Investigate the error, fix the underlying issue in the affected files, and verify the fix works. Once fixed, the user will resume the SDD plan execution.`;

    await this.sendMessage(prompt);
  }

  /**
   * Start a new SDD session explicitly.
   * Generates the spec and surfaces it to the store for user review.
   */
  async startSdd(description: string): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const settings = useSettingsStore.getState();

    this.harness.setConfig({
      providerId: settings.activeProviderId ?? '',
      modelId: settings.activeModelId ?? '',
    });
    this.harness.setAgentType('build');
    this.harness.setMode('sdd');

    if (!store.conversationId) {
      const id = crypto.randomUUID();
      store.setConversationId(id);
      this.harness.setConversationId(id);
    } else {
      this.harness.setConversationId(store.conversationId);
    }

    store.setStreaming(true);
    store.setSddPhase('describing');

    try {
      await this.ensureConversationExists(description);
      const { spec } = await this.harness.startSdd(description);
      store.setSddSpec(spec);
      // Phase changes are emitted by the SDD engine events → handleEvent
      this.debug(`SDD spec generated (${spec.length} chars)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.debug(`SDD start error: ${msg}`);
      store.setSddPhase(null);
    } finally {
      store.setStreaming(false);
    }
  }

  /**
   * Approve the SDD spec. Generates the plan and surfaces tasks for review.
   */
  async approveSddSpec(): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    store.setStreaming(true);

    try {
      const tasks = await this.harness.approveSddSpec();
      store.setSddTasks(tasks);
      // Phase event (planning) is emitted by the engine
      this.debug(`SDD plan generated (${tasks.length} tasks)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.debug(`SDD approve spec error: ${msg}`);
    } finally {
      store.setStreaming(false);
    }
  }

  /**
   * Reject the SDD spec and regenerate it.
   */
  async rejectSddSpec(feedback?: string): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    store.setStreaming(true);
    store.setSddSpec(null);
    store.setSddPhase('describing');

    try {
      const spec = await this.harness.rejectSddSpec(feedback);
      store.setSddSpec(spec);
      this.debug(`SDD spec regenerated (${spec.length} chars)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.debug(`SDD reject spec error: ${msg}`);
    } finally {
      store.setStreaming(false);
    }
  }

  /**
   * Promote the current build-mode conversation into a structured SDD session.
   */
  async promoteToSdd(): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const lastUserMessage = [...store.messages].reverse().find((m) => m.role === 'user');
    const description =
      lastUserMessage?.content || 'Continue implementation from current conversation';

    this.harness.setConfig({
      providerId: useSettingsStore.getState().activeProviderId ?? '',
      modelId: useSettingsStore.getState().activeModelId ?? '',
    });
    this.harness.setAgentType('build');
    this.harness.setMode('sdd');

    if (!store.conversationId) {
      const id = crypto.randomUUID();
      store.setConversationId(id);
      this.harness.setConversationId(id);
    } else {
      this.harness.setConversationId(store.conversationId);
    }

    store.setStreaming(true);
    store.setSddPhase('describing');

    try {
      await this.ensureConversationExists(description);
      const { sessionId, spec } = await this.harness.promoteToSdd(description);
      store.setSddSpec(spec);
      this.debug(`Conversation promoted to SDD session ${sessionId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.debug(`Promote to SDD error: ${msg}`);
      store.setSddPhase(null);
    } finally {
      store.setStreaming(false);
    }
  }

  /**
   * Approve the SDD plan and start execution.
   */
  async approveSddPlan(): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    store.setStreaming(true);

    try {
      const review = await this.harness.approveSddPlan();
      if (review.startsWith('SDD execution ')) this.debug(review);
      else {
        store.addMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: review,
          timestamp: Date.now(),
        });
        this.debug('SDD execution complete');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.debug(`SDD plan execution error: ${msg}`);
    } finally {
      store.setStreaming(false);
    }
  }

  setAgentType(type: AgentType): void {
    const useAgentStore = this.agentStore;
    const current = useAgentStore.getState();
    if (
      type !== 'build' &&
      this.harness.getAgentType() === 'build' &&
      current.goal?.goal.status === 'active'
    ) {
      void this.pauseActiveGoalBeforeLeavingBuild().catch((error: unknown) => {
        this.debug(
          `Could not pause the active goal before leaving Build mode: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    this.harness.setAgentType(type);
    useAgentStore.getState().setMode(type as import('@/stores/agent-store').AgentMode);
  }

  /** Resolve a pending mode switch delegation (approve or deny) */
  resolveModeSwitch(approved: boolean): void {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const req = store.pendingModeSwitch;
    if (!req) return;

    // Resolve the promise that pauses the harness loop
    const resolver = this.modeSwitchResolvers.get(req.id);
    if (!resolver) return;
    this.modeSwitchResolvers.delete(req.id);
    store.setPendingModeSwitch(null);
    this.debug(
      approved
        ? `Delegation approved: ${req.fromMode} → ${req.toMode}`
        : `Delegation rejected: ${req.fromMode} → ${req.toMode}`,
    );
    resolver(approved);
  }

  /** Resolve a pending approval from the UI */
  resolveApproval(id: string, decision: ApprovalDecision): void {
    const useAgentStore = this.agentStore;
    const resolver = this.approvalResolvers.get(id);
    if (resolver) {
      resolver(decision);
      this.approvalResolvers.delete(id);
      useAgentStore.getState().removePendingApproval(id);
    }
  }

  /** Confirm an external-path request through native OS dialogs before approval. */
  confirmExternalPathAccess(
    request: ExternalPathAccessRequest,
    grantType: 'once' | 'session-directory',
  ): Promise<string> {
    return tauriInvoke('workspace_confirm_external_access', {
      request,
      grantType,
      workspacePath: this.harness.getWorkspacePath(),
    });
  }

  /** Mark a tool as trusted for the current session (session-trust mode).
   *  When `toolCallId` belongs to an active sub-agent approval, the trust is
   *  applied to that sub-agent's own tool router (the one that issued it). */
  trustToolForSession(toolName: string, toolCallId?: string): void {
    if (toolCallId) {
      const ownerId = this._approvalOwner.get(toolCallId);
      const runner = ownerId
        ? this._subAgentRunners.get(ownerId)
        : this._subAgentRunners.get(toolCallId);
      if (runner) {
        runner.trustTool(toolName);
        this.debug(`🔓 Tool trusted for sub-agent session: ${toolName}`);
        return;
      }
    }
    if (this.harness) {
      this.harness.getToolRouter()?.trustToolForSession?.(toolName);
      this.debug(`🔓 Tool trusted for session: ${toolName}`);
    }
  }

  /** Clear all session-trusted tools (called on new session) */
  clearSessionTrust(): void {
    if (this.harness) {
      this.harness.getToolRouter()?.clearSessionTrust?.();
      this.debug('🔒 Session trust cleared');
    }
  }

  /** Clear mandatory external path grants when switching sessions. */
  clearExternalPathGrants(): void {
    if (this.harness) {
      const grantIds = this.harness.getToolRouter()?.clearExternalPathGrants?.() ?? [];
      if (grantIds.length > 0) {
        void tauriInvoke('workspace_revoke_external_grants', { grantIds }).catch((error) => {
          this.debug(`Could not revoke native external-path grants: ${String(error)}`);
        });
      }
      this.debug('🔒 External path grants cleared');
    }
  }

  /** Accept or revert a single pending file change */
  async resolveFileChange(id: string, accepted: boolean): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const change = store.pendingFileChanges.find((c) => c.id === id);
    if (!change || change.status !== 'pending') return;

    if (!accepted) {
      try {
        await this.restoreMutationSnapshot(
          change.filePath,
          {
            originalContent: change.originalContent,
          },
          expectedContentAfterChange(change),
        );
      } catch (error) {
        // Keep the change pending for recovery; surface the reason so the UI
        // can toast instead of silently dropping the revert.
        console.warn('[HarnessBridge] Revert refused, keeping change pending:', error);
        throw error;
      }
    } else await this.acceptMutationSnapshot(change.filePath);

    store.resolvePendingFileChange(id, accepted);
  }

  /** Accept or revert ALL pending file changes in bulk */
  async resolveAllFileChanges(accepted: boolean): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const pending = store.pendingFileChanges.filter((c) => c.status === 'pending');

    if (!accepted) {
      const failures: string[] = [];
      for (const change of pending) {
        try {
          await this.restoreMutationSnapshot(
            change.filePath,
            {
              originalContent: change.originalContent,
            },
            expectedContentAfterChange(change),
          );
          store.resolvePendingFileChange(change.id, accepted);
        } catch (error) {
          console.warn('[HarnessBridge] Revert refused, keeping change pending:', error);
          failures.push(
            `${change.filePath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `Could not revert ${failures.length} file(s); they remain pending for recovery:\n${failures.join('\n')}`,
        );
      }
    } else {
      for (const change of pending) await this.acceptMutationSnapshot(change.filePath);
    }

    store.resolveAllPendingFileChanges(accepted);
  }

  /** Accept or revert a single agent edit session */
  async resolveEditSession(id: string, accepted: boolean): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const session = store.agentEditSessions.find(
      (s) => s.id === id && (s.phase === 'streaming' || s.phase === 'pending_review'),
    );
    if (!session) return;

    if (!accepted) {
      try {
        await this.restoreMutationSnapshot(
          session.filePath,
          session,
          session.toolName === 'delete_file' ? null : session.newContent,
        );
      } catch (error) {
        console.warn('[HarnessBridge] Revert refused, keeping session pending:', error);
        throw error;
      }
    } else await this.acceptMutationSnapshot(session.filePath);

    store.resolveEditSession(id, accepted);

    // Also resolve legacy pending file change for the same file
    const legacy = store.pendingFileChanges.find(
      (c) => c.filePath === session.filePath && c.status === 'pending',
    );
    if (legacy) {
      store.resolvePendingFileChange(legacy.id, accepted);
    }
  }

  /** Accept or revert ALL active agent edit sessions */
  async resolveAllEditSessions(accepted: boolean): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const active = store.agentEditSessions.filter(
      (s) => s.phase === 'streaming' || s.phase === 'pending_review',
    );

    if (!accepted) {
      const failures: string[] = [];
      for (const session of active) {
        try {
          await this.restoreMutationSnapshot(
            session.filePath,
            session,
            session.toolName === 'delete_file' ? null : session.newContent,
          );
        } catch (error) {
          console.warn('[HarnessBridge] Revert refused, keeping session pending:', error);
          failures.push(
            `${session.filePath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `Could not revert ${failures.length} edit(s); they remain pending for recovery:\n${failures.join('\n')}`,
        );
      }
    } else {
      for (const session of active) await this.acceptMutationSnapshot(session.filePath);
    }

    store.resolveAllEditSessions(accepted);
    store.resolveAllPendingFileChanges(accepted);
  }

  async resolveTurnEditSessions(turnId: string, accepted: boolean): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const active = store.agentEditSessions.filter(
      (session) =>
        session.turnId === turnId &&
        (session.phase === 'streaming' || session.phase === 'pending_review'),
    );
    if (!accepted) {
      const failures: string[] = [];
      for (const session of active) {
        try {
          await this.restoreMutationSnapshot(
            session.filePath,
            session,
            session.toolName === 'delete_file' ? null : session.newContent,
          );
        } catch (error) {
          console.warn('[HarnessBridge] Revert refused, keeping session pending:', error);
          failures.push(
            `${session.filePath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `Could not revert ${failures.length} edit(s); they remain pending for recovery:\n${failures.join('\n')}`,
        );
      }
    } else {
      for (const session of active) await this.acceptMutationSnapshot(session.filePath);
    }
    store.resolveTurnEditSessions(turnId, accepted);
    for (const session of active) {
      const legacy = store.pendingFileChanges.find(
        (change) => change.toolCallId === session.toolCallId && change.status === 'pending',
      );
      if (legacy) store.resolvePendingFileChange(legacy.id, accepted);
    }
  }

  /** Sync conversation ID when restoring a previous session */
  restoreSession(conversationId: string): void {
    const useAgentStore = this.agentStore;
    const previousId = useAgentStore.getState().conversationId;
    this.harness.setConversationId(conversationId);
    useAgentStore.getState().setConversationId(conversationId);
    // A restored chat must be available as a Kanban current-chat target even
    // before the user sends another message. `sendMessage` also binds this
    // target, but relying on it makes existing sessions look unavailable to
    // tasks delegated from the board.
    this.bindTaskExecutionTarget(conversationId);
    // Clear session trust when switching sessions
    this.clearSessionTrust();
    this.clearExternalPathGrants();
    // Clear context sources so previous session's context doesn't bleed into the new one
    this.clearTabContext();
    this.restoreSddForConversation(conversationId).catch((error) => {
      this.debug(
        `Failed to restore SDD session: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    // Refresh cumulative token usage for the restored session from the DB.
    useAgentStore.getState().setSessionTokenUsage(null);
    void this.refreshSessionUsage();
    void this.restoreGoalForConversation(conversationId);
    if (previousId !== conversationId) {
      this.finalizeStaleConversationState(previousId);
    }
    this.debug(`Session restored: ${conversationId}`);
  }

  /**
   * Drop live-run state from the previous conversation and finalize tool
   * calls that will never resolve (their turn died with the switch or a
   * reload). Restored transcripts render those via the tool-call fallback
   * instead of spinning forever.
   */
  private finalizeStaleConversationState(_previousId: string | null): void {
    const state = this.agentStore.getState();
    if (state.subAgents.length > 0) {
      this.agentStore.setState({ subAgents: [] });
    }
    const interrupted =
      'Interrupted: the turn did not complete (session switched or app reloaded).';
    const staleIds = new Set<string>();
    for (const toolCall of state.pendingToolCalls) {
      if (
        toolCall.status === 'pending' ||
        toolCall.status === 'approved' ||
        toolCall.status === 'running' ||
        toolCall.status === 'cancelling'
      ) {
        staleIds.add(toolCall.id);
      }
    }
    for (const message of state.messages) {
      for (const toolCall of message.toolCalls ?? []) {
        if (
          toolCall.status === 'pending' ||
          toolCall.status === 'approved' ||
          toolCall.status === 'running' ||
          toolCall.status === 'cancelling'
        ) {
          staleIds.add(toolCall.id);
        }
      }
    }
    for (const id of staleIds) {
      this.agentStore
        .getState()
        .updateToolCall(id, { status: 'cancelled', error: interrupted, completedAt: Date.now() });
    }
  }

  async getGoal(): Promise<GoalState | null> {
    this.requireBuildGoalMode();
    const conversationId = this.agentStore.getState().conversationId;
    if (!conversationId) return null;
    const state = await this.goalService.getState(conversationId);
    this.handleGoalChange({ state, type: state ? 'updated' : 'cleared' });
    return state;
  }

  async createGoal(objective: string): Promise<GoalState> {
    this.requireBuildGoalMode();
    let conversationId = this.agentStore.getState().conversationId;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      this.agentStore.getState().setConversationId(conversationId);
      this.harness.setConversationId(conversationId);
      this.bindTaskExecutionTarget(conversationId);
    }
    await this.ensureConversationExists(objective);
    const state = await this.goalService.createGoal(conversationId, this._projectId, objective);
    this.handleGoalChange({ state, type: 'created' });
    return state;
  }

  async pauseGoal(): Promise<GoalState> {
    this.requireBuildGoalMode();
    const state = await this.goalService.pauseGoal(this.ensureGoalConversationId());
    this.clearGoalContinuationTimer(state.goal.conversationId);
    if (this.agentStore.getState().isStreaming) this.cancel();
    return state;
  }

  async resumeGoal(): Promise<GoalState> {
    this.requireBuildGoalMode();
    return this.goalService.resumeGoal(this.ensureGoalConversationId());
  }

  async editGoal(updates: GoalEditInput): Promise<GoalState> {
    this.requireBuildGoalMode();
    return this.goalService.editGoal(this.ensureGoalConversationId(), updates);
  }

  async cancelGoal(): Promise<GoalState> {
    this.requireBuildGoalMode();
    const state = await this.goalService.cancelGoal(this.ensureGoalConversationId());
    this.clearGoalContinuationTimer(state.goal.conversationId);
    if (this.agentStore.getState().isStreaming) this.cancel();
    return state;
  }

  async clearGoal(): Promise<void> {
    this.requireBuildGoalMode();
    const conversationId = this.ensureGoalConversationId();
    this.clearGoalContinuationTimer(conversationId);
    if (this.agentStore.getState().isStreaming) this.cancel();
    await this.goalService.clearGoal(conversationId);
  }

  async startGoalExecution(): Promise<void> {
    this.requireBuildGoalMode();
    const conversationId = this.ensureGoalConversationId();
    if (this.agentStore.getState().isStreaming) return;
    const state = await this.goalService.getState(conversationId);
    if (!state || state.goal.status !== 'active') return;
    const run = await this.goalService.startRun(conversationId, 'user');
    await this.sendMessage(
      'Continue the active persistent goal from its current checkpoint. Take the next concrete step and keep working until the goal is complete or a real blocker is reached.',
      { hidden: true, goalRunId: run.id, goalSource: 'user' },
    );
  }

  private scheduleGoalContinuation(conversationId: string): void {
    if (
      this.disposed ||
      this.goalContinuationTimers.has(conversationId) ||
      this.goalContinuationInFlight.has(conversationId)
    )
      return;
    const timer = setTimeout(() => {
      this.goalContinuationTimers.delete(conversationId);
      void this.runGoalContinuation(conversationId).catch((error) => {
        this.debug(
          `Goal continuation stopped: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, 100);
    this.goalContinuationTimers.set(conversationId, timer);
  }

  private async runGoalContinuation(conversationId: string): Promise<void> {
    if (this.disposed || this.goalContinuationInFlight.has(conversationId)) return;
    if (this.agentStore.getState().conversationId !== conversationId) return;
    if (this.agentStore.getState().mode !== 'build') return;
    if (this.agentStore.getState().isStreaming) {
      this.scheduleGoalContinuation(conversationId);
      return;
    }
    const state = await this.goalService.getState(conversationId);
    if (!state || state.goal.status !== 'active') return;
    this.goalContinuationInFlight.add(conversationId);
    try {
      const run = await this.goalService.startRun(conversationId, 'continuation');
      await this.sendMessage(
        'Continue the active persistent goal from its current checkpoint. Take the next concrete step and keep working until the goal is complete or a real blocker is reached.',
        { hidden: true, goalRunId: run.id, goalSource: 'continuation' },
      );
    } finally {
      this.goalContinuationInFlight.delete(conversationId);
    }
  }

  private clearGoalContinuationTimer(conversationId: string): void {
    const timer = this.goalContinuationTimers.get(conversationId);
    if (timer) clearTimeout(timer);
    this.goalContinuationTimers.delete(conversationId);
  }

  private ensureGoalConversationId(): string {
    const conversationId = this.agentStore.getState().conversationId;
    if (!conversationId) throw new Error('Create or restore a conversation before using a goal.');
    return conversationId;
  }

  private requireBuildGoalMode(): void {
    if (this.agentStore.getState().mode !== 'build') {
      throw new Error('Goal mode is available in Build mode only.');
    }
  }

  private async pauseActiveGoalBeforeLeavingBuild(): Promise<void> {
    const conversationId = this.agentStore.getState().conversationId;
    if (!conversationId) return;
    const state = await this.goalService.getState(conversationId);
    if (!state || state.goal.status !== 'active') return;
    await this.goalService.pauseGoal(conversationId);
    this.clearGoalContinuationTimer(conversationId);
    if (this.agentStore.getState().isStreaming) this.cancel();
  }

  private async restoreGoalForConversation(conversationId: string): Promise<void> {
    if (
      this.disposed ||
      !this.isProjectCurrent() ||
      this.agentStore.getState().conversationId !== conversationId
    ) {
      return;
    }
    try {
      const state = await this.goalService.getState(conversationId);
      if (
        !this.disposed &&
        this.isProjectCurrent() &&
        this.agentStore.getState().conversationId === conversationId
      ) {
        this.agentStore.getState().setGoal(state);
      }
    } catch (error) {
      if (!this.disposed && this.isProjectCurrent()) {
        this.debug(
          `Failed to restore goal: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private handleGoalChange(event: GoalChangeEvent): void {
    if (this.disposed) return;
    const conversationId = this.agentStore.getState().conversationId;
    if (!conversationId || (event.state && event.state.goal.conversationId !== conversationId))
      return;
    this.agentStore.getState().setGoal(event.state);
  }

  private async restoreSddForConversation(conversationId: string): Promise<void> {
    const useAgentStore = this.agentStore;
    if (
      this.disposed ||
      !this.isProjectCurrent() ||
      useAgentStore.getState().conversationId !== conversationId
    ) {
      return;
    }
    const rows = await tauriInvokeRaw<string[]>('db_sdd_list_sessions', {
      projectId: this._projectId,
    });
    if (
      this.disposed ||
      !this.isProjectCurrent() ||
      useAgentStore.getState().conversationId !== conversationId
    ) {
      return;
    }
    const sessions = rows.map((row) => JSON.parse(row) as SddSession);
    const active = sessions.find(
      (session) =>
        session.conversationId === conversationId &&
        !['completed', 'cancelled'].includes(session.status),
    );
    if (!active) return;
    const taskRows = await tauriInvokeRaw<string[]>('db_sdd_get_tasks', { sessionId: active.id });
    if (
      this.disposed ||
      !this.isProjectCurrent() ||
      useAgentStore.getState().conversationId !== conversationId
    ) {
      return;
    }
    const tasks = taskRows.map((row) => JSON.parse(row) as SddTask);
    this.harness.restoreSddSession(active.id);
    const store = useAgentStore.getState();
    store.setSddPhase(active.status);
    store.setSddSpec(active.spec);
    store.setSddTasks(tasks);
  }

  /** Clear harness context sources (call when switching tabs or restoring sessions). */
  clearTabContext(): void {
    const useAgentStore = this.agentStore;
    this.harness.getContextManager().clearConversationContext();
    useAgentStore.getState().setGatheredContext([]);
  }

  /**
   * Subscribe to tab switches in the Zustand store.
   * When the user switches tabs, immediately sync the harness to the new tab's state.
   */
  private subscribeToTabSwitches(): void {
    const useAgentStore = this.agentStore;
    let prevTabId = useAgentStore.getState().activeTabId;
    useAgentStore.subscribe((state) => {
      if (this.disposed) return;
      if (state.activeTabId !== prevTabId) {
        prevTabId = state.activeTabId;
        this.syncToActiveTab(state);
      }
    });
  }

  /** Sync the harness to whatever tab is currently active (called on tab switch). */
  private syncToActiveTab(state: ReturnType<typeof useAgentStore.getState>): void {
    const useAgentStore = this.agentStore;
    // Reset context so nothing bleeds from the previous tab
    this.clearTabContext();
    // Point the harness at the new tab's conversation
    if (state.conversationId) {
      this.harness.setConversationId(state.conversationId);
      // Keep the current-chat delegation target aligned with the active tab.
      // Without this, a tab switch leaves the coordinator registered against
      // the previous conversation until the new tab sends a message.
      this.bindTaskExecutionTarget(state.conversationId);
      // Refresh cumulative token usage for the new active tab from the DB.
      useAgentStore.getState().setSessionTokenUsage(null);
      void this.refreshSessionUsage();
    }
    this.debug(
      `Harness synced to tab: ${state.activeTabId} (conv: ${state.conversationId ?? 'none'})`,
    );
  }

  async loadSkills(): Promise<Skill[]> {
    try {
      await this.harness.loadSkills();
      if (this.disposed) return [];
      this.syncSharedAgentPreferences();
      const loader = this.harness.getSkillLoader();
      const all = loader?.getAll() ?? [];
      this.debug(`Skills loaded: ${all.length} total`);
      return all;
    } catch (err) {
      this.debug(`Failed to load skills: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /** Sync the active skill set from the skills store to the harness before a run */
  syncActiveSkills(activeSkillNames: string[]): void {
    const loader = this.harness.getSkillLoader();
    if (!loader) return;
    // Deactivate all, then activate only the ones from the store
    for (const skill of loader.getAll()) {
      skill.active = false;
    }
    for (const name of activeSkillNames) {
      loader.activate(name);
    }
    // Update context manager
    const active = loader.getActive();
    this.harness.setActiveSkills(active);
    this.harness.getContextManager().setAllSkills(loader.getAll());
  }

  /** Apply persisted UI preferences to an isolated runtime without replacing shared stores. */
  syncSharedAgentPreferences(): void {
    if (!this.isolatedRuntime) return;

    const rules = useRulesStore.getState();
    const ruleLoader = this.harness.getRuleLoader();
    if (ruleLoader) {
      for (const rule of ruleLoader.getAll()) {
        if (!rule.mandatory) {
          ruleLoader.setEnabled(rule.id, rules.enabledMap[rule.id] ?? rule.enabled);
        }
      }
      this.syncActiveRules(ruleLoader.getActive().map((rule) => rule.id));
    }

    const skills = useSkillsStore.getState();
    const skillLoader = this.harness.getSkillLoader();
    if (skillLoader) {
      const mode = this.agentStore.getState().mode as AgentType;
      for (const skill of skillLoader.getAll()) {
        const enabled = skills.enabledMap[skill.id] ?? skill.active;
        const modes = skills.modeOverrides[skill.id] ?? [];
        skill.active = enabled && (modes.length === 0 || modes.includes(mode));
      }
      this.harness.setActiveSkills(skillLoader.getActive());
      this.harness.getContextManager().setAllSkills(skillLoader.getAll());
    }
  }

  async loadRules(
    targetPaths?: readonly string[],
  ): Promise<import('@hyscode/agent-harness').Rule[]> {
    const turn = this.activeTurn;
    try {
      const loader = this.harness.getRuleLoader();
      loader?.setGlobalPath(
        useSettingsStore.getState().globalRulesPath.trim() ||
          `${HarnessBridge.getHomePath()}/.config/hyscode/rules`,
      );
      const all = await this.harness.refreshRules(
        targetPaths ??
          collectRuleTargetPaths(
            this.harness.getWorkspacePath(),
            this.agentStore.getState().contextFiles,
          ),
      );
      if (this.disposed || (turn && !this.canContinueTurn(turn))) return [];
      this.ruleDiagnostics = this.harness.getRuleLoader()?.getDiagnostics() ?? [];
      this.debug(`Rules loaded: ${all.length} total`);
      return all;
    } catch (err) {
      if (!this.disposed && (!turn || this.canContinueTurn(turn))) {
        this.debug(`Failed to load rules: ${err instanceof Error ? err.message : String(err)}`);
      }
      return [];
    }
  }

  getRuleDiagnostics(): RuleDiagnostic[] {
    return [...this.ruleDiagnostics];
  }

  /** Sync the active rule set from the rules store to the harness before a run */
  syncActiveRules(activeRuleIds: string[]): void {
    const loader = this.harness.getRuleLoader();
    if (!loader) return;
    // Disable all, then enable only the ones from the store
    for (const rule of loader.getAll()) {
      if (!rule.mandatory) loader.disable(rule.id);
    }
    for (const id of activeRuleIds) {
      loader.enable(id);
    }
    // Update context manager
    const active = loader.getActive();
    this.harness.setActiveRules(active);
  }

  /** Load rules from disk and sync enabled state with the store.
   *  Called once at bridge init so rules are active from the first turn. */
  async loadAndSyncRules(): Promise<void> {
    try {
      const discovered = await this.loadRules();
      if (!this.disposed) {
        if (this.isolatedRuntime) {
          this.syncSharedAgentPreferences();
          this.debug(`Rules synced for isolated runtime: ${discovered.length} discovered`);
        } else {
          useRulesStore.getState().setDiscoveredRules(discovered);
          const active = useRulesStore.getState().getActiveRules();
          this.syncActiveRules(active.map((r) => r.id));
          this.debug(`Rules synced: ${active.length}/${discovered.length} active`);
        }
      }
    } catch (err) {
      this.debug(`Rules init failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Register the spawn_subagent built-in tool so non-chat agents can delegate subtasks. */
  private registerSpawnSubagentTool(): void {
    const bridge = this;
    const useAgentStore = this.agentStore;

    const handler: ToolHandler = {
      definition: {
        name: 'spawn_subagent',
        description:
          'Delegate a focused subtask to a specialized sub-agent. The parent waits for the sub-agent to finish and then receives its result. Call it directly with {task, mode}; never wrap it in invoke_external_tool and never call both for the same subtask. Multiple spawn_subagent calls in one response run concurrently (review runs in parallel; build/debug/plan wait for an exclusive workspace slot). Use this to apply a specialist agent (for example review or debug) to a self-contained subtask. Not available in chat mode.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description:
                'Clear, self-contained description of the subtask. Include all context needed for the sub-agent to work independently.',
            },
            mode: {
              type: 'string',
              enum: ['build', 'review', 'debug', 'plan'],
              description:
                'The agent mode to use. build=implement code, review=analyze code quality, debug=investigate bugs, plan=create implementation plan.',
            },
          },
          required: ['task'],
        },
      } satisfies ToolDefinition,
      category: 'meta' as ToolCategory,
      requiresApproval: false,
      // Delegation batches are the only tool calls allowed to run concurrently.
      parallel: true,
      execute: async (
        input: Record<string, unknown>,
        ctx: ToolExecutionContext,
      ): Promise<ToolResult> => {
        const settings = useSettingsStore.getState();
        const store = useAgentStore.getState();
        const subAgentId = ctx.toolCallId;

        const { task, mode: inputMode } = input as { task: string; mode?: AgentMode };
        // Fall back to the configured default mode when the LLM omits it
        const mode: AgentMode = inputMode ?? settings.subAgentDefaultMode;

        // Always record the spawn attempt BEFORE any rejection so the card
        // renders an explicit error instead of an infinite "working…" spinner.
        const fail = (message: string): ToolResult => {
          store.addSubAgent({
            id: subAgentId,
            task,
            mode,
            status: 'error',
            output: message,
            toolCalls: [],
            startedAt: Date.now(),
            completedAt: Date.now(),
          });
          return { success: false, output: '', error: message };
        };

        if (!settings.subAgentEnabled) {
          return fail('Sub-agents are disabled in Settings → Sub-agents.');
        }

        // Prevent spawning a sub-agent in the same mode as the parent.
        // The harness agent type is the source of truth (the store mode can
        // drift from it during SDD phases).
        const parentMode = bridge.harness.getAgentType();
        if (mode === parentMode) {
          const alternatives: Record<string, string> = {
            build: 'review',
            review: 'build',
            debug: 'build',
            plan: 'review',
          };
          const suggested = alternatives[mode] ?? 'review';
          return fail(
            `Cannot spawn a '${mode}' sub-agent from a '${parentMode}' parent — same-mode recursion is wasteful. Use '${suggested}' mode instead, or handle this task yourself.`,
          );
        }

        // Review children are read-only and may run in parallel. Build, debug
        // and plan children mutate the workspace and take an exclusive lease.
        const resourceMode: SubAgentResourceMode = mode === 'review' ? 'shared' : 'exclusive';
        const subAgent: SubAgentState = {
          id: subAgentId,
          task,
          mode,
          conversationId: store.conversationId ?? undefined,
          status: 'queued',
          output: '',
          toolCalls: [],
          startedAt: Date.now(),
          queuePosition: bridge.subAgentCoordinator.queueLength + 1,
          resourceMode,
        };
        store.addSubAgent(subAgent);
        bridge._turnHadSubAgents = true;

        return bridge.subAgentCoordinator
          .submit(subAgentId, mode, resourceMode, async () => {
            store.updateSubAgent(subAgentId, { status: 'running', queuePosition: undefined });

            // Inherit skills scoped to the sub-agent's mode (not the parent's).
            const activeForMode = useSkillsStore.getState().getActiveForMode(mode as AgentType);
            const modeSkillNames = new Set(activeForMode.map((s) => s.name));
            const skills = (bridge.harness.getSkillLoader()?.getAll() ?? []).filter((s) =>
              modeSkillNames.has(s.frontmatter.name),
            );

            const environmentContext = await bridge.buildEnvironmentContext();
            const parentConversationId = store.conversationId ?? undefined;
            const runner = new SubAgentRunner({
              id: subAgentId,
              task,
              mode,
              workspacePath: bridge.harness.getWorkspacePath(),
              projectId: bridge._projectId,
              // Route through the shared invoke: buffered dirty-file reads + mutation
              // snapshots so sub-agent edits are reviewable/revertable.
              invoke: <T>(
                cmd: string,
                args?: Record<string, unknown>,
                authorization?: ToolInvocationAuthorization,
              ): Promise<T> => bridge.invokeForHarness<T>(cmd, args, authorization),
              listen: async (event: string, handler: (payload: unknown) => void) => {
                const unlisten = await tauriListen(event, (e) => handler(e.payload));
                return unlisten;
              },
              onApproval: (pending, signal) => bridge.handleApprovalRequest(pending, signal),
              onApprovalOwner: (approvalId, ownerId) => {
                bridge._approvalOwner.set(approvalId, ownerId);
              },
              onUpdate: (patch) => store.updateSubAgent(subAgentId, patch),
              onBridgeEvent: (event) => bridge.handleSubAgentEvent(subAgentId, event),
              activeSkills: skills,
              activeRules: bridge.harness.getActiveRules(),
              parentHarness: bridge.harness,
              conversationId: parentConversationId,
              parentTurnId: bridge.activeTurnId ?? undefined,
              environmentContext,
              delegationChain: store.delegationChain,
              memoryManager: bridge.memoryManager ?? undefined,
              externalTools: bridge.getAgentSafeExternalTools(),
              onTurnRecord: (record) => {
                void bridge.persistTurnRecord(record);
              },
              // Visible terminal runtime so sub-agent commands are watchable, and
              // command tracking so parent environment context stays fresh.
              terminalRuntime: desktopTerminalRuntime,
              onTerminalCommand: (command, output, exitCode) =>
                bridge.recordTerminalCommand(command, output, exitCode),
            });

            bridge._subAgentRunners.set(subAgentId, runner);

            try {
              return await runner.run(task);
            } finally {
              bridge._subAgentRunners.delete(subAgentId);
              bridge.clearSubAgentApprovalOwners(subAgentId);
            }
          })
          .then(
            (output) => ({ success: true, output }),
            (err) => {
              const msg = err instanceof Error ? err.message : String(err);
              return { success: false, output: '', error: msg };
            },
          );
      },
    };

    this.harness.registerExternalTool(handler);
  }

  /** Register all tools from connected MCP servers as native tool handlers */
  async registerMcpTools(): Promise<void> {
    try {
      const mcpBridge = McpBridge.get();
      const mcpTools = mcpBridge.getTools();

      for (const toolName of this.externalMcpTools.keys()) this.harness.unregisterTool(toolName);
      this.externalMcpTools.clear();

      let registered = 0;
      for (const tool of mcpTools) {
        const serverId = tool.serverId;
        const toolName = `mcp__${serverId}__${tool.name}`;
        const server = useSettingsStore
          .getState()
          .mcpServers.find((candidate) => candidate.id === serverId);
        const agentSafe = server?.agentSafe === true;

        const handler: ToolHandler = {
          definition: {
            name: toolName,
            description: `[MCP: ${serverId}] ${tool.description ?? tool.name}`,
            inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
              type: 'object',
              properties: {},
              required: [],
            },
          } satisfies ToolDefinition,
          category: 'mcp' as ToolCategory,
          requiresApproval: true,
          execute: async (
            input: Record<string, unknown>,
            ctx: ToolExecutionContext,
          ): Promise<ToolResult> => {
            try {
              const result = await mcpBridge.callTool(serverId, tool.name, input, {
                signal: ctx.signal,
              });
              const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
              return { success: true, output };
            } catch (err) {
              return {
                success: false,
                output: '',
                error: err instanceof Error ? err.message : String(err),
              };
            }
          },
        };

        this.harness.registerExternalTool(handler);
        this.externalMcpTools.set(toolName, { handler, serverId, agentSafe });
        registered++;
      }

      if (registered > 0) {
        this.debug(`Registered ${registered} MCP tools`);
      }
    } catch {
      // McpBridge may not be initialized yet — that's fine, MCP tools are optional
    }
  }

  /** Return only MCP handlers explicitly approved for delegated agents. */
  private getAgentSafeExternalTools(): ToolHandler[] {
    const settings = useSettingsStore.getState();
    return [...this.externalMcpTools.values()]
      .filter(
        (entry) =>
          entry.agentSafe ||
          settings.mcpServers.some(
            (server) => server.id === entry.serverId && server.agentSafe === true,
          ),
      )
      .map((entry) => entry.handler);
  }

  // ─── Event Handling ─────────────────────────────────────────────────

  private debug(msg: string): void {
    const useAgentStore = this.agentStore;
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log('[Harness]', msg);
    useAgentStore.getState().addDebugLine(line);
  }

  private handleEvent(event: HarnessEvent): void {
    if (this.disposed) return;
    if (this.activeTurn && !this.isTurnIdentityCurrent(this.activeTurn)) return;
    if (!this.activeTurn && event.turnId) return;
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();

    if (event.type === 'turn_start' && !this.activeTurnId) {
      this.activeTurnId = event.turnId ?? null;
    }
    const owner =
      this.activeTurnTabId && this.activeTurnConversationId
        ? {
            tabId: this.activeTurnTabId,
            conversationId: this.activeTurnConversationId,
            turnId: this.activeTurnId,
          }
        : null;
    const belongsToActiveTurn = eventBelongsToOwner(event, owner, store.activeTabId);
    if (!belongsToActiveTurn) {
      this.debug(`Ignored stale event ${event.type} for turn ${event.turnId ?? 'unknown'}`);
      return;
    }

    switch (event.type) {
      case 'turn_start': {
        this.debug(`Iteration ${event.iteration} — waiting for LLM...`);

        // Each iteration gets its own assistant row. Structured blocks arrive
        // directly from the harness through transcript_message.
        if (event.iteration > 1) {
          store.flushStreamingText();
          store.beginAssistantMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'api_request_sent': {
        store.incrementApiRequestCount();
        const count = useAgentStore.getState().apiRequestCount;
        this.debug(`API request #${count} → ${event.providerId}/${event.modelId}`);
        break;
      }

      case 'connection_state_changed': {
        store.setConnectionState(event.state, event.message ?? null);
        break;
      }

      case 'retry_scheduled': {
        const seconds = Math.max(1, Math.ceil(event.delayMs / 1000));
        store.setConnectionState(
          'retry_wait',
          `Reconnecting in ${seconds}s (attempt ${event.attempt})`,
        );
        this.debug(
          `Retry ${event.attempt} scheduled in ${event.delayMs}ms: ${event.error.technicalMessage}`,
        );
        break;
      }

      case 'retry_started': {
        store.setConnectionState('connecting', `Reconnecting (attempt ${event.attempt})`);
        break;
      }

      case 'turn_recoverable_error': {
        store.setRecoverableError({
          error: event.recovery.error,
          action: event.recovery.action,
          partialText: event.recovery.partialText,
          retryCount: event.recovery.retryCount,
          possibleDuplicateCharge: event.recovery.possibleDuplicateCharge,
        });
        break;
      }

      case 'stream_chunk': {
        const chunk = event.chunk;
        if (chunk.type === 'text_delta') {
          store.appendStreamingText(chunk.text);
        }
        if (chunk.type === 'thinking_delta') {
          store.appendThinkingText(chunk.text);
        }
        if (chunk.type === 'usage') {
          this.applyUsageChunk(chunk.usage);
        }
        break;
      }

      case 'transcript_message': {
        if (event.role === 'assistant') {
          store.setStreamingAssistantBlocks(event.blocks);
        } else if (event.blocks.length > 0) {
          store.addMessage({
            id: crypto.randomUUID(),
            role: 'tool',
            content: '',
            blocks: [...event.blocks],
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'assistant_segment_end': {
        // Finalize the current assistant message and start a new one —
        // agentic providers (Codex) emit one segment per interim message.
        store.flushStreamingText();
        store.beginAssistantMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        });
        break;
      }

      case 'tool_call_start': {
        this.debug(`Tool: ${event.toolName}`);
        const tc: ToolCallDisplay = {
          id: event.toolCallId,
          name: event.toolName,
          input: event.input,
          status: 'running',
          startedAt: Date.now(),
        };
        store.addToolCall(tc);
        // Anchor the sub-agent card entry to the transcript tool-call id at
        // start time. The execute() body adds the full entry a moment later,
        // but policy blocks, approval stalls, coordinator queueing, or a
        // nested dispatch must never leave the card without live state.
        // Nested `:external` dispatches are skipped: their store entry is
        // created under the outer (unsuffixed) id by execute().
        if (
          event.toolName === 'spawn_subagent' &&
          !event.toolCallId.endsWith(':external') &&
          !store.subAgents.some((agent) => agent.id === event.toolCallId)
        ) {
          const input = (event.input ?? {}) as Record<string, unknown>;
          const mode = input.mode as AgentMode;
          store.addSubAgent({
            id: event.toolCallId,
            task: typeof input.task === 'string' ? input.task : 'Sub-agent task',
            mode: mode === 'build' || mode === 'review' || mode === 'debug' || mode === 'plan' ? mode : 'build',
            conversationId: store.conversationId ?? undefined,
            status: 'running',
            output: '',
            toolCalls: [],
            startedAt: Date.now(),
          });
        }
        break;
      }
      case 'terminal_progress': {
        const progress = event.progress;
        const current = useAgentStore
          .getState()
          .pendingToolCalls.find((toolCall) => toolCall.id === progress.toolCallId);
        const projection = projectTerminalProgress(
          current
            ? {
                terminalId: current.terminalId,
                terminalState: current.terminalState,
                outputSequence: current.outputSequence,
                liveOutput: current.liveOutput,
                failure: current.failure,
                provisional: current.terminalProvisional,
                canonical: current.terminalCanonical,
              }
            : undefined,
          progress,
          {
            provisional:
              progress.state === 'complete' ||
              progress.state === 'error' ||
              progress.state === 'cancelled' ||
              progress.state === 'background',
          },
        );
        if (!projection) break;
        const terminalStore = useTerminalStore.getState();
        terminalStore.setAwaitingInput(progress.terminalId, progress.state === 'awaiting_input');
        if (
          progress.state === 'complete' ||
          progress.state === 'error' ||
          progress.state === 'cancelled' ||
          progress.state === 'background'
        ) {
          terminalStore.clearAgentActivityIfOwned(progress.terminalId, progress.toolCallId);
        }
        if (progress.state !== 'awaiting_input') {
          for (const toolCall of useAgentStore.getState().pendingToolCalls) {
            if (
              toolCall.id !== progress.toolCallId &&
              toolCall.terminalId === progress.terminalId &&
              toolCall.terminalState === 'awaiting_input'
            ) {
              store.updateToolCall(toolCall.id, { terminalState: progress.state });
            }
          }
        }
        const provisionalStatus: ToolCallDisplay['status'] | null =
          progress.state === 'error'
            ? 'error'
            : progress.state === 'cancelled'
              ? 'cancelled'
              : progress.state === 'complete' || progress.state === 'background'
                ? 'success'
                : null;
        store.updateToolCall(progress.toolCallId, {
          ...(provisionalStatus ? { status: provisionalStatus } : {}),
          terminalId: projection.terminalId,
          terminalState: projection.terminalState,
          outputSequence: projection.outputSequence,
          liveOutput: projection.liveOutput,
          failure: projection.failure,
          terminalProvisional: projection.provisional,
          terminalCanonical: false,
        });
        break;
      }

      case 'tool_call_pending': {
        const pending = event.pending;
        const existing = useAgentStore
          .getState()
          .pendingToolCalls.some((call) => call.id === pending.id);
        if (!existing) {
          store.addToolCall({
            id: pending.id,
            name: pending.toolName,
            input: pending.input,
            status: 'pending',
            startedAt: Date.now(),
          });
        } else store.updateToolCall(pending.id, { status: 'pending' });
        break;
      }

      case 'tool_call_notification': {
        this.debug(`Tool auto-approved: ${event.toolName} — ${event.description}`);
        break;
      }

      case 'tool_call_result': {
        const label = event.result.success ? '✓' : '✗';
        this.debug(`${label} ${event.toolName} (${event.durationMs}ms)`);
        const metadata = event.result.metadata ?? {};
        const terminalId =
          typeof metadata.terminalId === 'string' ? metadata.terminalId : undefined;
        let failure: ToolCallDisplay['failure'] = null;
        if ('failure' in metadata) {
          if (metadata.failure === undefined) {
            failure = {
              operation: 'event',
              message: 'Terminal result failure must be null or a runtime failure.',
            };
          } else if (metadata.failure === null) {
            failure = null;
          } else {
            try {
              failure = validateTerminalFailure(metadata.failure, 'event');
            } catch (error) {
              failure = asTerminalRuntimeFailure(error, 'event');
            }
          }
        }
        const awaitingInput = metadata.awaitingInput === true;
        const terminalState = terminalId
          ? awaitingInput
            ? 'awaiting_input'
            : failure
              ? 'error'
              : metadata.cancelled === true
                ? 'cancelled'
                : event.result.success
                  ? metadata.background === true
                    ? 'background'
                    : 'complete'
                  : 'error'
          : undefined;
        // Find tool call by the harness-assigned ID (stable correlation)
        store.updateToolCall(event.toolCallId, {
          status:
            metadata.cancelled === true || failure
              ? metadata.cancelled === true
                ? 'cancelled'
                : 'error'
              : event.result.success
                ? 'success'
                : 'error',
          output: event.result.output,
          error: event.result.error,
          completedAt: Date.now(),
          ...(terminalId
            ? { terminalCanonical: !awaitingInput, terminalProvisional: awaitingInput }
            : {}),
          failure,
          ...(terminalId
            ? {
                terminalId,
                liveOutput: event.result.output,
                terminalState,
              }
            : {}),
          ...(typeof metadata.sequence === 'number' &&
          Number.isSafeInteger(metadata.sequence) &&
          metadata.sequence >= 0
            ? { outputSequence: metadata.sequence }
            : {}),
        });
        if (terminalId && !awaitingInput) {
          const terminalStore = useTerminalStore.getState();
          terminalStore.clearAgentActivityIfOwned(terminalId, event.toolCallId);
          terminalStore.setAwaitingInput(terminalId, false);
        }
        // Mirror spawn outcomes into the sub-agent card state so the card
        // never sticks on "Running" (timeout/cancel) and rehydrated
        // transcripts (store entry missing) still render the outcome.
        this.mirrorSubAgentToolResult(event.toolCallId, event.toolName, event.result);
        if (event.toolName === 'run_terminal_command') {
          const completedCall = useAgentStore
            .getState()
            .pendingToolCalls.find((toolCall) => toolCall.id === event.toolCallId);
          if (completedCall?.terminalId) {
            const command = String(completedCall.input.command ?? '');
            const exitCode = (event.result.metadata?.exitCode as number | null | undefined) ?? null;
            const output = event.result.output.slice(-16_000);
            const terminalStore = useTerminalStore.getState();
            terminalStore.setLastCommand(
              completedCall.terminalId,
              command,
              output,
              exitCode,
              'agent',
            );
            terminalStore.appendCommandHistory(completedCall.terminalId, {
              command,
              output,
              exitCode,
              timestamp: Date.now(),
              source: 'agent',
            });
          }
        }

        // Handle metadata actions from tools
        const meta = event.result.metadata;
        if (meta?.action === 'manage_tasks' && Array.isArray(meta.tasks)) {
          store.setAgentTasks(meta.tasks as Array<{ id: number; title: string; status: string }>);
        }
        if (meta?.action === 'activate_skill' && meta.skillName) {
          // Enable the skill in the store (single source of truth)
          const skillsStore = useSkillsStore.getState();
          const skill = skillsStore.skills.find(
            (s) => s.name === meta.skillName || s.id === meta.skillName,
          );
          if (skill && !skill.enabled) {
            skillsStore.toggleSkill(skill.id);
          }
          // Re-sync store → harness so the skill is actually active
          const activeForMode = skillsStore.getActiveForMode(
            useAgentStore.getState().mode as AgentType,
          );
          this.syncActiveSkills(activeForMode.map((s) => s.name));
        }
        if (meta?.action === 'create_skill' && meta.filePath) {
          // Add the newly created skill to the skills store
          useSkillsStore.getState().addSkill({
            id: `workspace:${meta.skillName as string}`,
            name: meta.skillName as string,
            description: (meta.skillDescription as string) || '',
            scope: (meta.skillScope as string) === 'global' ? 'global' : 'workspace',
            enabled: true,
            filePath: meta.filePath as string,
            content: (meta.skillContent as string) || '',
            modes: [],
            status: 'ok',
          });
        }
        break;
      }

      case 'turn_end': {
        this.sweepUnfinalizedTerminalTools();
        if (event.reason === 'error' && event.error) {
          const technical = event.errorDetails?.technicalMessage;
          this.debug(
            `Error in iteration: ${event.error}${technical && technical !== event.error ? ` → ${technical}` : ''}`,
          );
          if (!useAgentStore.getState().recoverableError) {
            store.setRecoverableError({
              error: {
                kind: 'unknown',
                phase: 'connecting',
                provider: useSettingsStore.getState().activeProviderId ?? 'unknown',
                retryable: true,
                technicalMessage: event.error,
                userMessage: parseProviderError(event.error),
              },
              action: 'retry',
              partialText: '',
              retryCount: event.tokenUsage.retryCount ?? 0,
              possibleDuplicateCharge: Boolean(event.tokenUsage.possibleDuplicateCharge),
            });
          }
        } else {
          this.debug(`Turn ended: ${event.reason}`);
        }
        // Authoritative reconciliation: the harness's final tokenUsage is the
        // source of truth. Overwrite any per-iteration accumulation in the
        // store so the UI shows the exact turn total. When the turn spawned
        // sub-agents, their usage chunks were already folded into the store
        // total, so keep the accumulated value instead of losing child spend.
        if (event.tokenUsage && !this._turnHadSubAgents) {
          useAgentStore.getState().setTokenUsage(event.tokenUsage);
        }
        store.setTerminalStatus(event.reason);
        // Commit the final streamed text; structured blocks are already canonical.
        useAgentStore.getState().flushStreamingText();
        break;
      }

      case 'sdd_phase_change': {
        store.setSddPhase(event.phase);
        break;
      }

      case 'sdd_task_start': {
        store.updateSddTask(event.task.id, { status: 'in_progress' } as Partial<SddTask>);
        break;
      }

      case 'sdd_task_complete': {
        store.updateSddTask(event.task.id, {
          status: event.task.status,
          agentOutput: event.task.agentOutput,
        } as Partial<SddTask>);
        if (event.task.status === 'failed') {
          store.setSddFailedTask(event.task);
        }
        break;
      }

      case 'file_change_pending': {
        this.handleFileChangePending(event.change);
        break;
      }

      case 'mode_switch_request': {
        // Handled by onModeSwitchRequest callback (which pauses the loop).
        // The callback already sets pendingModeSwitch in the store.
        break;
      }

      case 'mode_switch_resolved': {
        const req = event.request;
        if (this.resolvedModeSwitchIds.has(req.id)) break;
        this.resolvedModeSwitchIds.add(req.id);
        if (this.resolvedModeSwitchIds.size > 256) {
          const oldest = this.resolvedModeSwitchIds.values().next().value;
          if (oldest) this.resolvedModeSwitchIds.delete(oldest);
        }
        store.resolveModeSwitch(req, event.approved);
        if (event.approved) {
          this.debug(`Delegation resolved: approved → ${req.toMode}`);
        } else {
          this.debug(`Delegation resolved: rejected (${req.fromMode} → ${req.toMode})`);
        }
        break;
      }

      case 'context_gathered': {
        this.debug(
          `📎 Gathered: ${event.filePath} (relevance: ${event.relevance.toFixed(2)}, ~${event.tokenEstimate} tokens)`,
        );
        store.addGatheredContextFile({
          path: event.filePath,
          relevance: event.relevance,
          tokenEstimate: event.tokenEstimate,
        });
        break;
      }

      case 'context_dropped': {
        this.debug(`📎 Dropped: ${event.filePath}`);
        store.removeGatheredContextFile(event.filePath);
        break;
      }

      case 'user_question_request': {
        this.debug(`❓ Agent asking questions (${event.questions.length}): ${event.title ?? ''}`);
        break;
      }

      case 'user_question_answered': {
        this.debug(`✅ User answered ${event.answers.length} question(s)`);
        break;
      }

      case 'memories_extracted': {
        const count = (event as { count?: number }).count ?? 0;
        if (
          count > 0 &&
          (!this.isolatedRuntime || useMemoryStore.getState().projectId === this._projectId)
        ) {
          this.debug(`🧠 Extracted ${count} memory/memories`);
          // Reload from DB so sidebar reflects new memories
          useMemoryStore
            .getState()
            .loadMemories()
            .catch(() => {});
        }
        break;
      }

      case 'memory_created': {
        const mem = (event as { memory?: { title?: string } }).memory;
        this.debug(`🧠 Memory created: ${mem?.title ?? '(unknown)'}`);
        if (!this.isolatedRuntime || useMemoryStore.getState().projectId === this._projectId) {
          useMemoryStore
            .getState()
            .loadMemories()
            .catch(() => {});
        }
        break;
      }
    }
  }

  /** Find a tool call by id across pending calls and transcript messages. */
  private findToolCall(id: string): ToolCallDisplay | undefined {
    const state = this.agentStore.getState();
    return (
      state.pendingToolCalls.find((toolCall) => toolCall.id === id) ??
      state.messages.flatMap((message) => message.toolCalls ?? []).find((toolCall) => toolCall.id === id)
    );
  }

  /**
   * Mirror a spawn_subagent (or wrapping invoke_external_tool) result into
   * the sub-agent store entry. Skips entries the runner already finalized so
   * the runner's own terminal state is never clobbered; synthesizes a
   * terminal entry when none exists (e.g. transcript restored after reload)
   * so the card renders the outcome instead of "Sub-agent state not found."
   */
  private mirrorSubAgentToolResult(
    toolCallId: string,
    toolName: string,
    result: ToolResult,
  ): void {
    const target = resolveSubAgentMirrorTarget(
      toolCallId,
      toolName,
      (id) => this.findToolCall(id)?.input,
    );
    if (!target) return;
    const store = this.agentStore.getState();
    const existing = store.subAgents.find((agent) => agent.id === target.spawnId);
    if (
      existing &&
      existing.status !== 'queued' &&
      existing.status !== 'running' &&
      existing.status !== 'cancelling'
    ) {
      return;
    }
    const cancelled = /cancel/i.test(result.error ?? '');
    const status: SubAgentState['status'] = result.success
      ? 'done'
      : cancelled
        ? 'cancelled'
        : 'error';
    const output = result.success ? result.output : (result.error ?? 'Sub-agent failed.');
    const completedAt = Date.now();
    if (existing) {
      store.updateSubAgent(target.spawnId, { status, output, completedAt });
      return;
    }
    const spawnCall = this.findToolCall(target.spawnId);
    const rawInput = (spawnCall?.input ?? target.nestedInput ?? {}) as Record<string, unknown>;
    const task = typeof rawInput.task === 'string' ? rawInput.task : 'Sub-agent task';
    const mode: AgentMode =
      rawInput.mode === 'build' ||
      rawInput.mode === 'review' ||
      rawInput.mode === 'debug' ||
      rawInput.mode === 'plan' ||
      rawInput.mode === 'chat'
        ? rawInput.mode
        : 'build';
    store.addSubAgent({
      id: target.spawnId,
      task,
      mode,
      conversationId: store.conversationId ?? undefined,
      status,
      output,
      toolCalls: [],
      startedAt: spawnCall?.startedAt ?? completedAt,
      completedAt,
    });
  }

  private sweepUnfinalizedTerminalTools(): void {
    const store = this.agentStore.getState();
    for (const toolCall of store.pendingToolCalls) {
      if (!toolCall.terminalId || toolCall.terminalCanonical) continue;
      if (toolCall.input.background === true || toolCall.terminalState === 'background') continue;
      const active =
        toolCall.status === 'running' ||
        toolCall.status === 'cancelling' ||
        toolCall.terminalState === 'started' ||
        toolCall.terminalState === 'running' ||
        toolCall.terminalState === 'awaiting_input';
      if (!active) continue;
      const failure = {
        operation: 'event' as const,
        message: 'Terminal command ended without a final result.',
      };
      store.updateToolCall(toolCall.id, {
        status: 'error',
        terminalState: 'error',
        terminalProvisional: true,
        terminalCanonical: false,
        failure,
        error: failure.message,
      });
      const terminal = useTerminalStore
        .getState()
        .sessions.find((session) => session.id === toolCall.terminalId);
      if (terminal?.activeToolCallId === toolCall.id) {
        useTerminalStore.getState().clearAgentActivityIfOwned(toolCall.terminalId, toolCall.id);
        useTerminalStore.getState().setAwaitingInput(toolCall.terminalId, false);
      }
    }
  }

  /**
   * Handle file-change review events from the main agent AND sub-agents.
   * Sub-agent edits go through the same mutation-snapshot pipeline so they
   * can be reviewed and reverted like any other agent edit.
   */
  private handleFileChangePending(
    c: import('@hyscode/agent-harness').FileChangePending,
    turnId?: string,
  ): void {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const snapshot = this.mutationSnapshots.get(c.filePath);
    if (snapshot) snapshot.expectedContent = expectedContentAfterChange(c);
    const isNewFile = c.originalContent === null;
    const hunks = computeDiffHunks(c.originalContent, c.newContent);

    // Legacy pendingFileChanges (backward compat)
    store.addPendingFileChange({
      id: crypto.randomUUID(),
      filePath: c.filePath,
      toolName: c.toolName,
      toolCallId: c.toolCallId,
      originalContent: c.originalContent,
      newContent: c.newContent,
      status: 'pending',
    });

    // New session-based tracking
    const settings = useSettingsStore.getState();
    const session: AgentEditSession = {
      id: crypto.randomUUID(),
      turnId: turnId ?? this.activeTurnId ?? crypto.randomUUID(),
      filePath: c.filePath,
      toolName: c.toolName,
      toolCallId: c.toolCallId,
      originalContent: c.originalContent,
      diskOriginalContent: snapshot?.diskBefore,
      wasDirty: snapshot?.wasDirty,
      newContent: c.newContent,
      phase: 'streaming',
      isNewFile,
      hunks,
      createdAt: Date.now(),
    };
    store.upsertEditSession(session);

    // Transition to pending_review (in the first cut, the "streaming" phase
    // is instantaneous since we get the full payload at once)
    // Use a microtask so the UI renders the streaming state briefly
    queueMicrotask(() => {
      if (this.disposed) return;
      const s = useAgentStore.getState();
      const live = s.agentEditSessions.find(
        (es) => es.id === session.id && es.phase === 'streaming',
      );
      if (live) {
        if (settings.approvalMode === 'yolo' || settings.approvalMode === 'notify') {
          // Use the normal resolver so accepting advances the next mutation's baseline.
          void this.resolveEditSession(live.id, true);
        } else {
          // manual / smart / session-trust / custom → pending_review
          useAgentStore.setState((draft) => {
            const target = draft.agentEditSessions.find((es) => es.id === live.id);
            if (target) target.phase = 'pending_review';
          });
        }
      }
    });
  }

  /**
   * Accumulate a provider usage chunk into the store's token usage.
   * Each provider emits one consolidated usage chunk per API request.
   * Sum across the iterations of a multi-iteration turn. Cache fields
   * (Anthropic prompt caching) are preserved when the chunk includes
   * them; a chunk that omits them contributes 0.
   */
  private applyUsageChunk(u: import('@hyscode/ai-providers').TokenUsage): void {
    const useAgentStore = this.agentStore;
    const current = useAgentStore.getState().tokenUsage;
    const inputTokens = (current?.inputTokens ?? 0) + u.inputTokens;
    const outputTokens = (current?.outputTokens ?? 0) + u.outputTokens;
    const cacheReadTokens = (current?.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0);
    const cacheWriteTokens = (current?.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0);
    const effectiveInput = Math.max(0, u.inputTokens - (u.cacheReadTokens ?? 0));
    const totalTokens =
      u.totalTokens > 0 ? (current?.totalTokens ?? 0) + u.totalTokens : inputTokens + outputTokens;
    useAgentStore.getState().setTokenUsage({
      inputTokens,
      outputTokens,
      totalTokens,
      requestCount: (current?.requestCount ?? 0) + 1,
      lastInputTokens: u.inputTokens,
      lastEffectiveInputTokens: effectiveInput,
      peakInputTokens: Math.max(current?.peakInputTokens ?? 0, u.inputTokens),
      peakEffectiveInputTokens: Math.max(current?.peakEffectiveInputTokens ?? 0, effectiveInput),
      cacheReadTokens,
      cacheWriteTokens,
      reasoningTokens: (current?.reasoningTokens ?? 0) + (u.reasoningTokens ?? 0),
      retryCount: (current?.retryCount ?? 0) + (u.retryCount ?? 0),
      possibleDuplicateCharge:
        Boolean(current?.possibleDuplicateCharge) || Boolean(u.possibleDuplicateCharge),
    });
  }

  /**
   * Bridge-side handling for sub-agent events that affect shared store state:
   * file-change review, API request counting and token usage accounting.
   * Called by SubAgentRunner via its onBridgeEvent callback.
   */
  handleSubAgentEvent(_subAgentId: string, event: HarnessEvent): void {
    const useAgentStore = this.agentStore;
    switch (event.type) {
      case 'file_change_pending': {
        // Sub-agent edits join the parent turn's review pipeline so they can
        // be accepted/reverted from the UI and appear in turn summaries.
        this.handleFileChangePending(event.change);
        this.debug(`[sub-agent] File change pending: ${event.change.filePath}`);
        break;
      }
      case 'api_request_sent': {
        useAgentStore.getState().incrementApiRequestCount();
        this.debug(`[sub-agent] API request → ${event.providerId}/${event.modelId}`);
        break;
      }
      case 'stream_chunk': {
        if (event.chunk.type === 'usage') this.applyUsageChunk(event.chunk.usage);
        break;
      }
    }
  }

  private async handleApprovalRequest(
    pending: ToolApprovalRequest,
    signal: AbortSignal,
  ): Promise<ApprovalDecision> {
    const useAgentStore = this.agentStore;
    const settings = useSettingsStore.getState();
    const mode = settings.approvalMode;
    const requiresExternalAccess = Boolean(pending.externalAccess);

    // External access is always interactive, including yolo/notify and
    // sub-agent auto-approve. The normal mode shortcuts below intentionally
    // run only for workspace-contained tool approvals.
    if (!requiresExternalAccess) {
      // Yolo: auto-approve everything silently
      if (mode === 'yolo') return true;

      // Notify: auto-approve but emit a notification event for the UI
      if (mode === 'notify') {
        this.debug(`🔔 Notify (auto-approved): ${pending.toolName}`);
        return true;
      }

      // Smart: auto-approve safe tools, ask for moderate/destructive.
      // The safe set is shared with the harness (SAFE_TOOLS) so approval
      // behavior can never drift from the tool's declared risk.
      if (mode === 'smart') {
        if (SAFE_TOOLS.has(pending.toolName)) {
          this.debug(`✅ Smart auto-approved (safe): ${pending.toolName}`);
          return true;
        }
        // Fall through to show approval dialog for non-safe tools
      }

      // Session-trust: auto-approve if tool was previously trusted
      if (mode === 'session-trust') {
        const trustedTools = this.harness.getToolRouter()?.getSessionTrustedTools?.() as
          | Set<string>
          | undefined;
        if (trustedTools?.has(pending.toolName)) {
          this.debug(`✅ Session-trust auto-approved: ${pending.toolName}`);
          return true;
        }
        // Fall through to show approval dialog
      }
    }

    // Push to store for UI rendering (manual, smart-non-safe, session-trust-untrusted, custom)
    const approval: PendingApproval = {
      id: pending.id,
      toolName: pending.toolName,
      input: pending.input,
      description: pending.description,
      ...(pending.externalAccess ? { externalAccess: pending.externalAccess } : {}),
      ownerSubAgentId: this._approvalOwner.get(pending.id),
    };
    useAgentStore.getState().addPendingApproval(approval);
    this.updateActiveTaskRunState('waiting');

    // Wait for UI resolution
    return new Promise<ApprovalDecision>((resolve) => {
      let settled = false;
      const cancel = () => {
        if (!this.approvalResolvers.delete(pending.id)) return;
        useAgentStore.getState().removePendingApproval(pending.id);
        finish(false);
      };
      const finish = (decision: ApprovalDecision): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        if (decision) this.updateActiveTaskRunState('running');
        resolve(decision);
      };
      this.approvalResolvers.set(pending.id, finish);
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
    });
  }

  /**
   * Handle a mode switch request from the harness.
   * Pauses the agent loop until the user approves/denies via the ModeSwitchDialog.
   */
  private async handleModeSwitchRequest(
    request: {
      id: string;
      fromMode: string;
      toMode: string;
      reason: string;
      contextSummary: string;
    },
    signal: AbortSignal,
  ): Promise<boolean> {
    const useAgentStore = this.agentStore;
    this.debug(`Delegation requested: ${request.fromMode} → ${request.toMode} (${request.reason})`);

    // Push to store so ModeSwitchDialog renders
    const store = useAgentStore.getState();
    store.setPendingModeSwitch({
      id: request.id,
      fromMode: request.fromMode as import('@hyscode/agent-harness').AgentType,
      toMode: request.toMode as import('@hyscode/agent-harness').AgentType,
      reason: request.reason,
      contextSummary: request.contextSummary,
    });

    // Wait for UI resolution (resolveModeSwitch calls our resolver)
    return new Promise<boolean>((resolve) => {
      this.modeSwitchResolvers.set(request.id, resolve);
      const cancel = () => {
        if (!this.modeSwitchResolvers.delete(request.id)) return;
        useAgentStore.getState().setPendingModeSwitch(null);
        resolve(false);
      };
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
    });
  }

  private async handleUserQuestionRequest(
    id: string,
    questions: import('@hyscode/agent-harness').AgentQuestion[],
    title?: string,
    signal?: AbortSignal,
  ): Promise<import('@hyscode/agent-harness').AgentQuestionAnswer[]> {
    const useAgentStore = this.agentStore;
    this.debug(`Agent is asking ${questions.length} question(s): ${title ?? '(no title)'}`);

    // Push to store so AgentQuestionCard renders
    const store = useAgentStore.getState();
    store.setPendingUserQuestion({ id, title, questions });
    this.updateActiveTaskRunState('waiting');

    // Wait for UI resolution
    return new Promise<import('@hyscode/agent-harness').AgentQuestionAnswer[]>((resolve) => {
      this.userQuestionResolvers.set(id, resolve);
      const cancel = () => {
        if (!this.userQuestionResolvers.delete(id)) return;
        useAgentStore.getState().setPendingUserQuestion(null);
        resolve([]);
      };
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  /** Called by UI when the user submits answers to agent questions */
  resolveUserQuestion(
    id: string,
    answers: import('@hyscode/agent-harness').AgentQuestionAnswer[],
  ): void {
    const useAgentStore = this.agentStore;
    const resolver = this.userQuestionResolvers.get(id);
    if (resolver) {
      this.userQuestionResolvers.delete(id);
      useAgentStore.getState().setPendingUserQuestion(null);
      this.updateActiveTaskRunState('running');
      resolver(answers);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Build thinking config for the active provider+model from settings.
   */
  private buildThinkingConfig(
    providerId: string | null,
    modelId: string | null,
  ): import('@hyscode/ai-providers').ThinkingConfig | undefined {
    if (!providerId || !modelId) return undefined;
    const settings = useSettingsStore.getState();
    const key = `${providerId}::${modelId}`;
    const cfg = settings.thinkingSettings[key];
    if (!cfg || !cfg.enabled) return undefined;
    return {
      enabled: true,
      level: cfg.level,
      mode: cfg.mode,
      budgetTokens: cfg.budgetTokens,
      type: cfg.type,
      display: cfg.display,
    };
  }

  /**
   * Build LLM-compatible history from store messages.
   * Uses `blocks` when available for faithful tool_call/tool_result reconstruction;
   * falls back to text-only for messages that predate the structured format.
   */
  private buildHistory(messages: Array<import('@/stores/agent-store').ChatMessage>): Message[] {
    const result: Message[] = [];
    for (const msg of messages) {
      if (msg.blocks && msg.blocks.length > 0) {
        // Determine the correct role: if all blocks are tool_result, the role
        // must be 'tool' so that providers (OpenAI, OpenRouter, Ollama, GitHub
        // Copilot) format them correctly. Without this, tool_result blocks
        // stored as role='user' cause empty content in toOpenAIMessages → 400.
        const hasToolResult = msg.blocks.some((b) => b.type === 'tool_result');
        const role = hasToolResult ? 'tool' : (msg.role as 'user' | 'assistant' | 'tool');
        const blocks = [...msg.blocks];
        // Re-inject thinking block if it was stored separately but missing from blocks
        // (Kimi/MiMo require reasoning_content on every assistant message with tool_calls)
        if (
          msg.role === 'assistant' &&
          msg.thinking &&
          !blocks.some((b) => b.type === 'thinking')
        ) {
          blocks.unshift({ type: 'thinking', thinking: msg.thinking });
        }
        result.push({
          role,
          content: blocks,
        });
      } else if (msg.content) {
        result.push({
          role: msg.role as 'user' | 'assistant' | 'tool',
          content: [{ type: 'text', text: msg.content }],
        });
      }
      // Skip messages with no content and no blocks (e.g. empty tool_result placeholders)
    }
    return result;
  }

  // ─── Environment Context Assembly ───────────────────────────────────

  /** Build a deterministic environment context package for any child turn. */
  private async buildEnvironmentContext(turn?: BridgeTurn): Promise<EnvironmentContext> {
    const useAgentStore = this.agentStore;
    const workspacePath = this.harness.getWorkspacePath() as string;
    const env: EnvironmentContext = {
      workspacePath,
    };

    // Active file from editor + file store
    try {
      const editorState = useEditorStore.getState();
      const activeTab = editorState.tabs.find((t) => t.id === editorState.activeTabId);
      const fileStore = useFileStore.getState();
      if (
        activeTab?.type === 'file' &&
        activeTab.filePath &&
        projectPathKey(fileStore.rootPath ?? '') === projectPathKey(workspacePath) &&
        isPathInsideWorkspace(activeTab.filePath, workspacePath)
      ) {
        const activePath = activeTab.filePath;
        const content = fileStore.getFileContent(activePath);
        if (content !== undefined) {
          env.activeFile = {
            path: activePath,
            content,
            language: activeTab.language,
          };
        }
      }
    } catch {
      // File store may not have data yet — that's fine
    }

    // Directory tree (top-level only, cheap)
    try {
      const entries = await tauriInvokeRaw<Array<{ name: string; is_dir: boolean }>>(
        'list_dir_all',
        { path: env.workspacePath },
      );
      if (turn && !this.canContinueTurn(turn)) return env;
      const tree = entries
        .filter((e) => e.name !== 'node_modules' && e.name !== 'target')
        .map((e) => (e.is_dir ? `${e.name}/` : e.name))
        .join('\n');
      env.directoryTree = tree;
    } catch {
      // No directory access — skip
    }

    // Git state
    try {
      const snapshot = await tauriInvoke('git_repository_snapshot', {
        repoPath: env.workspacePath,
      });
      if (turn && !this.canContinueTurn(turn)) return env;

      const total =
        snapshot.staged.length +
        snapshot.unstaged.length +
        snapshot.untracked.length +
        snapshot.conflicts.length;
      const summaryParts: string[] = [];
      if (snapshot.staged.length > 0) summaryParts.push(`${snapshot.staged.length} staged`);
      if (snapshot.unstaged.length > 0) summaryParts.push(`${snapshot.unstaged.length} modified`);
      if (snapshot.untracked.length > 0) {
        summaryParts.push(`${snapshot.untracked.length} untracked`);
      }
      if (snapshot.conflicts.length > 0) {
        summaryParts.push(`${snapshot.conflicts.length} conflicted`);
      }

      env.gitState = {
        branch:
          snapshot.current_branch ??
          (snapshot.head_state === 'detached'
            ? `detached@${snapshot.head_oid?.slice(0, 7) ?? 'HEAD'}`
            : 'unborn'),
        uncommittedFiles: total,
        summary:
          total > 0
            ? summaryParts.join(', ')
            : snapshot.operation_state === 'clean'
              ? 'Working tree clean'
              : `Repository operation: ${snapshot.operation_state}`,
      };
    } catch {
      // Git not available — skip
    }

    // Last terminal command executed by the agent (if any)
    const conversationId = useAgentStore.getState().conversationId;
    const lastTerminalCommand = conversationId
      ? this._lastTerminalCommands.get(conversationId)
      : undefined;
    if (lastTerminalCommand) {
      env.lastTerminalCommand = {
        command: lastTerminalCommand.command,
        output: lastTerminalCommand.output,
        exitCode: lastTerminalCommand.exitCode,
      };
    }

    return env;
  }

  /** Build and inject the environment context for the main harness turn. */
  private async injectEnvironmentContext(turn: BridgeTurn): Promise<void> {
    const context = await this.buildEnvironmentContext(turn);
    if (this.canContinueTurn(turn)) this.harness.injectEnvironmentContext(context);
  }

  /**
   * Analyze user message for file references and keywords, then suggest
   * files the agent should consider gathering.
   */
  private async injectContextHints(userMessage: string, turn: BridgeTurn): Promise<void> {
    try {
      const workspacePath = this.harness.getWorkspacePath() as string;
      const hints: string[] = [];

      // Extract explicit file paths from user message (e.g., "edit src/app.tsx")
      const pathPattern = /(?:^|\s)([\w./-]+\.\w{1,10})(?:\s|$|,|;|:|\))/g;
      let match;
      while ((match = pathPattern.exec(userMessage)) !== null) {
        const candidate = match[1];
        // Skip URLs and short fragments
        if (candidate.includes('://') || candidate.length < 3) continue;
        try {
          const stat = await tauriInvokeRaw<{ is_file: boolean }>('stat_path', {
            path: `${workspacePath}/${candidate}`,
          });
          if (!this.canContinueTurn(turn)) return;
          if (stat.is_file) {
            hints.push(candidate);
          }
        } catch {
          if (!this.canContinueTurn(turn)) return;
          // Not a valid file path — skip
        }
      }

      // Extract keywords that suggest relevant files
      // e.g., "fix the login page" → look for files with "login" in name
      const keywords = userMessage
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .filter(
          (w) =>
            ![
              'that',
              'this',
              'with',
              'from',
              'have',
              'been',
              'will',
              'should',
              'could',
              'would',
              'make',
              'want',
              'need',
              'like',
              'help',
              'please',
              'create',
              'change',
              'update',
              'modify',
              'edit',
              'file',
              'code',
            ].includes(w),
        );

      // Search for files matching keywords (limited to avoid overhead)
      for (const keyword of keywords.slice(0, 3)) {
        try {
          const results = await tauriInvokeRaw<string[]>('find_files', {
            basePath: workspacePath,
            pattern: `**/*${keyword}*`,
            maxResults: 5,
          });
          if (!this.canContinueTurn(turn)) return;
          for (const r of results) {
            const rel = r
              .replace(workspacePath, '')
              .replace(/^[\\/]/, '')
              .replace(/\\/g, '/');
            if (!hints.includes(rel)) hints.push(rel);
          }
        } catch {
          if (!this.canContinueTurn(turn)) return;
          // find_files may not exist yet or fail — skip
        }
      }

      if (!this.canContinueTurn(turn)) return;
      if (hints.length > 0) {
        // Add context hints as a low-priority source so the agent knows about them
        this.harness.addContextSource({
          id: '__context_hints__',
          type: 'search_results',
          priority: 'low',
          content: `<context_hints>
The following files may be relevant to the user's request. Consider using gather_context on the important ones:
${hints.map((h) => `- ${h}`).join('\n')}
</context_hints>`,
          tokenEstimate: Math.ceil(hints.join('\n').length / 4) + 50,
          origin: 'automatic',
          identity: 'automatic:context-hints',
          expiresAfterTurn: this.harness.getContextTurnNumber(),
        });
      } else {
        this.harness.removeContextSource('__context_hints__');
      }
    } catch {
      // Context hints are best-effort — never block the agent turn
    }
  }

  // ─── Turn Record Persistence ────────────────────────────────────────

  /**
   * Load mode policy overrides from the database.
   * Falls back silently if the table doesn't exist yet.
   */
  private async loadModePolicies(): Promise<void> {
    try {
      const rows = await tauriInvokeRaw<
        Array<{
          mode: string;
          max_iterations: number;
          max_input_tokens: number;
          max_output_tokens: number;
          turn_timeout_ms: number;
          approval_mode: string;
          verification_required: boolean;
          allowed_tool_categories: string;
          tool_overrides: string | null;
          skill_triggers: string | null;
        }>
      >('db_list_mode_policies', {});

      for (const row of rows) {
        applyPolicyOverride(row.mode as AgentType, {
          maxIterations: row.max_iterations,
          maxInputTokens: row.max_input_tokens,
          maxOutputTokens: row.max_output_tokens,
          turnTimeoutMs: row.turn_timeout_ms,
          verificationRequired: row.verification_required,
          allowedToolCategories: JSON.parse(row.allowed_tool_categories) as ToolCategory[],
          toolOverrides: row.tool_overrides ? JSON.parse(row.tool_overrides) : undefined,
          skillTriggers: row.skill_triggers ? JSON.parse(row.skill_triggers) : undefined,
        });
      }

      console.log('[HarnessBridge] Loaded mode policies:', rows.length, 'rows');
    } catch {
      // Best-effort — table may not exist on first run before migration
      console.warn('[HarnessBridge] Failed to load mode policies (first run?)');
    }
  }

  /**
   * Persist a structured turn record to the database for observability/tracing.
   */
  private async persistTurnRecord(
    record: TurnRecord,
    recordAlreadyCommitted = false,
  ): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const conversationId = record.conversationId || store.conversationId;
    if (!conversationId) return;

    try {
      if (!recordAlreadyCommitted) {
        await tauriInvokeRaw('db_create_turn_record', {
          id: record.id,
          conversationId,
          mode: record.mode,
          iterations: record.iterations,
          toolCalls: JSON.stringify(record.toolCalls),
          tokenInput: record.tokenUsage?.inputTokens ?? 0,
          tokenOutput: record.tokenUsage?.outputTokens ?? 0,
          tokenTotal: record.tokenUsage?.totalTokens ?? 0,
          tokenCacheRead: record.tokenUsage?.cacheReadTokens ?? 0,
          tokenCacheWrite: record.tokenUsage?.cacheWriteTokens ?? 0,
          tokenCacheMeasuredRead: record.tokenUsage?.cacheMeasuredReadTokens ?? 0,
          tokenCacheEligible: record.tokenUsage?.cacheEligibleTokens ?? 0,
          tokenCacheMeasured: record.tokenUsage?.cacheMeasuredEligibleTokens ?? 0,
          tokenCacheHitRequests: record.tokenUsage?.cacheHitRequests ?? 0,
          tokenCacheObservedRequests: record.tokenUsage?.cacheObservedRequests ?? 0,
          tokenCacheTotalRequests: record.tokenUsage?.cacheTotalRequests ?? 0,
          tokenCacheUnknownRequests: record.tokenUsage?.cacheUnknownRequests ?? 0,
          stopReason: record.stopReason === 'loop_detected' ? 'error' : record.stopReason,
          verificationPerformed: record.verificationPerformed,
          verificationForced: record.verificationForced,
          filesModified: JSON.stringify(record.filesModified),
          durationMs: record.durationMs,
          parentTurnId: record.parentTurnId ?? null,
          timestamp: record.timestamp,
        });
      }

      // Persist the structured trace (if attached by the harness)
      if (record.trace) {
        try {
          await tauriInvokeRaw('db_create_trace', {
            id: record.trace.id,
            conversationId,
            mode: record.trace.mode,
            provider: record.trace.provider,
            model: record.trace.model,
            systemPromptHash: record.trace.systemPromptHash,
            systemPromptPreview: record.trace.systemPromptPreview,
            systemPromptTokens: record.trace.systemPromptTokens,
            toolCount: record.trace.toolCount,
            iterations: JSON.stringify(record.trace.iterations),
            tokenInput: record.trace.tokenUsage.inputTokens,
            tokenOutput: record.trace.tokenUsage.outputTokens,
            tokenTotal: record.trace.tokenUsage.totalTokens,
            tokenCacheRead: record.trace.tokenUsage.cacheReadTokens ?? 0,
            tokenCacheWrite: record.trace.tokenUsage.cacheWriteTokens ?? 0,
            tokenCacheMeasuredRead: record.trace.tokenUsage.cacheMeasuredReadTokens ?? 0,
            tokenCacheEligible: record.trace.tokenUsage.cacheEligibleTokens ?? 0,
            tokenCacheMeasured: record.trace.tokenUsage.cacheMeasuredEligibleTokens ?? 0,
            tokenCacheHitRequests: record.trace.tokenUsage.cacheHitRequests ?? 0,
            tokenCacheObservedRequests: record.trace.tokenUsage.cacheObservedRequests ?? 0,
            tokenCacheTotalRequests: record.trace.tokenUsage.cacheTotalRequests ?? 0,
            tokenCacheUnknownRequests: record.trace.tokenUsage.cacheUnknownRequests ?? 0,
            stopReason:
              record.trace.stopReason === 'loop_detected' ? 'error' : record.trace.stopReason,
            verificationPerformed: record.trace.verificationPerformed,
            verificationForced: record.trace.verificationForced,
            filesModified: JSON.stringify(record.trace.filesModified),
            errors: JSON.stringify(record.trace.errors),
            loopWarnings: JSON.stringify(record.trace.loopWarnings),
            durationMs: record.trace.durationMs,
            parentTurnId: record.trace.parentTurnId ?? record.parentTurnId ?? null,
          });
        } catch {
          console.warn('[HarnessBridge] Failed to persist trace');
        }
      }
    } catch (e) {
      // Turn record persistence is best-effort
      console.warn('[HarnessBridge] Failed to persist turn record', e);
    }
  }

  /**
   * Recompute cumulative token usage for the active conversation from the DB
   * (sum across persisted turn_records) and write it to the store as
   * `sessionTokenUsage`. Fire-and-forget; the UI only updates best-effort.
   */
  private async refreshSessionUsage(): Promise<void> {
    const useAgentStore = this.agentStore;
    const conversationId = useAgentStore.getState().conversationId;
    if (!conversationId || this.disposed || !this.isProjectCurrent()) return;
    try {
      const usage = await tauriInvokeRaw<TokenUsage | null>('db_get_conversation_token_usage', {
        conversationId,
      });
      if (
        usage &&
        !this.disposed &&
        this.isProjectCurrent() &&
        useAgentStore.getState().conversationId === conversationId
      ) {
        useAgentStore.getState().setSessionTokenUsage(usage);
      }
    } catch (e) {
      console.warn('[HarnessBridge] Failed to refresh session usage', e);
    }
  }

  private resolveConversationTitle(firstUserMessage: string): string {
    const store = this.agentStore.getState();
    return resolveVortexSessionTitle({
      tabTitle: store.openTabs.find((tab) => tab.id === store.activeTabId)?.title,
      firstUserMessage,
    });
  }

  private async commitTurn(
    titleSource: string,
    record: TurnRecord,
    providerId?: string,
    modelId?: string,
  ): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const settings = useSettingsStore.getState();
    const conversationId = store.conversationId;
    if (!conversationId) throw new Error('Cannot persist a turn without a conversation ID.');
    const title = this.resolveConversationTitle(titleSource);
    await tauriInvokeRaw('db_commit_agent_turn', {
      projectId: this._projectId,
      projectPath: this.harness.getWorkspacePath(),
      conversationId,
      title,
      mode: store.mode,
      modelId: modelId ?? settings.activeModelId ?? null,
      providerId: providerId ?? settings.activeProviderId ?? null,
      messagesJson: JSON.stringify(
        store.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          toolCalls: message.toolCalls ? JSON.stringify(message.toolCalls) : null,
          blocks: message.blocks ? JSON.stringify(message.blocks) : null,
          turnSummary: message.turnSummary ? JSON.stringify(message.turnSummary) : null,
        })),
      ),
      turnJson: JSON.stringify({
        id: record.id,
        mode: record.mode,
        iterations: record.iterations,
        toolCalls: JSON.stringify(record.toolCalls),
        tokenInput: record.tokenUsage.inputTokens,
        tokenOutput: record.tokenUsage.outputTokens,
        tokenTotal: record.tokenUsage.totalTokens,
        tokenCacheRead: record.tokenUsage.cacheReadTokens ?? 0,
        tokenCacheWrite: record.tokenUsage.cacheWriteTokens ?? 0,
        tokenCacheMeasuredRead: record.tokenUsage.cacheMeasuredReadTokens ?? 0,
        tokenCacheEligible: record.tokenUsage.cacheEligibleTokens ?? 0,
        tokenCacheMeasured: record.tokenUsage.cacheMeasuredEligibleTokens ?? 0,
        tokenCacheHitRequests: record.tokenUsage.cacheHitRequests ?? 0,
        tokenCacheObservedRequests: record.tokenUsage.cacheObservedRequests ?? 0,
        tokenCacheTotalRequests: record.tokenUsage.cacheTotalRequests ?? 0,
        tokenCacheUnknownRequests: record.tokenUsage.cacheUnknownRequests ?? 0,
        stopReason: record.stopReason,
        verificationPerformed: record.verificationPerformed,
        verificationForced: record.verificationForced,
        filesModified: JSON.stringify(record.filesModified),
        durationMs: record.durationMs,
      }),
    });
    notifyVortexProjectSessionIndexUpdated();
  }

  private async ensureConversationExists(
    titleSource: string,
    providerId?: string,
    modelId?: string,
  ): Promise<void> {
    const useAgentStore = this.agentStore;
    const store = useAgentStore.getState();
    const conversationId = store.conversationId;
    if (!conversationId) throw new Error('Cannot persist a turn without a conversation ID.');
    const title = this.resolveConversationTitle(titleSource);
    await tauriInvokeRaw('db_ensure_project', { id: this._projectId, path: this._projectId });
    await tauriInvokeRaw('db_create_conversation', {
      id: conversationId,
      projectId: this._projectId,
      title,
      mode: store.mode,
      modelId: modelId ?? useSettingsStore.getState().activeModelId ?? null,
      providerId: providerId ?? useSettingsStore.getState().activeProviderId ?? null,
    });
    notifyVortexProjectSessionIndexUpdated();
  }

  /** Shared Tauri invoke for agent tool execution (main agent AND sub-agents):
   *  serves buffered content for dirty files and captures mutation snapshots
   *  so every agent edit — including sub-agent edits — can be reviewed/reverted. */
  async invokeForHarness<T>(
    command: string,
    args?: Record<string, unknown>,
    authorization?: ToolInvocationAuthorization,
  ): Promise<T> {
    const workspacePath = authorization?.workspacePath ?? this.harness.getWorkspacePath();
    args = authorizeToolInvocationArgs(args, workspacePath, authorization?.externalPathAccess);
    if (
      authorization?.nativeGrantIds?.length &&
      NATIVE_AUTHORIZED_FILESYSTEM_COMMANDS.has(command)
    ) {
      args = { ...args, nativeGrantIds: [...authorization.nativeGrantIds] };
    }
    const path = typeof args?.path === 'string' ? args.path : null;
    if (command === 'get_diagnostics') {
      const requestedFile = path ?? undefined;
      const editorDiagnostics = getEditorDiagnostics(requestedFile);
      const openFiles = getOpenDiagnosticFiles();
      const requestedFileIsOpen =
        requestedFile !== undefined &&
        openFiles.some((openFile) => diagnosticPathsEqual(openFile, requestedFile));
      let compilerDiagnostics: DiagnosticContract[] = [];
      if (!requestedFileIsOpen) {
        const diagnosticArgs: { workspacePath: string; path?: string } = {
          workspacePath,
        };
        if (requestedFile) diagnosticArgs.path = requestedFile;
        const nativeGrantId = await tauriInvoke('workspace_confirm_diagnostics', {
          workspacePath,
        });
        try {
          compilerDiagnostics = await tauriInvoke('get_diagnostics', {
            ...diagnosticArgs,
            nativeGrantIds: [nativeGrantId],
          });
        } finally {
          try {
            await tauriInvoke('workspace_revoke_external_grants', {
              grantIds: [nativeGrantId],
            });
          } catch (error) {
            this.debug(`Could not revoke project-diagnostics grant: ${String(error)}`);
          }
        }
      }
      return mergeDiagnostics(
        editorDiagnostics,
        compilerDiagnostics,
        openFiles,
        requestedFile,
      ) as T;
    }
    if (command === 'read_file' && path) {
      const workspacePath = this.harness.getWorkspacePath();
      const fileStore = useFileStore.getState();
      const pathKey = projectPathKey(normalizeProjectPath(path));
      const tab =
        projectPathKey(fileStore.rootPath ?? '') === projectPathKey(workspacePath) &&
        isPathInsideWorkspace(path, workspacePath)
          ? useEditorStore
              .getState()
              .tabs.find(
                (item) =>
                  item.type === 'file' &&
                  projectPathKey(normalizeProjectPath(item.filePath)) === pathKey,
              )
          : undefined;
      const buffered = tab ? fileStore.getFileContent(tab.filePath) : undefined;
      if (tab?.isDirty && buffered !== undefined) return buffered as T;
    }

    const mutationPaths: string[] = [];
    if (path && ['write_file', 'create_file', 'delete_path'].includes(command))
      mutationPaths.push(path);
    if (['rename_path', 'move_path'].includes(command)) {
      if (typeof args?.from === 'string') mutationPaths.push(args.from);
      if (typeof args?.to === 'string') mutationPaths.push(args.to);
    }
    if (command === 'copy_path' && typeof args?.to === 'string') mutationPaths.push(args.to);
    for (const mutationPath of mutationPaths) {
      await this.captureMutationSnapshot(
        mutationPath,
        authorization?.nativeGrantIds,
        authorization?.revokeNativeGrantIds,
      );
    }
    return tauriInvokeRaw<T>(command, args);
  }

  private async captureMutationSnapshot(
    path: string,
    nativeGrantIds: readonly string[] = [],
    revokeNativeGrantIds: readonly string[] = [],
  ): Promise<void> {
    const mergeGrantIds = (snapshot: MutationSnapshot): void => {
      snapshot.nativeGrantIds = [
        ...new Set([...(snapshot.nativeGrantIds ?? []), ...revokeNativeGrantIds]),
      ];
    };
    const existing = this.mutationSnapshots.get(path);
    if (existing) {
      mergeGrantIds(existing);
      return;
    }
    // Serialize concurrent captures of the same path: two children writing
    // the same file must not both capture and overwrite the baseline.
    const inFlight = this.mutationSnapshotPromises.get(path);
    if (inFlight) {
      await inFlight;
      const snapshot = this.mutationSnapshots.get(path);
      if (snapshot) mergeGrantIds(snapshot);
      return;
    }
    const capture = (async () => {
      if (this.mutationSnapshots.has(path)) return;
      let diskBefore: string | null = null;
      try {
        diskBefore = await tauriInvokeRaw<string>('read_file', {
          path,
          ...(nativeGrantIds.length > 0 ? { nativeGrantIds: [...nativeGrantIds] } : {}),
        });
      } catch {
        // New file or directory.
      }
      const tab = useEditorStore
        .getState()
        .tabs.find((item) => item.filePath === path && item.type === 'file');
      const bufferBefore = useFileStore.getState().getFileContent(path) ?? diskBefore;
      this.mutationSnapshots.set(path, {
        diskBefore,
        bufferBefore,
        wasDirty: tab?.isDirty ?? false,
        tabId: tab?.id ?? null,
        nativeGrantIds: [...revokeNativeGrantIds],
      });
    })();
    this.mutationSnapshotPromises.set(path, capture);
    try {
      await capture;
    } finally {
      this.mutationSnapshotPromises.delete(path);
    }
  }

  private async restoreMutationSnapshot(
    path: string,
    session?: Pick<AgentEditSession, 'diskOriginalContent' | 'originalContent' | 'wasDirty'>,
    expectedContent?: string | null,
  ): Promise<void> {
    const useAgentStore = this.agentStore;
    const captured = this.mutationSnapshots.get(path);
    const diskBefore =
      captured?.diskBefore ?? session?.diskOriginalContent ?? session?.originalContent ?? null;
    const bufferBefore = captured?.bufferBefore ?? session?.originalContent ?? diskBefore;
    const expectedOnDisk =
      captured?.expectedContent !== undefined ? captured.expectedContent : expectedContent;
    const nativeGrantIds = captured?.nativeGrantIds ?? [];
    const grantArgs = nativeGrantIds.length > 0 ? { nativeGrantIds: [...nativeGrantIds] } : {};
    let diskRestored = false;
    try {
      if (expectedOnDisk === undefined) {
        throw new Error('The current file revision cannot be verified; refusing to revert it.');
      }
      const currentExists = await tauriInvoke('path_exists', { path, ...grantArgs });
      if (expectedOnDisk === null && currentExists) {
        throw new Error('The file changed on disk after the agent edit; refusing to revert it.');
      }
      if (typeof expectedOnDisk === 'string') {
        if (!currentExists) {
          throw new Error('The file changed on disk after the agent edit; refusing to revert it.');
        }
        const currentContent = await tauriInvokeRaw<string>('read_file', { path, ...grantArgs });
        if (currentContent !== expectedOnDisk) {
          throw new Error('The file changed on disk after the agent edit; refusing to revert it.');
        }
      }

      if (diskBefore === null && currentExists) {
        await tauriInvokeRaw<void>('delete_path', {
          path,
          ...grantArgs,
        });
      } else if (diskBefore !== null) {
        await tauriInvokeRaw<void>('write_file', {
          path,
          content: diskBefore,
          ...grantArgs,
        });
      }
      diskRestored = true;
    } catch (error) {
      console.warn('[HarnessBridge] Failed to restore disk snapshot:', error);
      throw new Error(
        error instanceof Error && error.message.includes('refusing to revert')
          ? `${error.message} The change remains pending for recovery.`
          : `Could not restore the original file at ${path}; the change remains pending for recovery.`,
      );
    }
    if (bufferBefore !== null) {
      useFileStore.getState().setFileContent(path, bufferBefore);
      useAgentStore.setState((draft) => {
        const edit = draft.agentEditSessions.find(
          (item) =>
            item.filePath === path &&
            (item.phase === 'streaming' || item.phase === 'pending_review'),
        );
        if (edit) edit.newContent = bufferBefore;
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const tabId =
      captured?.tabId ?? useEditorStore.getState().tabs.find((tab) => tab.filePath === path)?.id;
    if (tabId)
      useEditorStore.getState().markDirty(tabId, captured?.wasDirty ?? session?.wasDirty ?? false);
    if (diskRestored) {
      this.mutationSnapshots.delete(path);
      await this.revokeMutationGrants(captured);
    }
  }

  private async acceptMutationSnapshot(path: string): Promise<void> {
    const captured = this.mutationSnapshots.get(path);
    const tabId =
      captured?.tabId ?? useEditorStore.getState().tabs.find((tab) => tab.filePath === path)?.id;
    if (tabId) useEditorStore.getState().markDirty(tabId, false);
    this.mutationSnapshots.delete(path);
    await this.revokeMutationGrants(captured);
  }

  private async revokeMutationGrants(snapshot: MutationSnapshot | undefined): Promise<void> {
    if (!snapshot?.nativeGrantIds?.length) return;
    const stillNeeded = new Set(
      [...this.mutationSnapshots.values()].flatMap((pending) => pending.nativeGrantIds ?? []),
    );
    const grantIds = snapshot.nativeGrantIds.filter((grantId) => !stillNeeded.has(grantId));
    if (grantIds.length === 0) return;
    try {
      await tauriInvoke('workspace_revoke_external_grants', {
        grantIds,
      });
    } catch (error) {
      this.debug(`Could not revoke mutation-review grants: ${String(error)}`);
    }
  }
}

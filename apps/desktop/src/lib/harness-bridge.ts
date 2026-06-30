// ─── Harness Bridge ─────────────────────────────────────────────────────────
// Singleton that owns the Harness instance and wires its events → Zustand stores.
// Lives outside React to avoid re-renders during streaming.

import { Harness, SkillLoader, RuleLoader, applyPolicyOverride, getModePolicy, MemoryManager } from '@hyscode/agent-harness';
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
} from '@hyscode/agent-harness';
import type { Message, ToolDefinition, MessageContent, TokenUsage } from '@hyscode/ai-providers';
import { tauriInvokeRaw } from './tauri-invoke';
import { tauriFs } from './tauri-fs';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { McpBridge } from './mcp-bridge';
import { useAgentStore } from '@/stores/agent-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useMemoryStore } from '@/stores/memory-store';
import { useSkillsStore } from '@/stores/skills-store';
import { useRulesStore } from '@/stores/rules-store';
import { useFileStore } from '@/stores/file-store';
import { useEditorStore } from '@/stores/editor-store';
import { useTerminalStore } from '@/stores/terminal-store';
import type { ToolCallDisplay, PendingApproval, AgentEditSession, SubAgentState, AgentMode } from '@/stores/agent-store';
import { computeDiffHunks } from './compute-diff';
import { SubAgentRunner } from './sub-agent-runner';

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
        parsed?.error?.message ??
        parsed?.message ??
        parsed?.error ??
        undefined;
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
  if (lower.includes('invalid_api_key') || lower.includes('authentication') || lower.includes('unauthorized') || raw.includes('401')) {
    return 'Invalid API key. Check your key in Settings → Providers.';
  }
  if (lower.includes('rate limit') || lower.includes('rate_limit') || raw.includes('429')) {
    return 'Rate limit reached. Please wait a moment before sending another message.';
  }
  if (lower.includes('overloaded') || lower.includes('529')) {
    return 'The AI provider is temporarily overloaded. Please try again in a moment.';
  }
  if (lower.includes('context') && (lower.includes('length') || lower.includes('window') || lower.includes('token'))) {
    return 'The conversation is too long for this model. Try starting a new conversation.';
  }
  if (lower.includes('model') && lower.includes('not found')) {
    return 'The selected model is not available. Please choose a different model in Settings.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The request timed out. Check your connection and try again.';
  }
  if (lower.includes('no api key') || lower.includes('missing') && lower.includes('key')) {
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

function createSddDatabase(): SddDatabase {
  const parseSession = (value: string): SddSession => ({ ...JSON.parse(value), tasks: [] }) as SddSession;
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

type MutationSnapshot = {
  diskBefore: string | null;
  bufferBefore: string | null;
  wasDirty: boolean;
  tabId: string | null;
};

export class HarnessBridge {
  private harness: Harness;
  private _projectId: string = '';
  private approvalResolvers = new Map<string, (approved: boolean) => void>();
  private modeSwitchResolvers = new Map<string, (approved: boolean) => void>();
  private userQuestionResolvers = new Map<string, (answers: import('@hyscode/agent-harness').AgentQuestionAnswer[]) => void>();
  /** Active sub-agent runners keyed by their id (toolCallId of spawn_subagent). */
  private _subAgentRunners = new Map<string, SubAgentRunner>();
  /** Accumulated tool results for the current iteration (flushed between turns). */
  private pendingToolResults: Array<{ toolCallId: string; output: string; isError: boolean }> = [];
  /** Tool call IDs seen in the current iteration (for building assistant blocks). */
  private currentIterationToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  private mutationSnapshots = new Map<string, MutationSnapshot>();

  // ─── Agent Terminal Integration ───────────────────────────────────
  /** Pool of terminal store session ids owned by the agent, keyed by conversationId */
  private _agentTerminalSessionIds: Map<string, string[]> = new Map();
  /** Last terminal command executed by the agent (persists across turns within a conversation) */
  private _lastTerminalCommand: { command: string; output: string; exitCode: number | null } | null = null;

  private constructor(workspacePath: string, projectId: string, homePath: string) {
    this._projectId = projectId;
    const settings = useSettingsStore.getState();

    // Instantiate MemoryManager (bridges to Tauri SQLite memory commands)
    const memoryManager = new MemoryManager(tauriInvokeRaw);

    // Trigger one-time relevance decay on startup (best-effort, non-blocking)
    memoryManager.decayRelevance(projectId).catch(() => {});

    // Sync projectId to memory store so sidebar can query memories
    useMemoryStore.getState().setProjectId(projectId);

    // Create SkillLoader with Tauri-backed file system callbacks
    const skillLoader = new SkillLoader({
      builtInPath: `${workspacePath}/node_modules/@hyscode/skills/dist`,
      globalPath: `${homePath}/.agents/skills`,
      workspacePath,
      readDir: async (path: string) => {
        try {
          // Use list_dir_all to include hidden entries and skill folders
          return await tauriInvokeRaw<Array<{ name: string; is_dir: boolean }>>('list_dir_all', { path });
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
      globalPath: `${homePath}/.config/hyscode/rules`,
      workspacePath,
      readDir: async (path: string) => {
        try {
          return await tauriInvokeRaw<Array<{ name: string; is_dir: boolean }>>('list_dir_all', { path });
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
      invoke: (command, args) => this.invokeForHarness(command, args),
      memoryManager,
      sddDb: createSddDatabase(),
      hasDirtyBuffers: () => useEditorStore.getState().tabs.some((tab) => tab.type === 'file' && tab.isDirty),
      listen: async (event: string, handler: (payload: unknown) => void) => {
        const unlisten = await tauriListen(event, (e) => handler(e.payload));
        return unlisten;
      },
      savePlanFile: async (sessionId, spec, tasks) => {
        const planDir = `${workspacePath}/.hyscode/plans`;
        const planPath = `${planDir}/PLAN-${sessionId}.md`;
        const taskList = tasks
          .map((t, i) => `${i + 1}. **${t.title}**\n   - Files: ${t.files.join(', ') || 'N/A'}\n   - Description: ${t.description}`)
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
        maxIterations: settings.maxIterations,
        maxOutputTokens: settings.maxTokens,
        maxInputTokens: 200_000,
        turnTimeoutMs: 300_000,
        approval: {
          mode: settings.approvalMode,
          ...(settings.approvalMode === 'custom' && {
            // Settings store uses: true = auto-approve. Harness uses: true = needs approval.
            categoryOverrides: Object.fromEntries(
              Object.entries(settings.customApprovalRules.categoryRules)
                .map(([k, autoApprove]) => [k, !autoApprove]),
            ) as Record<string, boolean>,
            toolOverrides: Object.fromEntries(
              Object.entries(settings.customApprovalRules.toolRules)
                .map(([k, autoApprove]) => [k, !autoApprove]),
            ),
          }),
        },
        thinking: this.buildThinkingConfig(settings.activeProviderId, settings.activeModelId),
      },
      onEvent: (event) => this.handleEvent(event),
      onApprovalRequest: (pending, signal) => this.handleApprovalRequest(pending, signal),
      onModeSwitchRequest: (request, signal) => this.handleModeSwitchRequest(request, signal),
      onUserQuestionRequest: (id, questions, title, signal) => this.handleUserQuestionRequest(id, questions, title, signal),
      skillLoader,
      ruleLoader,
    });

    // Listen for PTY exits so we can mark agent sessions as dead and avoid reuse
    tauriListen<{ pty_id: string }>('pty:exit', (e) => {
      const deadPtyId = e.payload.pty_id;
      const ts = useTerminalStore.getState();
      const session = ts.sessions.find((s) => s.ptyId === deadPtyId && s.isAgentSession);
      if (session) {
        ts.markPtyDead(session.id);
        // Remove from all tab pools so the next command spawns a fresh one
        for (const [convId, ids] of this._agentTerminalSessionIds.entries()) {
          const filtered = ids.filter((id) => id !== session.id);
          if (filtered.length !== ids.length) {
            this._agentTerminalSessionIds.set(convId, filtered);
          }
        }
      }
    }).catch(() => {});
  }

  private static _homePathCache: string | null = null;

  /** Fallback home path when Tauri command is not available */
  private static getHomePathFallback(): string {
    const isWin = navigator.userAgent?.includes('Windows');
    const username = (globalThis as Record<string, unknown>).__TAURI_USERNAME__ as string | undefined;
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

    // Resolve home directory via Rust (reliable cross-platform)
    let homePath: string;
    try {
      homePath = await tauriInvokeRaw<string>('get_home_dir', {});
    } catch {
      homePath = HarnessBridge.getHomePathFallback();
    }
    HarnessBridge._homePathCache = homePath;

    _instance = new HarnessBridge(workspacePath, projectId, homePath);

    // Load mode policy overrides from the database (best-effort)
    await _instance.loadModePolicies();

    // Load rules and sync with store so they're active from the first turn
    await _instance.loadAndSyncRules();

    // Register the spawn_subagent built-in tool
    _instance.registerSpawnSubagentTool();

    // Subscribe to tab switches: keep harness in sync with the active tab
    _instance.subscribeToTabSwitches();

    return _instance;
  }

  static get(): HarnessBridge {
    if (!_instance) throw new Error('HarnessBridge not initialized. Call HarnessBridge.init() first.');
    return _instance;
  }

  static destroy(): void {
    if (_instance) {
      _instance.cancel();
      _instance = null;
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────

  async sendMessage(userMessage: string): Promise<void> {
    const store = useAgentStore.getState();
    const settings = useSettingsStore.getState();

    const providerId = settings.activeProviderId ?? '';
    const modelId = settings.activeModelId ?? '';

    // Determine approval mode: use mode policy default, but respect user's custom rules
    const modePolicy = getModePolicy(store.mode as AgentType);
    const approvalConfig = settings.approvalMode === 'custom'
      ? {
          mode: 'custom' as const,
          categoryOverrides: Object.fromEntries(
            Object.entries(settings.customApprovalRules.categoryRules)
              .map(([k, autoApprove]) => [k, !autoApprove]),
          ) as Record<string, boolean>,
          toolOverrides: Object.fromEntries(
            Object.entries(settings.customApprovalRules.toolRules)
              .map(([k, autoApprove]) => [k, !autoApprove]),
          ),
        }
      : { mode: modePolicy.approvalMode };

    // Sync settings → harness config
    this.harness.setConfig({
      providerId,
      modelId,
      maxIterations: settings.maxIterations,
      maxOutputTokens: settings.maxTokens,
      approval: approvalConfig,
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

    dbg(`Iniciando com provider="${providerId || '(default)'}" model="${modelId || '(default)'}"`);

    // Reset per-turn credit counter
    useAgentStore.getState().resetApiRequestCount();
    useAgentStore.getState().setTokenUsage(null);

    // Map store.mode → ConversationMode for the harness
    let harnessMode: ConversationMode = 'agent';
    if (store.mode === 'chat') harnessMode = 'chat';
    // SDD phases are driven by the explicit start/approve/resume methods. Chat
    // messages in a build tab must still execute as normal agent turns.
    this.harness.setMode(harnessMode);
    dbg(`Modo: ${harnessMode} (agent: ${store.mode})`);

    // Sync active skills from skills store → harness (respects per-mode assignments)
    const activeForMode = useSkillsStore.getState().getActiveForMode(store.mode as AgentType);
    this.syncActiveSkills(activeForMode.map((s) => s.name));
    dbg(`Skills ativas: ${activeForMode.length}`);

    // Sync active rules from rules store → harness
    const activeRules = useRulesStore.getState().getActiveRules();
    this.syncActiveRules(activeRules.map((r) => r.id));
    dbg(`Rules ativas: ${activeRules.length}`);

    // Always sync conversationId to harness — tab may have switched since last run
    if (!store.conversationId) {
      const id = crypto.randomUUID();
      useAgentStore.getState().setConversationId(id);
      this.harness.setConversationId(id);
    } else {
      this.harness.setConversationId(store.conversationId);
    }

    // Clear any context carried over from a previous tab before injecting fresh sources
    this.clearTabContext();

    // Inject context files into the harness context manager
    const contextFiles = store.contextFiles;
    if (contextFiles.length > 0) {
      dbg(`Injetando ${contextFiles.length} arquivo(s) de contexto`);
      for (const filePath of contextFiles) {
        try {
          const content = await tauriInvokeRaw<string>('read_file', { path: filePath });
          const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
          const tokenEstimate = Math.ceil(content.length / 4);
          this.harness.addContextSource({
            id: `ctx-file-${filePath}`,
            type: 'context_chip',
            priority: 'high',
            content: `<file path="${filePath}">\n${content}\n</file>`,
            tokenEstimate,
            metadata: { filePath, fileName },
          });
        } catch {
          // Might be a directory — list its tree instead
          try {
            const entries = await tauriInvokeRaw<Array<{ name: string; is_dir: boolean }>>(
              'list_dir_all', { path: filePath },
            );
            const tree = entries
              .map((e) => `${e.is_dir ? '📁' : '📄'} ${e.name}`)
              .join('\n');
            const dirName = filePath.split(/[\\/]/).pop() ?? filePath;
            const tokenEstimate = Math.ceil(tree.length / 4);
            this.harness.addContextSource({
              id: `ctx-dir-${filePath}`,
              type: 'context_chip',
              priority: 'high',
              content: `<directory path="${filePath}">\n${tree}\n</directory>`,
              tokenEstimate,
              metadata: { filePath, fileName: dirName, isDirectory: true },
            });
          } catch (dirErr) {
            dbg(`Erro ao ler contexto ${filePath}: ${dirErr}`);
          }
        }
      }
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

    // Add user message to store (with blocks for faithful history)
    const userMsgId = crypto.randomUUID();
    useAgentStore.getState().addMessage({
      id: userMsgId,
      role: 'user',
      content: userMessage,
      blocks: userBlocks.length > 1 ? userBlocks : undefined,
      timestamp: Date.now(),
    });

    // Auto-title the tab from first user message if still untitled
    {
      const s = useAgentStore.getState();
      const activeTab = s.openTabs.find((t) => t.id === s.activeTabId);
      if (activeTab && activeTab.title === 'New Chat') {
        const autoTitle = userMessage.slice(0, 40).trimEnd() + (userMessage.length > 40 ? '…' : '');
        s.updateTabTitle(s.activeTabId, autoTitle);
      }
    }

    // Start streaming
    useAgentStore.getState().setStreaming(true);

    // Create placeholder assistant message
    const assistantMsgId = crypto.randomUUID();
    useAgentStore.getState().addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });

    try {
      // Build history from store messages (use fresh state after addMessage calls)
      // Exclude the last 2 messages (user + placeholder assistant for this turn)
      const history = this.buildHistory(useAgentStore.getState().messages.slice(0, -2));

      // Reset iteration tracking for the new turn
      this.currentIterationToolCalls = [];
      this.pendingToolResults = [];

      // ── Ensure agent terminal is available ──
      // Creates or finds the shared agent terminal session so the agent's
      // run_terminal_command tool uses the visible terminal tab instead of hidden PTYs.
      await this.ensureAgentTerminal();

      // ── Inject deterministic environment context ──
      // Gives the agent awareness of the current workspace state before it starts
      await this.injectEnvironmentContext();

      // ── Pre-turn context hints ──
      // Analyze user message for file references and provide hints to the agent
      await this.injectContextHints(userMessage);

      dbg(`Enviando para LLM (${history.length} msgs no histórico)...`);

      const { response, turnRecord, status } = await this.harness.run(
        userMessage,
        history,
        imageContent.length > 0 ? imageContent : undefined,
      );

      dbg(`Resposta recebida (${response.length} chars, ${turnRecord.iterations} iterações, ${turnRecord.toolCalls.length} tool calls)`);

      // Persist conversation to DB FIRST (turn record has FK on conversationId)
      await this.persistConversation(userMessage, response);

      // Persist the structured turn record (requires conversation to exist)
      await this.persistTurnRecord(turnRecord);

      // Flush any remaining streaming text
      useAgentStore.getState().flushStreamingText();

      // Update the last assistant message with the final response
      if (status === 'error') useAgentStore.getState().updateLastAssistantError(parseProviderError(response));
      else useAgentStore.getState().updateLastAssistantContent(response);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Unknown error';
      const friendlyMsg = parseProviderError(rawMsg);
      dbg(`ERRO: ${rawMsg}`);
      useAgentStore.getState().updateLastAssistantError(friendlyMsg);
    } finally {
      useAgentStore.getState().setStreaming(false);
      // OS notification when the app is in the background
      if (document.hidden) {
        try {
          const { openTabs, activeTabId } = useAgentStore.getState();
          const tabTitle = openTabs.find((t) => t.id === activeTabId)?.title ?? 'Agent';
          await tauriInvokeRaw('notify_agent_done', { title: tabTitle, body: 'Agent finished working' });
        } catch {
          // Notification is best-effort — non-fatal
        }
      }
    }
  }

  cancel(): void {
    // Cancel all active sub-agent runners first
    for (const runner of this._subAgentRunners.values()) {
      runner.cancel();
    }
    this._subAgentRunners.clear();
    this.harness.cancel();
  }

  /** Pause SDD execution after the current task finishes */
  pauseSdd(): void {
    this.harness.getSddEngine()?.pause();
    this.debug('SDD paused');
  }

  /** Resume SDD execution */
  async resumeSdd(): Promise<void> {
    const store = useAgentStore.getState();
    store.setStreaming(true);
    try {
      const result = await this.harness.resumeSddPlan();
      if (!result.startsWith('SDD execution ')) {
        store.addMessage({ id: crypto.randomUUID(), role: 'assistant', content: result, timestamp: Date.now() });
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
    await this.harness.getSddEngine()?.retryTask(taskId);
    useAgentStore.getState().updateSddTask(taskId, { status: 'pending', agentOutput: null });
    this.debug(`SDD task queued for retry: ${taskId}`);
  }

  /**
   * Delegate a failed SDD task to the Debug agent.
   * Switches mode to debug and sends the error context as a message.
   */
  async debugFailedSddTask(): Promise<void> {
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
    const store = useAgentStore.getState();
    const lastUserMessage = [...store.messages].reverse().find((m) => m.role === 'user');
    const description = lastUserMessage?.content || 'Continue implementation from current conversation';

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
    this.harness.setAgentType(type);
    useAgentStore.getState().setMode(type as import('@/stores/agent-store').AgentMode);
  }

  /** Resolve a pending mode switch delegation (approve or deny) */
  resolveModeSwitch(approved: boolean): void {
    const store = useAgentStore.getState();
    const req = store.pendingModeSwitch;
    if (!req) return;

    if (approved) {
      this.debug(`Delegação aprovada: ${req.fromMode} → ${req.toMode}`);
      this.setAgentType(req.toMode as AgentType);
    } else {
      this.debug(`Delegação rejeitada: ${req.fromMode} → ${req.toMode}`);
    }

    // Resolve the promise that pauses the harness loop
    const resolver = this.modeSwitchResolvers.get(req.id);
    if (resolver) {
      resolver(approved);
      this.modeSwitchResolvers.delete(req.id);
    }

    store.resolveModeSwitch(approved);
  }

  /** Resolve a pending approval from the UI */
  resolveApproval(id: string, approved: boolean): void {
    const resolver = this.approvalResolvers.get(id);
    if (resolver) {
      resolver(approved);
      this.approvalResolvers.delete(id);
      useAgentStore.getState().removePendingApproval(id);
    }
  }

  /** Mark a tool as trusted for the current session (session-trust mode) */
  trustToolForSession(toolName: string): void {
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

  /** Accept or revert a single pending file change */
  async resolveFileChange(id: string, accepted: boolean): Promise<void> {
    const store = useAgentStore.getState();
    const change = store.pendingFileChanges.find((c) => c.id === id);
    if (!change || change.status !== 'pending') return;

    if (!accepted) {
      await this.restoreMutationSnapshot(change.filePath, { originalContent: change.originalContent });
    } else this.acceptMutationSnapshot(change.filePath);

    store.resolvePendingFileChange(id, accepted);
  }

  /** Accept or revert ALL pending file changes in bulk */
  async resolveAllFileChanges(accepted: boolean): Promise<void> {
    const store = useAgentStore.getState();
    const pending = store.pendingFileChanges.filter((c) => c.status === 'pending');

    if (!accepted) {
      for (const change of pending) {
        await this.restoreMutationSnapshot(change.filePath, { originalContent: change.originalContent });
      }
    } else for (const change of pending) this.acceptMutationSnapshot(change.filePath);

    store.resolveAllPendingFileChanges(accepted);
  }

  /** Accept or revert a single agent edit session */
  async resolveEditSession(id: string, accepted: boolean): Promise<void> {
    const store = useAgentStore.getState();
    const session = store.agentEditSessions.find(
      (s) => s.id === id && (s.phase === 'streaming' || s.phase === 'pending_review'),
    );
    if (!session) return;

    if (!accepted) await this.restoreMutationSnapshot(session.filePath, session);
    else this.acceptMutationSnapshot(session.filePath);

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
    const store = useAgentStore.getState();
    const active = store.agentEditSessions.filter(
      (s) => s.phase === 'streaming' || s.phase === 'pending_review',
    );

    if (!accepted) {
      for (const session of active) {
        await this.restoreMutationSnapshot(session.filePath, session);
      }
    } else for (const session of active) this.acceptMutationSnapshot(session.filePath);

    store.resolveAllEditSessions(accepted);
    store.resolveAllPendingFileChanges(accepted);
  }

  /** Sync conversation ID when restoring a previous session */
  restoreSession(conversationId: string): void {
    this.harness.setConversationId(conversationId);
    useAgentStore.getState().setConversationId(conversationId);
    // Clear session trust when switching sessions
    this.clearSessionTrust();
    // Clear context sources so previous session's context doesn't bleed into the new one
    this.clearTabContext();
    this.restoreSddForConversation(conversationId).catch((error) => {
      this.debug(`Failed to restore SDD session: ${error instanceof Error ? error.message : String(error)}`);
    });
    // Refresh cumulative token usage for the restored session from the DB.
    useAgentStore.getState().setSessionTokenUsage(null);
    void this.refreshSessionUsage();
    this.debug(`Session restored: ${conversationId}`);
  }

  private async restoreSddForConversation(conversationId: string): Promise<void> {
    const rows = await tauriInvokeRaw<string[]>('db_sdd_list_sessions', { projectId: this._projectId });
    const sessions = rows.map((row) => JSON.parse(row) as SddSession);
    const active = sessions.find((session) =>
      session.conversationId === conversationId && !['completed', 'cancelled'].includes(session.status),
    );
    if (!active) return;
    const taskRows = await tauriInvokeRaw<string[]>('db_sdd_get_tasks', { sessionId: active.id });
    const tasks = taskRows.map((row) => JSON.parse(row) as SddTask);
    this.harness.restoreSddSession(active.id);
    const store = useAgentStore.getState();
    store.setSddPhase(active.status);
    store.setSddSpec(active.spec);
    store.setSddTasks(tasks);
  }

  /** Clear harness context sources (call when switching tabs or restoring sessions). */
  clearTabContext(): void {
    this.harness.getContextManager().clearConversationContext();
    useAgentStore.getState().setGatheredContext([]);
  }

  /**
   * Subscribe to tab switches in the Zustand store.
   * When the user switches tabs, immediately sync the harness to the new tab's state.
   */
  private subscribeToTabSwitches(): void {
    let prevTabId = useAgentStore.getState().activeTabId;
    useAgentStore.subscribe((state) => {
      if (state.activeTabId !== prevTabId) {
        prevTabId = state.activeTabId;
        this.syncToActiveTab(state);
      }
    });
  }

  /** Sync the harness to whatever tab is currently active (called on tab switch). */
  private syncToActiveTab(state: ReturnType<typeof useAgentStore.getState>): void {
    // Reset context so nothing bleeds from the previous tab
    this.clearTabContext();
    // Point the harness at the new tab's conversation
    if (state.conversationId) {
      this.harness.setConversationId(state.conversationId);
      // Refresh cumulative token usage for the new active tab from the DB.
      useAgentStore.getState().setSessionTokenUsage(null);
      void this.refreshSessionUsage();
    }
    this.debug(`Harness synced to tab: ${state.activeTabId} (conv: ${state.conversationId ?? 'none'})`);
  }

  async loadSkills(): Promise<Skill[]> {
    try {
      await this.harness.loadSkills();
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

  async loadRules(): Promise<import('@hyscode/agent-harness').Rule[]> {
    try {
      const loader = this.harness.getRuleLoader();
      if (!loader) return [];
      const all = await loader.loadAll();
      this.debug(`Rules loaded: ${all.length} total`);
      return all;
    } catch (err) {
      this.debug(`Failed to load rules: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /** Sync the active rule set from the rules store to the harness before a run */
  syncActiveRules(activeRuleIds: string[]): void {
    const loader = this.harness.getRuleLoader();
    if (!loader) return;
    // Disable all, then enable only the ones from the store
    for (const rule of loader.getAll()) {
      rule.enabled = false;
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
      if (discovered.length > 0) {
        useRulesStore.getState().setDiscoveredRules(discovered);
        const active = useRulesStore.getState().getActiveRules();
        this.syncActiveRules(active.map((r) => r.id));
        this.debug(`Rules synced: ${active.length}/${discovered.length} active`);
      }
    } catch (err) {
      this.debug(`Rules init failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Register the spawn_subagent built-in tool so non-chat agents can delegate subtasks. */
  private registerSpawnSubagentTool(): void {
    const bridge = this;

    const handler: ToolHandler = {
      definition: {
        name: 'spawn_subagent',
        description: 'Delegate a focused subtask to a specialized sub-agent. The parent waits for the sub-agent to finish and then receives its result. Use this to apply a specialist agent (for example review or debug) to a self-contained subtask. Not available in chat mode.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'Clear, self-contained description of the subtask. Include all context needed for the sub-agent to work independently.',
            },
            mode: {
              type: 'string',
              enum: ['build', 'review', 'debug', 'plan'],
              description: 'The agent mode to use. build=implement code, review=analyze code quality, debug=investigate bugs, plan=create implementation plan.',
            },
          },
          required: ['task'],
        },
      } satisfies ToolDefinition,
      category: 'meta' as ToolCategory,
      requiresApproval: false,
      execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
        const settings = useSettingsStore.getState();

        if (!settings.subAgentEnabled) {
          return { success: false, output: '', error: 'Sub-agents are disabled in Settings → Sub-agents.' };
        }

        const { task, mode: inputMode } = input as { task: string; mode?: AgentMode };
        // Fall back to the configured default mode when the LLM omits it
        const mode: AgentMode = inputMode ?? settings.subAgentDefaultMode;

        // Prevent spawning a sub-agent in the same mode as the parent
        const parentMode = useAgentStore.getState().mode;
        if (mode === parentMode) {
          const alternatives: Record<string, string> = { build: 'review', review: 'build', debug: 'build', plan: 'review' };
          const suggested = alternatives[mode] ?? 'review';
          return {
            success: false,
            output: '',
            error: `Cannot spawn a '${mode}' sub-agent from a '${parentMode}' parent — same-mode recursion is wasteful. Use '${suggested}' mode instead, or handle this task yourself.`,
          };
        }
        const subAgentId = ctx.toolCallId;
        const store = useAgentStore.getState();

        const subAgent: SubAgentState = {
          id: subAgentId,
          task,
          mode,
          status: 'running',
          output: '',
          toolCalls: [],
          startedAt: Date.now(),
        };
        store.addSubAgent(subAgent);

        const runner = new SubAgentRunner({
          id: subAgentId,
          task,
          mode,
          workspacePath: bridge.harness.getWorkspacePath(),
          projectId: bridge._projectId,
          invoke: tauriInvokeRaw,
          listen: async (event: string, handler: (payload: unknown) => void) => {
            const unlisten = await tauriListen(event, (e) => handler(e.payload));
            return unlisten;
          },
          onApproval: (pending, signal) => bridge.handleApprovalRequest(pending, signal),
          onUpdate: (patch) => store.updateSubAgent(subAgentId, patch),
          activeSkills: bridge.harness.getActiveSkills(),
          activeRules: bridge.harness.getActiveRules(),
        });

        bridge._subAgentRunners.set(subAgentId, runner);

        try {
          const output = await runner.run(task);
          return { success: true, output };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, output: '', error: msg };
        } finally {
          bridge._subAgentRunners.delete(subAgentId);
        }
      },
    };

    this.harness.registerExternalTool(handler);
  }

  /** Register all tools from connected MCP servers as native tool handlers */
  async registerMcpTools(): Promise<void> {
    try {
      const mcpBridge = McpBridge.get();
      const mcpTools = mcpBridge.getTools();

      let registered = 0;
      for (const tool of mcpTools) {
        const serverId = tool.serverId;
        const toolName = `mcp__${serverId}__${tool.name}`;

        const handler: ToolHandler = {
          definition: {
            name: toolName,
            description: `[MCP: ${serverId}] ${tool.description ?? tool.name}`,
            inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {}, required: [] },
          } satisfies ToolDefinition,
          category: 'mcp' as ToolCategory,
          requiresApproval: true,
          execute: async (input: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> => {
            try {
              const result = await mcpBridge.callTool(serverId, tool.name, input);
              const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
              return { success: true, output };
            } catch (err) {
              return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
            }
          },
        };

        this.harness.registerExternalTool(handler);
        registered++;
      }

      if (registered > 0) {
        this.debug(`Registered ${registered} MCP tools`);
      }
    } catch {
      // McpBridge may not be initialized yet — that's fine, MCP tools are optional
    }
  }

  // ─── Event Handling ─────────────────────────────────────────────────

  private debug(msg: string): void {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log('[Harness]', msg);
    useAgentStore.getState().addDebugLine(line);
  }

  private handleEvent(event: HarnessEvent): void {
    const store = useAgentStore.getState();

    switch (event.type) {
      case 'turn_start': {
        this.debug(`Iteração ${event.iteration} — aguardando LLM...`);

        // On subsequent turns, finalize the previous iteration's blocks,
        // flush current text, and create a fresh assistant message
        if (event.iteration > 1) {
          this.finalizeIterationBlocks();
          store.flushStreamingText();
          store.addMessage({
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

      case 'stream_chunk': {
        const chunk = event.chunk;
        if (chunk.type === 'text_delta') {
          store.appendStreamingText(chunk.text);
        }
        if (chunk.type === 'thinking_delta') {
          store.appendThinkingText(chunk.text);
        }
        if (chunk.type === 'usage') {
          // Each provider emits one consolidated usage chunk per API request.
          // Sum across the iterations of a multi-iteration turn. Cache fields
          // (Anthropic prompt caching) are preserved when the chunk includes
          // them; a chunk that omits them contributes 0.
          const u = chunk.usage;
          const current = useAgentStore.getState().tokenUsage;
          const inputTokens = (current?.inputTokens ?? 0) + u.inputTokens;
          const outputTokens = (current?.outputTokens ?? 0) + u.outputTokens;
          const cacheReadTokens =
            (current?.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0);
          const cacheWriteTokens =
            (current?.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0);
          const totalTokens =
            u.totalTokens > 0
              ? (current?.totalTokens ?? 0) + u.totalTokens
              : inputTokens + outputTokens;
          store.setTokenUsage({
            inputTokens,
            outputTokens,
            totalTokens,
            cacheReadTokens,
            cacheWriteTokens,
          });
        }
        break;
      }

      case 'tool_call_start': {
        this.debug(`Ferramenta: ${event.toolName}`);
        const tc: ToolCallDisplay = {
          id: event.toolCallId,
          name: event.toolName,
          input: event.input,
          status: 'running',
          startedAt: Date.now(),
        };
        store.addToolCall(tc);
        // Track for structured block construction
        this.currentIterationToolCalls.push({
          id: event.toolCallId,
          name: event.toolName,
          input: event.input,
        });
        break;
      }

      case 'tool_call_pending': {
        const pending = event.pending;
        const existing = useAgentStore.getState().pendingToolCalls.some((call) => call.id === pending.id);
        if (!existing) {
          store.addToolCall({
            id: pending.id,
            name: pending.toolName,
            input: pending.input,
            status: 'pending',
            startedAt: Date.now(),
          });
          this.currentIterationToolCalls.push({ id: pending.id, name: pending.toolName, input: pending.input });
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
        // Find tool call by the harness-assigned ID (stable correlation)
        store.updateToolCall(event.toolCallId, {
          status: event.result.success ? 'success' : 'error',
          output: event.result.output,
          error: event.result.error,
          completedAt: Date.now(),
        });

        // Accumulate for structured tool_result blocks
        this.pendingToolResults.push({
          toolCallId: event.toolCallId,
          output: event.result.success
            ? event.result.output
            : `Error: ${event.result.error ?? event.result.output}`,
          isError: !event.result.success,
        });

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
        if (event.reason === 'error' && event.error) {
          this.debug(`ERRO na iteração: ${event.error}`);
        } else {
          this.debug(`Turno encerrado: ${event.reason}`);
        }
        // Authoritative reconciliation: the harness's final tokenUsage is the
        // source of truth. Overwrite any per-iteration accumulation in the
        // store so the UI shows the exact turn total.
        if (event.tokenUsage) {
          useAgentStore.getState().setTokenUsage(event.tokenUsage);
        }
        // Flush streaming text FIRST so it commits to the last assistant message
        // before finalizeIterationBlocks() inserts a user tool_result message.
        // If flushed after, the last message would be 'user' and flushStreamingText
        // would create a duplicate assistant message with the same content.
        useAgentStore.getState().flushStreamingText();
        this.finalizeIterationBlocks();
        // Refresh cumulative session usage from the DB (fire-and-forget; the
        // turn record is persisted right after this event in runTurn).
        void this.refreshSessionUsage();
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
        const c = event.change;
        const snapshot = this.mutationSnapshots.get(c.filePath);
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
        const initialPhase = settings.approvalMode === 'yolo' ? 'streaming' : 'streaming';
        const session: AgentEditSession = {
          id: crypto.randomUUID(),
          filePath: c.filePath,
          toolName: c.toolName,
          toolCallId: c.toolCallId,
          originalContent: c.originalContent,
          diskOriginalContent: snapshot?.diskBefore,
          wasDirty: snapshot?.wasDirty,
          newContent: c.newContent,
          phase: initialPhase,
          isNewFile,
          hunks,
          createdAt: Date.now(),
        };
        store.upsertEditSession(session);

        // Transition to pending_review (in the first cut, the "streaming" phase
        // is instantaneous since we get the full payload at once)
        // Use a microtask so the UI renders the streaming state briefly
        queueMicrotask(() => {
          const s = useAgentStore.getState();
          const live = s.agentEditSessions.find(
            (es) => es.filePath === c.filePath && es.phase === 'streaming',
          );
          if (live) {
            if (settings.approvalMode === 'yolo' || settings.approvalMode === 'notify') {
              // Auto-accept: go straight to accepted
              s.resolveEditSession(live.id, true);
            } else {
              // manual / smart / session-trust / custom → pending_review
              useAgentStore.setState((draft) => {
                const target = draft.agentEditSessions.find((es) => es.id === live.id);
                if (target) target.phase = 'pending_review';
              });
            }
          }
        });

        break;
      }

      case 'mode_switch_request': {
        // Handled by onModeSwitchRequest callback (which pauses the loop).
        // The callback already sets pendingModeSwitch in the store.
        break;
      }

      case 'mode_switch_resolved': {
        // Handled by resolveModeSwitch() which is called from the UI.
        // The harness emits this after the callback resolves — just log it.
        const req = event.request;
        if (event.approved) {
          this.debug(`Delegação resolvida: aprovada → ${req.toMode}`);
        } else {
          this.debug(`Delegação resolvida: rejeitada (${req.fromMode} → ${req.toMode})`);
        }
        break;
      }

      case 'context_gathered': {
        this.debug(`📎 Gathered: ${event.filePath} (relevance: ${event.relevance.toFixed(2)}, ~${event.tokenEstimate} tokens)`);
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
        if (count > 0) {
          this.debug(`🧠 Extracted ${count} memory/memories`);
          // Reload from DB so sidebar reflects new memories
          useMemoryStore.getState().loadMemories().catch(() => {});
        }
        break;
      }

      case 'memory_created': {
        const mem = (event as { memory?: { title?: string } }).memory;
        this.debug(`🧠 Memory created: ${mem?.title ?? '(unknown)'}`);
        useMemoryStore.getState().loadMemories().catch(() => {});
        break;
      }
    }
  }

  private async handleApprovalRequest(pending: {
    id: string;
    toolName: string;
    input: Record<string, unknown>;
    description: string;
  }, signal: AbortSignal): Promise<boolean> {
    const settings = useSettingsStore.getState();
    const mode = settings.approvalMode;

    // Yolo: auto-approve everything silently
    if (mode === 'yolo') return true;

    // Notify: auto-approve but emit a notification event for the UI
    if (mode === 'notify') {
      this.debug(`🔔 Notify (auto-approved): ${pending.toolName}`);
      return true;
    }

    // Smart: auto-approve safe tools, ask for moderate/destructive
    if (mode === 'smart') {
      const safeTools = new Set(['read_file', 'list_directory', 'search_files', 'search_text', 'get_file_info', 'list_code_symbols', 'get_diagnostics', 'grep_search']);
      if (safeTools.has(pending.toolName)) {
        this.debug(`✅ Smart auto-approved (safe): ${pending.toolName}`);
        return true;
      }
      // Fall through to show approval dialog for non-safe tools
    }

    // Session-trust: auto-approve if tool was previously trusted
    if (mode === 'session-trust') {
      const trustedTools = this.harness.getToolRouter()?.getSessionTrustedTools?.() as Set<string> | undefined;
      if (trustedTools?.has(pending.toolName)) {
        this.debug(`✅ Session-trust auto-approved: ${pending.toolName}`);
        return true;
      }
      // Fall through to show approval dialog
    }

    // Push to store for UI rendering (manual, smart-non-safe, session-trust-untrusted, custom)
    const approval: PendingApproval = {
      id: pending.id,
      toolName: pending.toolName,
      input: pending.input,
      description: pending.description,
    };
    useAgentStore.getState().addPendingApproval(approval);

    // Wait for UI resolution
    return new Promise<boolean>((resolve) => {
      this.approvalResolvers.set(pending.id, resolve);
      const cancel = () => {
        if (!this.approvalResolvers.delete(pending.id)) return;
        useAgentStore.getState().removePendingApproval(pending.id);
        resolve(false);
      };
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
    });
  }

  /**
   * Handle a mode switch request from the harness.
   * Pauses the agent loop until the user approves/denies via the ModeSwitchDialog.
   */
  private async handleModeSwitchRequest(request: {
    id: string;
    fromMode: string;
    toMode: string;
    reason: string;
    contextSummary: string;
  }, signal: AbortSignal): Promise<boolean> {
    this.debug(`Delegação solicitada: ${request.fromMode} → ${request.toMode} (${request.reason})`);

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
    this.debug(`Agent is asking ${questions.length} question(s): ${title ?? '(no title)'}`);

    // Push to store so AgentQuestionCard renders
    const store = useAgentStore.getState();
    store.setPendingUserQuestion({ id, title, questions });

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
  resolveUserQuestion(id: string, answers: import('@hyscode/agent-harness').AgentQuestionAnswer[]): void {
    const resolver = this.userQuestionResolvers.get(id);
    if (resolver) {
      this.userQuestionResolvers.delete(id);
      useAgentStore.getState().setPendingUserQuestion(null);
      resolver(answers);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Build thinking config for the active provider+model from settings.
   */
  private buildThinkingConfig(providerId: string | null, modelId: string | null): import('@hyscode/ai-providers').ThinkingConfig | undefined {
    if (!providerId || !modelId) return undefined;
    const settings = useSettingsStore.getState();
    const key = `${providerId}::${modelId}`;
    const cfg = settings.thinkingSettings[key];
    if (!cfg || !cfg.enabled) return undefined;
    return {
      enabled: true,
      level: cfg.level as 'low' | 'medium' | 'high' | undefined,
      budgetTokens: cfg.budgetTokens,
      display: cfg.display,
    };
  }

  /**
   * Finalize the current iteration's structured blocks.
   * Stamps the last assistant message with proper content blocks (text + tool_calls)
   * and inserts a tool_result message if tools were executed.
   */
  private finalizeIterationBlocks(): void {
    if (this.currentIterationToolCalls.length === 0 && this.pendingToolResults.length === 0) {
      return;
    }

    const store = useAgentStore.getState();

    // 1. Build structured blocks for the last assistant message
    if (this.currentIterationToolCalls.length > 0) {
      const messages = store.messages;
      // Walk backwards to find the assistant message that owns these tool calls
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant') {
          const blocks: MessageContent[] = [];
          // Preserve thinking block so Kimi/MiMo models get reasoning_content round-tripped
          if (msg.thinking) {
            blocks.push({ type: 'thinking', thinking: msg.thinking });
          }
          if (msg.content) {
            blocks.push({ type: 'text', text: msg.content });
          }
          for (const tc of this.currentIterationToolCalls) {
            blocks.push({ type: 'tool_call', id: tc.id, name: tc.name, input: tc.input });
          }
          useAgentStore.setState((draft) => {
            const target = draft.messages[i];
            if (target) target.blocks = blocks;
          });
          break;
        }
      }
    }

    // 2. Insert a tool_result message with structured blocks
    if (this.pendingToolResults.length > 0) {
      const resultBlocks: MessageContent[] = this.pendingToolResults.map((r) => ({
        type: 'tool_result' as const,
        toolCallId: r.toolCallId,
        output: r.output,
        isError: r.isError,
      }));
      store.addMessage({
        id: crypto.randomUUID(),
        role: 'tool',
        content: '', // UI won't render this; blocks carry the real data
        blocks: resultBlocks,
        timestamp: Date.now(),
      });
    }

    // Reset iteration tracking
    this.currentIterationToolCalls = [];
    this.pendingToolResults = [];
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
        const hasToolResult = msg.blocks.some(b => b.type === 'tool_result');
        const role = hasToolResult ? 'tool' : (msg.role as 'user' | 'assistant' | 'tool');
        const blocks = [...msg.blocks];
        // Re-inject thinking block if it was stored separately but missing from blocks
        // (Kimi/MiMo require reasoning_content on every assistant message with tool_calls)
        if (msg.role === 'assistant' && msg.thinking && !blocks.some(b => b.type === 'thinking')) {
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

  /**
   * Build and inject a deterministic environment context package.
   * Gives the agent awareness of: active file, selection, directory tree,
   * git state, and last terminal command — reducing discovery errors.
   */
  private async injectEnvironmentContext(): Promise<void> {
    const env: EnvironmentContext = {
      workspacePath: this.harness.getWorkspacePath() as string,
    };

    // Active file from editor + file store
    try {
      const editorState = useEditorStore.getState();
      const activeTab = editorState.tabs.find((t) => t.id === editorState.activeTabId);
      if (activeTab?.filePath) {
        const activePath = activeTab.filePath;
        const fileStore = useFileStore.getState();
        const content = fileStore.getFileContent(activePath);
        if (content) {
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
      const branch = await tauriInvokeRaw<string>('git_current_branch', {
        repoPath: env.workspacePath,
      });
      const status = await tauriInvokeRaw<{
        staged: Array<{ path: string; status: string }>;
        unstaged: Array<{ path: string; status: string }>;
        untracked: Array<{ path: string }>;
      }>('git_status', { repoPath: env.workspacePath });

      const total = status.staged.length + status.unstaged.length + status.untracked.length;
      const summaryParts: string[] = [];
      if (status.staged.length > 0)
        summaryParts.push(`${status.staged.length} staged`);
      if (status.unstaged.length > 0)
        summaryParts.push(`${status.unstaged.length} modified`);
      if (status.untracked.length > 0)
        summaryParts.push(`${status.untracked.length} untracked`);

      env.gitState = {
        branch,
        uncommittedFiles: total,
        summary: total > 0 ? summaryParts.join(', ') : 'Working tree clean',
      };
    } catch {
      // Git not available — skip
    }

    // Last terminal command executed by the agent (if any)
    if (this._lastTerminalCommand) {
      env.lastTerminalCommand = {
        command: this._lastTerminalCommand.command,
        output: this._lastTerminalCommand.output,
        exitCode: this._lastTerminalCommand.exitCode,
      };
    }

    this.harness.injectEnvironmentContext(env);
  }

  /**
   * Analyze user message for file references and keywords, then suggest
   * files the agent should consider gathering.
   */
  private async injectContextHints(userMessage: string): Promise<void> {
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
          const stat = await tauriInvokeRaw<{ is_file: boolean }>(
            'stat_path',
            { path: `${workspacePath}/${candidate}` },
          );
          if (stat.is_file) {
            hints.push(candidate);
          }
        } catch {
          // Not a valid file path — skip
        }
      }

      // Extract keywords that suggest relevant files
      // e.g., "fix the login page" → look for files with "login" in name
      const keywords = userMessage
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3)
        .filter(w => !['that', 'this', 'with', 'from', 'have', 'been', 'will', 'should', 'could', 'would', 'make', 'want', 'need', 'like', 'help', 'please', 'create', 'change', 'update', 'modify', 'edit', 'file', 'code'].includes(w));

      // Search for files matching keywords (limited to avoid overhead)
      for (const keyword of keywords.slice(0, 3)) {
        try {
          const results = await tauriInvokeRaw<string[]>(
            'find_files',
            { basePath: workspacePath, pattern: `**/*${keyword}*`, maxResults: 5 },
          );
          for (const r of results) {
            const rel = r.replace(workspacePath, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
            if (!hints.includes(rel)) hints.push(rel);
          }
        } catch {
          // find_files may not exist yet or fail — skip
        }
      }

      if (hints.length > 0) {
        // Add context hints as a low-priority source so the agent knows about them
        this.harness.addContextSource({
          id: '__context_hints__',
          type: 'search_results',
          priority: 'low',
          content: `<context_hints>
The following files may be relevant to the user's request. Consider using gather_context on the important ones:
${hints.map(h => `- ${h}`).join('\n')}
</context_hints>`,
          tokenEstimate: Math.ceil(hints.join('\n').length / 4) + 50,
        });
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
      const rows = await tauriInvokeRaw<Array<{
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
      }>>('db_list_mode_policies', {});

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
  private async persistTurnRecord(record: TurnRecord): Promise<void> {
    const store = useAgentStore.getState();
    const conversationId = store.conversationId;
    if (!conversationId) return;

    try {
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
        stopReason: record.stopReason,
        verificationPerformed: record.verificationPerformed,
        verificationForced: record.verificationForced,
        filesModified: JSON.stringify(record.filesModified),
        durationMs: record.durationMs,
        timestamp: record.timestamp,
      });

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
            stopReason: record.trace.stopReason,
            verificationPerformed: record.trace.verificationPerformed,
            verificationForced: record.trace.verificationForced,
            filesModified: JSON.stringify(record.trace.filesModified),
            errors: JSON.stringify(record.trace.errors),
            loopWarnings: JSON.stringify(record.trace.loopWarnings),
            durationMs: record.trace.durationMs,
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
    const conversationId = useAgentStore.getState().conversationId;
    if (!conversationId) return;
    try {
      const usage = await tauriInvokeRaw<TokenUsage | null>(
        'db_get_conversation_token_usage',
        { conversationId },
      );
      if (usage) {
        useAgentStore.getState().setSessionTokenUsage(usage);
      }
    } catch (e) {
      console.warn('[HarnessBridge] Failed to refresh session usage', e);
    }
  }

  /** Persist the current conversation turn to the database */
  private async persistConversation(userMessage: string, _assistantResponse: string): Promise<void> {
    const store = useAgentStore.getState();
    const settings = useSettingsStore.getState();
    const conversationId = store.conversationId;
    if (!conversationId) return;

    try {
      const title = userMessage.slice(0, 80) + (userMessage.length > 80 ? '…' : '');

      const projectId = this.harness['projectId'] as string;

      // Ensure the project row exists before inserting the conversation (FK requirement)
      await tauriInvokeRaw('db_ensure_project', { id: projectId, path: projectId });

      // Try to create the conversation; if it already exists (duplicate PK), update it
      try {
        await tauriInvokeRaw('db_create_conversation', {
          id: conversationId,
          projectId,
          title,
          mode: store.mode,
          modelId: settings.activeModelId ?? null,
          providerId: settings.activeProviderId ?? null,
        });
      } catch {
        // Conversation already exists — update title and timestamp
        await tauriInvokeRaw('db_update_conversation', {
          conversationId,
          title,
        });
      }

      // Persist individual messages (all messages from this turn, not just last 2)
      // We track which messages have been persisted via their ID; db_create_message
      // silently ignores duplicate IDs.
      for (const msg of store.messages) {
        try {
          await tauriInvokeRaw('db_create_message', {
            id: msg.id,
            conversationId,
            role: msg.role,
            content: msg.content,
            toolCalls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
            blocks: msg.blocks ? JSON.stringify(msg.blocks) : null,
            tokenInput: 0,
            tokenOutput: 0,
          });
        } catch {
          // Message may already exist (duplicate insert) — ignore
        }
      }
    } catch (err) {
      // DB persistence is best-effort; don't break the chat flow
      console.warn('[HarnessBridge] Failed to persist conversation:', err);
    }
  }

  private async ensureConversationExists(titleSource: string): Promise<void> {
    const store = useAgentStore.getState();
    const conversationId = store.conversationId;
    if (!conversationId) throw new Error('Cannot start SDD without a conversation ID.');
    await tauriInvokeRaw('db_ensure_project', { id: this._projectId, path: this._projectId });
    try {
      await tauriInvokeRaw('db_create_conversation', {
        id: conversationId,
        projectId: this._projectId,
        title: titleSource.slice(0, 80) || 'SDD Session',
        mode: store.mode,
        modelId: useSettingsStore.getState().activeModelId ?? null,
        providerId: useSettingsStore.getState().activeProviderId ?? null,
      });
    } catch {
      // Existing conversation is the expected path after the first SDD action.
    }
  }

  private async invokeForHarness<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const path = typeof args?.path === 'string' ? args.path : null;
    if (command === 'read_file' && path) {
      const tab = useEditorStore.getState().tabs.find((item) => item.filePath === path && item.type === 'file');
      const buffered = useFileStore.getState().getFileContent(path);
      if (tab?.isDirty && buffered !== undefined) return buffered as T;
    }

    const mutationPaths: string[] = [];
    if (path && ['write_file', 'create_file', 'delete_path'].includes(command)) mutationPaths.push(path);
    if (['rename_path', 'copy_path'].includes(command)) {
      if (typeof args?.from === 'string') mutationPaths.push(args.from);
      if (typeof args?.to === 'string') mutationPaths.push(args.to);
    }
    for (const mutationPath of mutationPaths) await this.captureMutationSnapshot(mutationPath);
    return tauriInvokeRaw<T>(command, args);
  }

  private async captureMutationSnapshot(path: string): Promise<void> {
    if (this.mutationSnapshots.has(path)) return;
    let diskBefore: string | null = null;
    try {
      diskBefore = await tauriInvokeRaw<string>('read_file', { path });
    } catch {
      // New file or directory.
    }
    const tab = useEditorStore.getState().tabs.find((item) => item.filePath === path && item.type === 'file');
    const bufferBefore = useFileStore.getState().getFileContent(path) ?? diskBefore;
    this.mutationSnapshots.set(path, {
      diskBefore,
      bufferBefore,
      wasDirty: tab?.isDirty ?? false,
      tabId: tab?.id ?? null,
    });
  }

  private async restoreMutationSnapshot(
    path: string,
    session?: Pick<AgentEditSession, 'diskOriginalContent' | 'originalContent' | 'wasDirty'>,
  ): Promise<void> {
    const captured = this.mutationSnapshots.get(path);
    const diskBefore = captured?.diskBefore ?? session?.diskOriginalContent ?? session?.originalContent ?? null;
    const bufferBefore = captured?.bufferBefore ?? session?.originalContent ?? diskBefore;
    try {
      if (diskBefore === null) await tauriFs.deletePath(path);
      else await tauriFs.writeFile(path, diskBefore);
    } catch (error) {
      console.warn('[HarnessBridge] Failed to restore disk snapshot:', error);
    }
    if (bufferBefore !== null) {
      useFileStore.getState().setFileContent(path, bufferBefore);
      useAgentStore.setState((draft) => {
        const edit = draft.agentEditSessions.find((item) =>
          item.filePath === path && (item.phase === 'streaming' || item.phase === 'pending_review'),
        );
        if (edit) edit.newContent = bufferBefore;
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const tabId = captured?.tabId ?? useEditorStore.getState().tabs.find((tab) => tab.filePath === path)?.id;
    if (tabId) useEditorStore.getState().markDirty(tabId, captured?.wasDirty ?? session?.wasDirty ?? false);
    this.mutationSnapshots.delete(path);
  }

  private acceptMutationSnapshot(path: string): void {
    const captured = this.mutationSnapshots.get(path);
    const tabId = captured?.tabId ?? useEditorStore.getState().tabs.find((tab) => tab.filePath === path)?.id;
    if (tabId) useEditorStore.getState().markDirty(tabId, false);
    this.mutationSnapshots.delete(path);
  }

  // ─── Agent Terminal Integration ──────────────────────────────────────

  /**
   * Ensure at least one healthy agent terminal session exists.
   * Reuses an existing healthy session when possible; otherwise creates a fresh one.
   * Updates the Harness with the active PTY id.
   */
  private async ensureAgentTerminal(): Promise<void> {
    try {
      const termStore = useTerminalStore.getState();
      const workspacePath = this.harness.getWorkspacePath() as string;
      const convId = useAgentStore.getState().conversationId ?? '_global';

      // Get (or create) the terminal pool for the current tab's conversation
      const pool = this._agentTerminalSessionIds.get(convId) ?? [];
      if (!this._agentTerminalSessionIds.has(convId)) {
        this._agentTerminalSessionIds.set(convId, pool);
      }

      // Reuse a healthy session if we already have one in the pool
      let sessionId = pool.find((id) => {
        const s = termStore.sessions.find((sess) => sess.id === id);
        return s && !s.isDead && s.ptyId;
      });

      // Also look for any other healthy agent session in the store
      if (!sessionId) {
        const healthy = termStore.findHealthyAgentSession();
        if (healthy) {
          sessionId = healthy.id;
          if (!pool.includes(sessionId)) {
            pool.push(sessionId);
          }
        }
      }

      // Nothing healthy — create a fresh agent session
      if (!sessionId) {
        sessionId = termStore.ensureAgentSession({ reuseHealthy: false });
        pool.push(sessionId);
      }

      // Get the session to read its PTY id
      let session = termStore.sessions.find((s) => s.id === sessionId);

      // If no PTY has been spawned yet (component hasn't mounted), spawn one directly
      if (!session?.ptyId) {
        const ptyId = await tauriInvokeRaw<string>('pty_spawn', {
          shell: null,
          cwd: workspacePath,
          env: null,
        });
        useTerminalStore.getState().setPtyId(sessionId, ptyId);
        session = useTerminalStore.getState().sessions.find((s) => s.id === sessionId);
      }

      if (session?.ptyId) {
        this.harness.setAgentTerminalPtyId(session.ptyId);
      }

      // Wire the command callback so we can track agent terminal commands
      this.harness.setOnTerminalCommand((command: string, output: string, exitCode: number | null) => {
        this._lastTerminalCommand = { command, output, exitCode };

        // Update history on every healthy agent session in the current tab's pool
        const ts = useTerminalStore.getState();
        const activeConv = useAgentStore.getState().conversationId ?? '_global';
        const activePool = this._agentTerminalSessionIds.get(activeConv) ?? [];
        for (const sid of activePool) {
          const s = ts.sessions.find((sess) => sess.id === sid);
          if (s && !s.isDead) {
            ts.setLastCommand(sid, command, output.slice(0, 2000), exitCode);
            ts.appendCommandHistory(sid, {
              command,
              output: output.slice(0, 2000),
              exitCode,
              timestamp: Date.now(),
              source: 'agent',
            });
          }
        }
      });
    } catch (err) {
      // Agent terminal is best-effort — fall back to hidden PTY behavior
      console.warn('[HarnessBridge] Failed to ensure agent terminal:', err);
    }
  }

  /**
   * Health-check the current shared agent PTY. If it died, spawn a new one
   * and wire it into the Harness so the next tool call uses a live session.
   */
  async refreshAgentTerminal(): Promise<void> {
    try {
      const termStore = useTerminalStore.getState();

      // Find the currently-wired PTY id
      const currentPtyId = this.harness.getAgentTerminalPtyId?.();

      // If we have a PTY, verify it still exists in the Rust backend
      if (currentPtyId) {
        const alive = await tauriInvokeRaw<boolean>('pty_exists', { ptyId: currentPtyId }).catch(() => false);
        if (alive) return; // still good

        // PTY is dead — mark it in the store
        const deadSession = termStore.sessions.find((s) => s.ptyId === currentPtyId);
        if (deadSession) {
          termStore.markPtyDead(deadSession.id);
          for (const [convId, ids] of this._agentTerminalSessionIds.entries()) {
            const filtered = ids.filter((id) => id !== deadSession.id);
            if (filtered.length !== ids.length) {
              this._agentTerminalSessionIds.set(convId, filtered);
            }
          }
        }
      }

      // No live PTY — ensure a fresh one
      await this.ensureAgentTerminal();
    } catch (err) {
      console.warn('[HarnessBridge] Failed to refresh agent terminal:', err);
    }
  }
}

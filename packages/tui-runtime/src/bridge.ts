import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  Harness,
  invalidateTerminalInput,
  MemoryManager,
  RuleLoader,
  SkillLoader,
  getAgentTypes,
  type AgentQuestionAnswer,
  type AgentType,
  type ContextSource,
  type HarnessEvent,
  type RecoverableTurnError,
  type SddDatabase,
  type SddSession,
  type SddTask,
  type Skill,
  type TerminalAccess,
  type TerminalAcquireRequest,
  type TerminalBinding,
  type TerminalRole,
  type TerminalRuntimeAdapter,
  type TerminalSnapshot,
  type ToolHandler,
  type ToolResult,
  type ApprovalDecision,
  type ToolApprovalRequest,
  type Trace,
} from '@hyscode/agent-harness';
import {
  getProviderRegistry,
  type CodexInvoke,
  type Message,
  type StreamChunk,
  type ThinkingConfig,
  type TokenUsage,
} from '@hyscode/ai-providers';
import type { ThemeSummary } from '@hyscode/theme';
import { McpClientManager } from '@hyscode/mcp-client';
import { BUILTIN_SKILLS } from '@hyscode/skills';
import { CliDataStore, makeSessionMessage } from './data-store';
import {
  SharedConfigStore,
  SharedKeyStore,
  buildApprovalConfig,
  buildThinkingConfig,
  type SharedTuiSettings,
} from './config';
import { CliHost } from './host';
import { findTheme, loadThemeCatalog, normalizeThemeId } from './themes';
import {
  pendingToolToInteraction,
  type BridgeEvent,
  type BridgeRequest,
  type BridgeResponse,
  type ContextAttachment,
  type ContextStatePayload,
  type DiagnosticPayload,
  type FileChangeState,
  type GitSummary,
  type InteractionRequest,
  type InteractionResolution,
  type ProjectSummary,
  type RuntimeReadyPayload,
  type SddStatePayload,
  type SendMessageParams,
  type SessionRecord,
  type SetConfigParams,
  type TerminalSummary,
  type TerminalUpdatedPayload,
} from './protocol';

type PendingInteraction = {
  kind: InteractionRequest['kind'];
  resolve: (resolution: InteractionResolution) => void;
};

type PendingHostRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type CliTerminalEntry = {
  binding: TerminalBinding;
  role: TerminalRole;
  isolationKey: string;
  ownerConversationId: string;
  ownerId?: string;
  cwd: string;
  sessionName?: string;
  activeToolCallId: string | null;
  awaitingInput: boolean;
  alive: boolean;
  exitCode: number | null;
  sequence: number;
  outputPreview: string;
  truncated: boolean;
  observerUnsubscribe: (() => void) | null;
};

type TerminalUpdateCause = TerminalUpdatedPayload['cause'];
type TerminalDataEvent = { pty_id?: string; data?: string; sequence?: number };
type TerminalExitEvent = { pty_id?: string; code?: number | null; sequence?: number };

const MAX_TERMINAL_PREVIEW = 4_000;

type BridgeOutput = (message: BridgeResponse | BridgeEvent) => void;

const MAX_CONTEXT_ATTACHMENT_BYTES = 2_000_000;
const MAX_IMAGE_ATTACHMENT_BYTES = 20_000_000;
const MAX_DIRECTORY_CONTEXT_FILES = 80;
const MAX_TERMINAL_CONTEXT_BYTES = 120_000;
const EMPTY_GIT_SUMMARY: GitSummary = { available: false, branch: '', insertions: 0, deletions: 0, changedFiles: 0 };

export class TuiBridge {
  private readonly dataStore: CliDataStore;
  private configStore: SharedConfigStore;
  private readonly keyStore: SharedKeyStore;
  private host: CliHost | null = null;
  private gitSummary: GitSummary = EMPTY_GIT_SUMMARY;
  private harness: Harness | null = null;
  private settings: SharedTuiSettings | null = null;
  private themes: ThemeSummary[] = [];
  private mcp: McpClientManager | null = null;
  private session: SessionRecord | null = null;
  private workspacePath = '';
  private projectId = '';
  private activeRun: Promise<unknown> | null = null;
  private activeTurnId: string | null = null;
  private activeTurnMessages: Message[] = [];
  private lastRecovery: RecoverableTurnError | null = null;
  private terminalRuntime: CliTerminalRuntime | null = null;
  private subAgentsInFlight = 0;
  private readonly subAgentWaiters: Array<() => void> = [];
  private readonly interactions = new Map<string, PendingInteraction>();
  private readonly hostRequests = new Map<string, PendingHostRequest>();
  private readonly attachments = new Map<string, ContextAttachment>();
  private readonly pendingFileChanges = new Map<string, FileChangeState>();
  private readonly childAgents = new Map<string, Harness>();
  private output: BridgeOutput | null = null;

  constructor(output?: BridgeOutput) {
    this.output = output ?? null;
    this.dataStore = new CliDataStore();
    this.configStore = new SharedConfigStore();
    this.keyStore = new SharedKeyStore();
  }

  setOutput(output: BridgeOutput): void {
    this.output = output;
  }

  async handle(request: BridgeRequest): Promise<BridgeResponse> {
    try {
      switch (request.method) {
        case 'initialize':
          return this.ok(request.id, await this.initialize(request.params ?? {}));
        case 'git_summary':
          return this.ok(request.id, await this.refreshGitSummary());
        case 'send_message':
          return this.ok(request.id, await this.sendMessage(request.params ?? {}));
        case 'retry_turn':
          return this.ok(request.id, await this.retryTurn());
        case 'continue_partial_turn':
          return this.ok(request.id, await this.continuePartialTurn());
        case 'cancel':
          this.cancel();
          return this.ok(request.id, { cancelled: true });
        case 'set_mode':
          return this.ok(request.id, await this.setMode(request.params ?? {}));
        case 'set_config':
          return this.ok(request.id, await this.setConfig(request.params ?? {}));
        case 'resolve_interaction':
          return this.ok(request.id, this.resolveInteraction(request.params ?? {}));
        case 'session_list':
          return this.ok(request.id, this.listSessions());
        case 'session_load':
          return this.ok(request.id, this.loadSession(String(request.params?.id ?? '')));
        case 'session_new':
          return this.ok(request.id, await this.newSession());
        case 'project_list':
          return this.ok(request.id, this.listProjects());
        case 'project_switch':
          return this.ok(request.id, await this.switchProject(String(request.params?.workspacePath ?? '')));
        case 'diagnostics':
          return this.ok(request.id, await this.diagnostics(request.params ?? {}));
        case 'context_attach':
          return this.ok(request.id, await this.attachContext(request.params ?? {}));
        case 'context_remove':
          return this.ok(request.id, this.removeContext(String(request.params?.id ?? '')));
        case 'context_clear':
          return this.ok(request.id, this.clearContext());
        case 'context_list':
          return this.ok(request.id, this.contextState());
        case 'rules_list':
          return this.ok(request.id, this.listRules());
        case 'skills_list':
          return this.ok(request.id, this.listSkills());
        case 'memory_list':
          return this.ok(request.id, await this.listMemories());
        case 'terminal_list':
          return this.ok(request.id, await this.listTerminals());
        case 'terminal_open':
          return this.ok(request.id, await this.openTerminal(request.params ?? {}));
        case 'terminal_snapshot':
          return this.ok(request.id, await this.terminalSnapshot(request.params ?? {}));
        case 'terminal_write':
          return this.ok(request.id, await this.terminalWrite(request.params ?? {}));
        case 'terminal_resize':
          return this.ok(request.id, await this.terminalResize(request.params ?? {}));
        case 'terminal_interrupt':
          return this.ok(request.id, await this.terminalInterrupt(request.params ?? {}));
        case 'terminal_kill':
          return this.ok(request.id, await this.terminalKill(request.params ?? {}));
        case 'file_change_resolve':
          return this.ok(request.id, await this.resolveFileChange(request.params ?? {}));
        case 'file_change_resolve_all':
          return this.ok(request.id, await this.resolveAllFileChanges(request.params ?? {}));
        case 'sdd_start':
          return this.ok(request.id, await this.startSdd(String(request.params?.description ?? '')));
        case 'sdd_action':
          return this.ok(request.id, await this.sddAction(request.params ?? {}));
        case 'subagent_cancel':
          return this.ok(request.id, this.cancelSubAgent(String(request.params?.ownerId ?? '')));
        case 'session_delete':
          return this.ok(request.id, await this.deleteSession(String(request.params?.id ?? '')));
        case 'session_rename':
          return this.ok(request.id, await this.renameSession(String(request.params?.id ?? ''), String(request.params?.title ?? '')));
        case 'session_export':
          return this.ok(request.id, await this.exportSession(String(request.params?.id ?? this.session?.id ?? '')));
        case 'trace_list':
          return this.ok(request.id, await this.listTraces());
        case 'host_response':
          return this.ok(request.id, this.resolveHostResponse(request.params ?? {}));
        case 'host_event':
          return this.ok(request.id, this.forwardHostEvent(request.params ?? {}));
        case 'shutdown':
          await this.shutdown();
          return this.ok(request.id, { shutdown: true });
      }
    } catch (error) {
      return this.fail(request.id, error instanceof Error ? error.message : String(error));
    }
  }

  private async initialize(rawParams: Record<string, unknown>): Promise<RuntimeReadyPayload> {
    const workspacePath = path.resolve(String(rawParams.workspacePath ?? process.cwd()));
    const configPath = typeof rawParams.configPath === 'string' ? rawParams.configPath : undefined;
    this.workspacePath = workspacePath;
    this.projectId = String(rawParams.projectId ?? workspacePath);
    this.gitSummary = EMPTY_GIT_SUMMARY;
    if (configPath) {
      this.configStore = new SharedConfigStore(configPath);
    }
    await this.dataStore.load();
    await this.keyStore.load();
    this.settings = await this.configStore.load();
    this.themes = await loadThemeCatalog();
    const persistedThemeId = this.settings.themeId;
    this.settings.themeId = normalizeThemeId(this.themes, rawParams.themeId ?? persistedThemeId);
    if (this.settings.themeId !== persistedThemeId) await this.configStore.save({ themeId: this.settings.themeId });
    const activeProviderId = typeof rawParams.providerId === 'string'
      ? rawParams.providerId
      : this.settings.activeProviderId ?? '';
    const activeModelId = typeof rawParams.modelId === 'string'
      ? rawParams.modelId
      : this.settings.activeModelId ?? '';
    const activeAgentType = normalizeAgentType(rawParams.agentType ?? this.settings.agentType);
    const activeApprovalMode = normalizeApprovalMode(rawParams.approvalMode ?? this.settings.approvalMode);
    this.settings.activeProviderId = activeProviderId || null;
    this.settings.activeModelId = activeModelId || null;
    this.settings.agentType = activeAgentType;
    this.settings.approvalMode = activeApprovalMode;

    const registry = getProviderRegistry();
    const codexInvoke = this.createCodexInvoke();
    await registry.initialize(this.keyStore, undefined, globalThis.fetch.bind(globalThis), codexInvoke, await this.codexAuthDetected());
    registry.setRetryConfig({
      maxRetries: this.settings.agentMaxRetries,
      baseDelayMs: this.settings.agentRetryBaseDelayMs,
      maxDelayMs: this.settings.agentRetryMaxDelayMs,
    });

    // The standalone TUI runs inside the same TypeScript process as the
    // runtime. CliHost owns the native PTY lifecycle directly, so the
    // production path does not need the former Rust host-request round trip.
    // The host_response/host_event protocol remains available for older
    // integrations and tests that provide an explicit remote host adapter.
    this.host = new CliHost(workspacePath, this.dataStore, this.keyStore);
    await this.refreshGitSummary();
    this.attachments.clear();
    this.pendingFileChanges.clear();
    const skillLoader = this.createSkillLoader();
    const ruleLoader = this.createRuleLoader();
    const terminalRuntime = new CliTerminalRuntime(
      this.host,
      this.settings.terminalShell,
      (terminal, cause) => this.emit({
        type: 'event',
        event: 'terminal_updated',
        payload: {
          terminal,
          cause,
          ...(this.activeTurnId ? { turnId: this.activeTurnId } : {}),
          ...(this.session?.id ? { conversationId: this.session.id } : {}),
        },
      }),
    );
    this.terminalRuntime = terminalRuntime;
    const sddDb = this.createSddDatabase();
    this.harness = new Harness({
      workspacePath,
      projectId: this.projectId,
      invoke: (command, args) => this.requireHost().invoke(command, args),
      listen: (event, handler) => this.requireHost().listen(event, handler),
      onEvent: (event) => this.emitHarnessEvent(event),
      onApprovalRequest: (pending, signal) => this.requestApproval(pending, signal),
      onModeSwitchRequest: (request) => this.requestModeSwitch(request),
      onUserQuestionRequest: (id, questions, title) => this.requestUserQuestions(id, questions, title),
      terminalRuntime,
      memoryManager: new MemoryManager((command, args) => this.requireHost().invoke(command, args)),
      sddDb,
      savePlanFile: async (sessionId, spec, tasks) => this.savePlanFile(sessionId, spec, tasks),
      skillLoader,
      ruleLoader,
      hasDirtyBuffers: () => false,
      onTerminalCommand: (command, output, exitCode) => {
        this.emitDiagnostic({ level: 'info', message: `Terminal command completed (${exitCode ?? 'running'}): ${command}` });
        if (output.trim()) this.emitDiagnostic({ level: 'info', message: output.slice(-2000) });
      },
      config: {
        providerId: activeProviderId,
        modelId: activeModelId,
        maxIterations: this.settings.interactionLimitEnabled ? this.settings.maxIterations : null,
        maxInputTokens: 200_000,
        maxOutputTokens: this.settings.maxTokens,
        turnTimeoutMs: this.settings.agentRequestTimeoutMs,
        approval: buildApprovalConfig(this.settings),
        thinking: normalizeStoredThinkingConfig(
          buildThinkingConfig(this.settings, activeProviderId, activeModelId) ?? { enabled: false },
          activeProviderId,
          activeModelId,
        ),
        costOptimization: true,
        promptCaching: true,
      },
    });

    this.harness.setAgentType(activeAgentType);
    this.harness.setMode(this.harness.getAgentType() === 'chat' ? 'chat' : 'agent');
    await this.harness.loadSkills();
    this.harness.setActiveSkills(this.activeSkillsFor(this.harness.getAgentType(), skillLoader));
    await this.harness.refreshRules([workspacePath]);

    this.mcp = new McpClientManager(
      (command, args) => this.requireHost().invoke(command, args),
      (event, handler) => this.requireHost().listen(event, handler),
    );
    await this.connectMcpServers();
    this.registerMcpTools();
    this.registerSubAgentTool();

    const existingSession = this.dataStore.listSessions(workspacePath)[0];
    this.session = existingSession
      ? this.dataStore.loadSession(existingSession.id)
      : await this.dataStore.createSession(workspacePath, this.harness.getAgentType(), this.currentProviderId(), this.currentModelId());
    this.harness.setConversationId(this.session?.id ?? crypto.randomUUID());
    const ready = await this.runtimeReady();
    this.emit({ type: 'event', event: 'runtime_ready', payload: ready });
    return ready;
  }

  private async sendMessage(rawParams: Record<string, unknown>): Promise<unknown> {
    const params = normalizeSendParams(rawParams);
    if (!this.harness) throw new Error('Runtime is not initialized.');
    if (this.activeRun) throw new Error('A turn is already running.');
    for (const attachment of params.contextAttachments ?? []) {
      this.attachments.set(attachment.id, { ...attachment });
      this.addAttachmentSource(attachment);
    }
    if ((params.contextAttachments?.length ?? 0) > 0) this.emitContextUpdated();
    const attachedImages = Array.from(this.attachments.values())
      .filter((attachment) => attachment.kind === 'image' && attachment.base64 && attachment.mediaType)
      .map((attachment) => ({ base64: attachment.base64!, mediaType: attachment.mediaType! }));
    const effectiveParams: SendMessageParams = {
      ...params,
      images: [...(params.images ?? []), ...attachedImages],
    };
    // The harness owns and mutates its working history while it runs. Keep it
    // isolated from the persisted session array so persistTurn can append the
    // completed turn exactly once.
    const history = [...(params.history ?? this.session?.messages ?? [])];
    this.activeTurnId = null;
    this.activeTurnMessages = [];
    const run = this.harness.run({
      userMessage: effectiveParams.message,
      history,
      images: effectiveParams.images,
      ruleTargetPaths: effectiveParams.ruleTargetPaths,
    });
    this.activeRun = run;
    try {
      const outcome = await run;
      await this.persistTurn(
        effectiveParams,
        outcome.response,
        outcome.turnRecord.tokenUsage,
        outcome.turnRecord.trace,
      );
      return outcome;
    } finally {
      this.activeRun = null;
      this.activeTurnId = null;
      this.activeTurnMessages = [];
    }
  }

  private async retryTurn(): Promise<unknown> {
    if (!this.session) throw new Error('No active session to retry.');
    const lastUser = [...this.session.messages].reverse().find((message) => message.role === 'user');
    if (!lastUser) throw new Error('There is no previous user message to retry.');
    this.lastRecovery = null;
    const message = lastUser.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
    return this.sendMessage({ message, history: this.session.messages.slice(0, -1) });
  }

  private async continuePartialTurn(): Promise<unknown> {
    const recovery = this.lastRecovery;
    if (!recovery) throw new Error('There is no recoverable partial turn.');
    this.lastRecovery = null;
    const message = `Continue the interrupted response from exactly where it stopped. Do not repeat completed content. The preserved partial response was:\n\n${recovery.partialText}`;
    return this.sendMessage({ message, history: this.session?.messages ?? [] });
  }

  private cancel(): void {
    this.harness?.cancel();
    for (const [requestId, interaction] of this.interactions) {
      interaction.resolve({ requestId, approved: false, answers: [] });
    }
    this.interactions.clear();
  }

  private async setMode(rawParams: Record<string, unknown>): Promise<RuntimeReadyPayload> {
    const harness = this.requireHarness();
    const agentType = normalizeAgentType(rawParams.agentType ?? rawParams.mode ?? harness.getAgentType());
    harness.setAgentType(agentType);
    harness.setMode(agentType === 'chat' ? 'chat' : 'agent');
    const settings = this.requireSettings();
    settings.agentType = agentType;
    await this.configStore.save(settings);
    return this.runtimeReady();
  }

  private async setConfig(rawParams: Record<string, unknown>): Promise<RuntimeReadyPayload> {
    const params = rawParams as SetConfigParams;
    const harness = this.requireHarness();
    const settings = this.requireSettings();
    if (params.themeId !== undefined) {
      if (typeof params.themeId !== 'string' || !findTheme(this.themes, params.themeId)) {
        throw new Error(`Unknown theme "${String(params.themeId)}".`);
      }
      settings.themeId = params.themeId;
    }
    if (params.sidebarVisible !== undefined) {
      if (typeof params.sidebarVisible !== 'boolean') {
        throw new Error('sidebarVisible must be a boolean.');
      }
      settings.sidebarVisible = params.sidebarVisible;
    }
    if (params.updateChannel !== undefined) {
      if (params.updateChannel !== 'stable' && params.updateChannel !== 'pre-release') {
        throw new Error('updateChannel must be stable or pre-release.');
      }
      settings.updateChannel = params.updateChannel;
    }
    if (params.checkForUpdatesOnStartup !== undefined) {
      if (typeof params.checkForUpdatesOnStartup !== 'boolean') {
        throw new Error('checkForUpdatesOnStartup must be a boolean.');
      }
      settings.checkForUpdatesOnStartup = params.checkForUpdatesOnStartup;
    }
    if (params.autoDownload !== undefined) {
      if (typeof params.autoDownload !== 'boolean') {
        throw new Error('autoDownload must be a boolean.');
      }
      settings.autoDownload = params.autoDownload;
    }
    const providerId = typeof params.providerId === 'string' ? params.providerId : this.currentProviderId();
    const modelId = typeof params.modelId === 'string' ? params.modelId : this.currentModelId();
    const approvalMode = normalizeApprovalMode(params.approvalMode ?? settings.approvalMode);
    const thinking = params.thinking
      ? validateRequestedThinkingConfig(normalizeThinkingConfig(params.thinking), providerId, modelId)
      : normalizeStoredThinkingConfig(buildThinkingConfig(settings, providerId, modelId) ?? { enabled: false }, providerId, modelId);
    harness.setConfig({
      providerId,
      modelId,
      maxIterations: normalizeIterations(params.maxIterations, settings),
      maxOutputTokens: numberOrDefault(params.maxOutputTokens, settings.maxTokens),
      turnTimeoutMs: settings.agentRequestTimeoutMs,
      approval: approvalMode === settings.approvalMode ? buildApprovalConfig(settings) : { mode: approvalMode },
      thinking,
    });
    settings.activeProviderId = providerId || null;
    settings.activeModelId = modelId || null;
    settings.approvalMode = approvalMode;
    if (typeof params.maxIterations === 'number') {
      settings.interactionLimitEnabled = true;
      settings.maxIterations = Math.max(1, Math.floor(params.maxIterations));
    } else if (params.maxIterations === null) {
      settings.interactionLimitEnabled = false;
    }
    if (typeof params.maxOutputTokens === 'number' && Number.isFinite(params.maxOutputTokens)) {
      settings.maxTokens = Math.max(1, Math.floor(params.maxOutputTokens));
    }
    if (params.thinking) settings.thinkingSettings[`${providerId}::${modelId}`] = { ...thinking };
    await this.configStore.save(settings);
    return this.runtimeReady();
  }

  private resolveInteraction(rawParams: Record<string, unknown>): { resolved: boolean } {
    const params = rawParams as InteractionResolution;
    const pending = this.interactions.get(params.requestId);
    if (!pending) return { resolved: false };
    if (pending.kind === 'approval' && params.trustTool === true && typeof rawParams.toolName === 'string') {
      this.requireHarness().getToolRouter().trustToolForSession(rawParams.toolName);
    }
    pending.resolve({ ...params, requestId: params.requestId });
    this.interactions.delete(params.requestId);
    return { resolved: true };
  }

  private listSessions() {
    return this.dataStore.listSessions(this.workspacePath);
  }

  private listProjects(): ProjectSummary[] {
    return this.dataStore.listProjects();
  }

  private async switchProject(workspacePath: string): Promise<RuntimeReadyPayload> {
    const nextWorkspacePath = path.resolve(workspacePath || this.workspacePath);
    if (nextWorkspacePath === this.workspacePath) return this.runtimeReady();
    await this.shutdown();
    return this.initialize({ workspacePath: nextWorkspacePath, projectId: nextWorkspacePath });
  }

  private async diagnostics(rawParams: Record<string, unknown>): Promise<unknown> {
    return this.requireHost().invoke('get_diagnostics', {
      ...(typeof rawParams.path === 'string' && rawParams.path ? { path: rawParams.path } : {}),
    });
  }

  private async attachContext(rawParams: Record<string, unknown>): Promise<ContextStatePayload> {
    const rawKind = rawParams.kind;
    let kind = normalizeContextKind(rawKind);
    if (rawKind === 'auto') {
      const candidatePath = this.resolveWorkspacePath(String(rawParams.path ?? ''));
      const info = await this.requireHost().invoke<Record<string, unknown>>('stat_path', { path: candidatePath });
      if (info.is_dir === true) kind = 'directory';
      else if (isImagePath(candidatePath)) kind = 'image';
      else kind = 'file';
    }
    const id = String(rawParams.id ?? `${kind}-${crypto.randomUUID()}`);
    const label = String(rawParams.label ?? rawParams.path ?? rawParams.terminalId ?? kind);
    const attachment: ContextAttachment = { id, kind, label };
    if (kind === 'image') {
      const imagePath = typeof rawParams.path === 'string' ? this.resolveWorkspacePath(rawParams.path) : '';
      const imageBuffer = imagePath ? await readFile(imagePath) : null;
      if (imageBuffer && imageBuffer.byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
        throw new Error(`Image attachment is larger than ${MAX_IMAGE_ATTACHMENT_BYTES} bytes.`);
      }
      const base64 = String(rawParams.base64 ?? (imageBuffer ? imageBuffer.toString('base64') : ''));
      const mediaType = String(rawParams.mediaType ?? 'image/png');
      if (!base64) throw new Error('Image attachment requires base64 data.');
      attachment.base64 = base64;
      attachment.mediaType = mediaType;
      if (imagePath) attachment.path = imagePath;
      attachment.tokenEstimate = Math.ceil(base64.length / 6);
    } else if (kind === 'terminal') {
      const terminalId = String(rawParams.terminalId ?? '');
      if (!terminalId) throw new Error('Terminal attachment requires terminalId.');
      const runtime = this.requireTerminalRuntime();
      runtime.authorize(terminalId, this.userTerminalAccess());
      const snapshot = await runtime.snapshot(terminalId, 0);
      const content = snapshot.data.slice(-MAX_TERMINAL_CONTEXT_BYTES);
      attachment.terminalId = terminalId;
      attachment.content = content;
      attachment.tokenEstimate = Math.ceil(content.length / 4);
    } else if (kind === 'file') {
      const filePath = this.resolveWorkspacePath(String(rawParams.path ?? ''));
      const content = await this.requireHost().invoke<string>('read_file', { path: filePath });
      if (Buffer.byteLength(content, 'utf8') > MAX_CONTEXT_ATTACHMENT_BYTES) {
        throw new Error(`Context file is larger than ${MAX_CONTEXT_ATTACHMENT_BYTES} bytes.`);
      }
      attachment.path = filePath;
      attachment.content = content;
      attachment.tokenEstimate = Math.ceil(content.length / 4);
    } else if (kind === 'directory') {
      const directoryPath = this.resolveWorkspacePath(String(rawParams.path ?? ''));
      const files = await this.requireHost().invoke<string[]>('find_files', { basePath: directoryPath, pattern: '*', maxResults: MAX_DIRECTORY_CONTEXT_FILES });
      const listing = files.map((file) => path.isAbsolute(file) ? file : path.resolve(directoryPath, file)).join('\n');
      attachment.path = directoryPath;
      attachment.content = listing;
      attachment.tokenEstimate = Math.ceil(listing.length / 4);
    } else {
      const content = String(rawParams.content ?? '');
      if (!content.trim()) throw new Error('Text attachment requires content.');
      attachment.content = content;
      attachment.tokenEstimate = Math.ceil(content.length / 4);
    }

    this.attachments.set(id, attachment);
    this.addAttachmentSource(attachment);
    this.emitContextUpdated();
    return this.contextState();
  }

  private removeContext(id: string): ContextStatePayload {
    const attachment = this.attachments.get(id);
    if (!attachment) return this.contextState();
    this.attachments.delete(id);
    this.requireHarness().removeContextSource(id);
    this.emitContextUpdated();
    return this.contextState();
  }

  private clearContext(): ContextStatePayload {
    this.requireHarness().getContextManager().clearAll();
    this.attachments.clear();
    this.emitContextUpdated();
    return this.contextState();
  }

  private contextState(): ContextStatePayload {
    const harness = this.requireHarness();
    const context = harness.getContextManager();
    return {
      attachments: Array.from(this.attachments.values()).map((attachment) => ({ ...attachment })),
      gathered: context.getGatheredFiles(),
      gatheredTokens: context.getGatheredTokens(),
      activeRulePaths: harness.getActiveRules().map((rule) => rule.filePath),
      activeSkillNames: harness.getActiveSkills().map((skill) => skill.frontmatter.name),
    };
  }

  private listRules(): unknown {
    const loader = this.requireHarness().getRuleLoader();
    return {
      rules: loader?.getAll().map((rule) => ({ id: rule.id, name: rule.name, filePath: rule.filePath, scope: rule.scope, origin: rule.origin, mandatory: rule.mandatory, enabled: rule.enabled })) ?? [],
      diagnostics: loader?.getDiagnostics() ?? [],
    };
  }

  private listSkills(): unknown {
    const loader = this.requireHarness().getSkillLoader();
    return loader?.getAll().map((skill) => ({ id: skill.id, name: skill.frontmatter.name, description: skill.frontmatter.description, scope: skill.frontmatter.scope, activation: skill.frontmatter.activation, active: skill.active, status: skill.status })) ?? [];
  }

  private async listMemories(): Promise<unknown> {
    return this.dataStore.invoke('db_list_memories', { projectId: this.projectId, status: 'active', limit: 100 });
  }

  private addAttachmentSource(attachment: ContextAttachment): void {
    const content = attachment.kind === 'image'
      ? `[image attachment: ${attachment.label}]`
      : attachment.content ?? attachment.path ?? attachment.label;
    const source: ContextSource = {
      id: attachment.id,
      type: attachment.kind === 'terminal' ? 'terminal' : 'context_chip',
      priority: 'high',
      origin: 'explicit',
      content: `<attachment kind="${attachment.kind}" label="${attachment.label}">\n${content}\n</attachment>`,
      tokenEstimate: attachment.tokenEstimate ?? Math.ceil(content.length / 4),
      identity: attachment.path ?? attachment.terminalId ?? attachment.id,
    };
    this.requireHarness().addContextSource(source);
  }

  private emitContextUpdated(): void {
    this.emit({ type: 'event', event: 'context_updated', payload: this.contextState() });
  }

  private async listTerminals(): Promise<TerminalSummary[]> {
    return this.requireTerminalRuntime().list();
  }

  private async openTerminal(rawParams: Record<string, unknown>): Promise<TerminalSummary> {
    const runtime = this.requireTerminalRuntime();
    const binding = await runtime.openUserTerminal({
      conversationId: this.session?.id ?? this.projectId,
      cwd: this.resolveWorkspacePath(String(rawParams.cwd ?? this.workspacePath)),
      forceNew: rawParams.forceNew !== false,
      ...(typeof rawParams.name === 'string' && rawParams.name ? { name: rawParams.name } : {}),
    });
    return runtime.summary(binding.terminalId);
  }

  private async terminalSnapshot(rawParams: Record<string, unknown>): Promise<unknown> {
    const terminalId = String(rawParams.terminalId ?? '');
    const runtime = this.requireTerminalRuntime();
    runtime.authorize(terminalId, this.userTerminalAccess());
    return { terminalId, ...(await runtime.snapshot(terminalId, numberValue(rawParams.afterSequence, 0))) };
  }

  private async terminalWrite(rawParams: Record<string, unknown>): Promise<{ written: boolean }> {
    const settings = this.requireSettings();
    await this.requireTerminalRuntime().writeUser(
      String(rawParams.terminalId ?? ''),
      String(rawParams.data ?? ''),
      settings.approvalMode,
      this.userTerminalAccess(),
    );
    invalidateTerminalInput(String(rawParams.terminalId ?? ''), this.userTerminalAccess());
    return { written: true };
  }

  private async terminalResize(rawParams: Record<string, unknown>): Promise<{ resized: boolean }> {
    const runtime = this.requireTerminalRuntime();
    const terminalId = String(rawParams.terminalId ?? '');
    runtime.authorize(terminalId, this.userTerminalAccess());
    await runtime.resize(
      terminalId,
      Math.max(1, Math.floor(numberValue(rawParams.cols, 120))),
      Math.max(1, Math.floor(numberValue(rawParams.rows, 32))),
    );
    return { resized: true };
  }

  private async terminalInterrupt(rawParams: Record<string, unknown>): Promise<{ interrupted: boolean }> {
    const runtime = this.requireTerminalRuntime();
    const terminalId = String(rawParams.terminalId ?? '');
    runtime.authorize(terminalId, this.userTerminalAccess());
    await runtime.interrupt(terminalId);
    return { interrupted: true };
  }

  private async terminalKill(rawParams: Record<string, unknown>): Promise<{ killed: boolean }> {
    const runtime = this.requireTerminalRuntime();
    const terminalId = String(rawParams.terminalId ?? '');
    runtime.authorize(terminalId, this.userTerminalAccess());
    await runtime.kill(terminalId);
    return { killed: true };
  }

  private async resolveFileChange(rawParams: Record<string, unknown>): Promise<{ resolved: boolean }> {
    const change = this.pendingFileChanges.get(String(rawParams.toolCallId ?? rawParams.id ?? ''));
    if (!change) return { resolved: false };
    const action = rawParams.action === 'accept' ? 'accept' : 'reject';
    if (action === 'reject') {
      await this.restoreFile(change);
      change.status = 'rejected';
    } else {
      change.status = 'accepted';
    }
    this.pendingFileChanges.set(change.toolCallId, change);
    this.emit({ type: 'event', event: 'file_change_updated', payload: change });
    return { resolved: true };
  }

  private async resolveAllFileChanges(rawParams: Record<string, unknown>): Promise<{ resolved: number }> {
    const action = rawParams.action === 'accept' ? 'accept' : 'reject';
    let resolved = 0;
    for (const change of this.pendingFileChanges.values()) {
      if (change.status !== 'pending') continue;
      if (action === 'reject') await this.restoreFile(change);
      change.status = action === 'accept' ? 'accepted' : 'rejected';
      resolved += 1;
    }
    for (const change of this.pendingFileChanges.values()) {
      if (change.status !== 'pending') this.emit({ type: 'event', event: 'file_change_updated', payload: change });
    }
    return { resolved };
  }

  private async restoreFile(change: FileChangeState): Promise<void> {
    if (change.originalContent === null) {
      await this.requireHost().invoke('delete_path', { path: change.filePath });
      return;
    }
    await this.requireHost().invoke('write_file', { path: change.filePath, content: change.originalContent });
  }

  private async startSdd(description: string): Promise<SddStatePayload> {
    if (!description.trim()) throw new Error('SDD description cannot be empty.');
    const result = await this.requireHarness().startSdd(description.trim());
    const state = await this.readSddState(result.spec);
    this.emit({ type: 'event', event: 'sdd_updated', payload: state });
    return state;
  }

  private async sddAction(rawParams: Record<string, unknown>): Promise<SddStatePayload> {
    const action = String(rawParams.action ?? '');
    const harness = this.requireHarness();
    let review: string | null = null;
    let spec: string | null = null;
    if (action === 'approve_spec') await harness.approveSddSpec();
    else if (action === 'reject_spec') spec = await harness.rejectSddSpec(String(rawParams.feedback ?? ''));
    else if (action === 'approve_plan') review = await harness.approveSddPlan();
    else if (action === 'resume') review = await harness.resumeSddPlan();
    else throw new Error(`Unknown SDD action "${action}".`);
    const state = await this.readSddState(spec, review);
    this.emit({ type: 'event', event: 'sdd_updated', payload: state });
    return state;
  }

  private async readSddState(spec: string | null = null, review: string | null = null): Promise<SddStatePayload> {
    const harness = this.requireHarness();
    const sessionId = harness.getSddSessionId();
    const rawSession = sessionId
      ? await this.dataStore.invoke<string | null>('db_sdd_get_session', { id: sessionId })
      : null;
    const session = rawSession ? ({ ...JSON.parse(rawSession), tasks: [] } as SddSession) : null;
    const rawTasks = sessionId
      ? await this.dataStore.invoke<string[]>('db_sdd_get_tasks', { sessionId })
      : [];
    const tasks = rawTasks.map((raw) => JSON.parse(raw) as SddTask);
    return {
      sessionId,
      session,
      tasks,
      phase: session?.status ?? null,
      spec: spec ?? session?.spec ?? null,
      review,
      failedTask: harness.getSddFailedTask(),
    };
  }

  private cancelSubAgent(ownerId: string): { cancelled: boolean } {
    const child = this.childAgents.get(ownerId);
    if (!child) return { cancelled: false };
    child.cancel();
    return { cancelled: true };
  }

  private async deleteSession(id: string): Promise<{ deleted: boolean }> {
    const deleted = await this.dataStore.deleteSession(id);
    if (deleted && this.session?.id === id) this.session = await this.newSession();
    return { deleted };
  }

  private async renameSession(id: string, title: string): Promise<SessionRecord | null> {
    const session = await this.dataStore.renameSession(id, title);
    if (session && this.session?.id === id) {
      this.session = session;
      this.emit({ type: 'event', event: 'session_updated', payload: session });
    }
    return session;
  }

  private async exportSession(id: string): Promise<{ path: string; content: string }> {
    const session = this.dataStore.loadSession(id);
    if (!session) throw new Error(`Session "${id}" not found.`);
    const lines = [`# ${session.title}`, '', `- Workspace: ${session.workspacePath}`, `- Mode: ${session.agentType}`, `- Updated: ${session.updatedAt}`, ''];
    for (const message of session.messages) {
      lines.push(`## ${message.role}`, '');
      for (const block of message.content) {
        if (block.type === 'text') lines.push(block.text);
        else if (block.type === 'thinking') lines.push(`> Thinking: ${block.thinking}`);
        else if (block.type === 'tool_call') lines.push(`> Tool: ${block.name}\n> Input: ${formatJson(block.input)}`);
        else if (block.type === 'tool_result') lines.push(`> Result:\n\n${block.output}`);
      }
      lines.push('');
    }
    const exportPath = path.join(this.workspacePath, '.hyscode', 'exports', `${session.id}.md`);
    await this.requireHost().invoke('create_directory', { path: path.dirname(exportPath) });
    await this.requireHost().invoke('write_file', { path: exportPath, content: `${lines.join('\n')}\n` });
    return { path: exportPath, content: lines.join('\n') };
  }

  private async listTraces(): Promise<unknown> {
    return this.dataStore.invoke('db_list_traces', { conversationId: this.session?.id ?? '' });
  }

  private loadSession(id: string): SessionRecord | null {
    const session = this.dataStore.loadSession(id);
    if (session && this.harness) {
      this.resetConversationContext();
      this.clearSessionPathGrants();
      this.session = session;
      this.harness.setConversationId(session.id);
      this.harness.setAgentType(session.agentType);
      this.harness.setMode(session.agentType === 'chat' ? 'chat' : 'agent');
    }
    return session;
  }

  private async newSession(): Promise<SessionRecord> {
    const harness = this.requireHarness();
    this.resetConversationContext();
    this.clearSessionPathGrants();
    this.session = await this.dataStore.createSession(this.workspacePath, harness.getAgentType(), this.currentProviderId(), this.currentModelId());
    harness.setConversationId(this.session.id);
    this.emit({ type: 'event', event: 'session_updated', payload: this.session });
    return this.session;
  }

  private async shutdown(): Promise<void> {
    const activeRun = this.activeRun;
    this.cancel();
    await activeRun?.catch(() => undefined);
    for (const pending of this.hostRequests.values()) pending.reject(new Error('Runtime host was shut down.'));
    this.hostRequests.clear();
    await this.terminalRuntime?.shutdown();
    this.terminalRuntime = null;
    this.attachments.clear();
    this.pendingFileChanges.clear();
    this.childAgents.clear();
    if (this.mcp) await Promise.all(this.mcp.listServers().map((server) => this.mcp?.disconnect(server.config.id)));
    await this.host?.shutdown();
  }

  private async refreshGitSummary(): Promise<GitSummary> {
    if (!this.host) return this.gitSummary;
    try {
      this.gitSummary = await this.host.invoke<GitSummary>('git_summary', { repoPath: this.workspacePath });
    } catch {
      this.gitSummary = EMPTY_GIT_SUMMARY;
    }
    return this.gitSummary;
  }

  private resetConversationContext(): void {
    if (!this.harness) return;
    this.harness.getContextManager().clearConversationContext();
    this.attachments.clear();
    this.emitContextUpdated();
  }

  private clearSessionPathGrants(): void {
    this.harness?.getToolRouter().clearExternalPathGrants();
  }

  private resolveHostResponse(rawParams: Record<string, unknown>): { resolved: boolean } {
    const requestId = String(rawParams.requestId ?? '');
    const pending = this.hostRequests.get(requestId);
    if (!pending) return { resolved: false };
    this.hostRequests.delete(requestId);
    if (rawParams.ok === false) {
      pending.reject(new Error(String(rawParams.error ?? 'Runtime host request failed.')));
    } else {
      pending.resolve(rawParams.result);
    }
    return { resolved: true };
  }

  private forwardHostEvent(rawParams: Record<string, unknown>): { forwarded: boolean } {
    if (!this.host || typeof rawParams.event !== 'string') return { forwarded: false };
    this.host.emitExternal(rawParams.event, rawParams.payload);
    return { forwarded: true };
  }

  private async persistTurn(
    params: SendMessageParams,
    response: string,
    tokenUsage: TokenUsage,
    trace?: Trace,
  ): Promise<void> {
    if (!this.session) return;
    const userContent: Message['content'] = [
      { type: 'text', text: params.message },
      ...(params.images ?? []).map((image) => ({ type: 'image' as const, base64: image.base64, mediaType: image.mediaType })),
    ];
    const user = makeSessionMessage({ role: 'user', content: userContent });
    const turnMessages = this.activeTurnMessages.map((message, index, messages) => makeSessionMessage(
      message,
      index === messages.length - 1 && message.role === 'assistant'
        ? tokenUsage
        : undefined,
    ));
    const hasAssistantResponse = turnMessages.some((message) => message.role === 'assistant' && message.content.some((block) => block.type === 'text' && block.text === response));
    const messages = [...this.session.messages, user, ...turnMessages];
    if (response && !hasAssistantResponse) {
      messages.push(
        makeSessionMessage(
          { role: 'assistant', content: [{ type: 'text', text: response }] },
          tokenUsage,
        ),
      );
    }
    if (trace) {
      await this.dataStore.invoke('db_create_trace', tracePersistenceArgs(trace, this.session.id));
    }
    this.session = {
      ...this.session,
      messages,
      messageCount: messages.length,
      tokenUsage: mergeTokenUsage(this.session.tokenUsage, tokenUsage),
      title: this.session.title === 'New session' ? params.message.slice(0, 80) : this.session.title,
      updatedAt: new Date().toISOString(),
      providerId: this.currentProviderId(),
      modelId: this.currentModelId(),
      agentType: this.requireHarness().getAgentType(),
    };
    await this.dataStore.saveSession(this.session);
    this.emit({ type: 'event', event: 'session_updated', payload: this.session });
  }

  private async connectMcpServers(): Promise<void> {
    const manager = this.mcp;
    const settings = this.requireSettings();
    if (!manager) return;
    for (const server of settings.mcpServers) {
      if (server.enabled === false || server.autoConnect === false) continue;
      try {
        const connection = await manager.connect({
          ...server,
          capabilities: server.capabilities ?? { allowedTools: '*', allowedResources: '*', maxConcurrentCalls: 4, timeoutMs: 30000 },
        });
        if (connection.status === 'error') this.emitDiagnostic({ level: 'warning', message: `MCP ${server.name} failed: ${connection.error ?? 'unknown error'}` });
      } catch (error) {
        this.emitDiagnostic({ level: 'warning', message: `MCP ${server.name} failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }

  private registerMcpTools(): void {
    const manager = this.mcp;
    const harness = this.requireHarness();
    if (!manager) return;
    for (const tool of manager.getAllTools()) {
      const handler: ToolHandler = {
        definition: { name: `mcp__${tool.serverId}__${tool.name}`, description: `[MCP: ${tool.serverId}] ${tool.description}`, inputSchema: tool.inputSchema as Record<string, unknown> },
        category: 'mcp',
        requiresApproval: true,
        execute: async (input): Promise<ToolResult> => {
          try {
            const result = await manager.callTool(tool.serverId, tool.name, input);
            return { success: !result.isError, output: JSON.stringify(result) };
          } catch (error) {
            return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
          }
        },
      };
      harness.registerExternalTool(handler);
    }
  }

  private registerSubAgentTool(): void {
    const harness = this.requireHarness();
    const settings = this.requireSettings();
    const manager = this.mcp;
    harness.registerExternalTool({
      definition: {
        name: 'spawn_subagent',
        description: 'Delegate a focused task to a child HysCode agent and return its result.',
        inputSchema: { type: 'object', properties: { task: { type: 'string' }, mode: { type: 'string', enum: ['build', 'review', 'debug', 'plan'] } }, required: ['task'] },
      },
      category: 'meta',
      requiresApproval: false,
      execute: async (input, context): Promise<ToolResult> => {
        if (!settings.subAgentEnabled) return { success: false, output: '', error: 'Sub-agents are disabled in shared settings.' };
        const task = String(input.task ?? '').trim();
        const mode = normalizeAgentType(input.mode ?? settings.subAgentDefaultMode);
        if (!task) return { success: false, output: '', error: 'Sub-agent task cannot be empty.' };
        if (mode === harness.getAgentType() || mode === 'chat') return { success: false, output: '', error: `A child agent cannot use the parent mode (${harness.getAgentType()}).` };
        const child = harness.createChild({
          agentType: mode,
          config: { maxIterations: settings.subAgentMaxIterations, approval: settings.subAgentAutoApprove ? { mode: 'yolo' } : buildApprovalConfig(settings) },
          onEvent: (event) => this.emitScopedHarnessEvent(context.toolCallId, event),
          externalTools: manager ? this.externalMcpTools(manager) : [],
        });
        child.setOwnerId(context.toolCallId);
        this.childAgents.set(context.toolCallId, child);
        const release = await this.acquireSubAgentSlot(settings.subAgentMaxConcurrent);
        try {
          const result = await child.run({ userMessage: task, history: [] });
          return { success: result.status === 'complete', output: result.response, error: result.status === 'complete' ? undefined : result.status };
        } finally {
          this.childAgents.delete(context.toolCallId);
          release();
        }
      },
    });
  }

  private externalMcpTools(manager: McpClientManager): ToolHandler[] {
    const agentSafeServerIds = new Set(this.requireSettings().mcpServers.filter((server) => server.agentSafe === true).map((server) => server.id));
    return manager.getAllTools().filter((tool) => agentSafeServerIds.has(tool.serverId)).map((tool) => ({
      definition: { name: `mcp__${tool.serverId}__${tool.name}`, description: `[MCP: ${tool.serverId}] ${tool.description}`, inputSchema: tool.inputSchema as Record<string, unknown> },
      category: 'mcp',
      requiresApproval: true,
      execute: async (input): Promise<ToolResult> => {
        const result = await manager.callTool(tool.serverId, tool.name, input);
        return { success: !result.isError, output: JSON.stringify(result) };
      },
    }));
  }

  private async acquireSubAgentSlot(limit: number): Promise<() => void> {
    const normalizedLimit = Math.max(1, Math.min(4, Math.floor(limit)));
    if (this.subAgentsInFlight < normalizedLimit) {
      this.subAgentsInFlight += 1;
      return () => this.releaseSubAgentSlot();
    }
    await new Promise<void>((resolve) => this.subAgentWaiters.push(resolve));
    this.subAgentsInFlight += 1;
    return () => this.releaseSubAgentSlot();
  }

  private releaseSubAgentSlot(): void {
    this.subAgentsInFlight = Math.max(0, this.subAgentsInFlight - 1);
    this.subAgentWaiters.shift()?.();
  }

  private createSkillLoader(): SkillLoader {
    const settings = this.requireSettings();
    const builtInPath = 'hyscode://builtin-skills';
    const builtins = BUILTIN_SKILLS;
    return new SkillLoader({
      builtInPath,
      globalPath: settings.skillsPath || path.join(os.homedir(), '.agents', 'skills'),
      workspacePath: this.workspacePath,
      readDir: async (directory) => {
        if (directory === builtInPath) return Object.keys(builtins).map((name) => ({ name: `${name}.md`, is_dir: false }));
        return this.readDirectory(directory);
      },
      readFile: async (filePath) => {
        if (filePath.startsWith(`${builtInPath}/`)) return builtins[path.basename(filePath, '.md')] ?? '';
        return this.requireHost().invoke<string>('read_file', { path: filePath });
      },
      pathExists: async (filePath) => {
        if (filePath === builtInPath || filePath.startsWith(`${builtInPath}/`)) return true;
        return this.requireHost().invoke('stat_path', { path: filePath }).then(() => true).catch(() => false);
      },
    });
  }

  private createRuleLoader(): RuleLoader {
    const settings = this.requireSettings();
    return new RuleLoader({
      globalPath: settings.globalRulesPath || path.join(os.homedir(), '.config', 'hyscode', 'rules'),
      workspacePath: this.workspacePath,
      readDir: (directory) => this.readDirectory(directory),
      readFile: (filePath) => this.requireHost().invoke<string>('read_file', { path: filePath }),
      pathExists: (filePath) => this.requireHost().invoke('stat_path', { path: filePath }).then(() => true).catch(() => false),
    });
  }

  private async readDirectory(directory: string): Promise<Array<{ name: string; is_dir: boolean }>> {
    return this.requireHost().invoke<Array<{ name: string; is_dir: boolean }>>('list_dir_all', { path: directory });
  }

  private activeSkillsFor(agentType: AgentType, loader: SkillLoader): Skill[] {
    return loader.getAll().filter((skill) => skill.frontmatter.activation === 'always' && (!skill.frontmatter.agents || skill.frontmatter.agents.includes(agentType))).map((skill) => ({ ...skill, active: true }));
  }

  private createSddDatabase(): SddDatabase {
    return {
      createSession: async (session) => { await this.dataStore.invoke('db_sdd_upsert_session', { sessionJson: JSON.stringify(session) }); },
      updateSession: async (id, updates) => {
        const existing = await this.dataStore.invoke<string | null>('db_sdd_get_session', { id });
        if (!existing) throw new Error(`SDD session ${id} not found.`);
        await this.dataStore.invoke('db_sdd_upsert_session', { sessionJson: JSON.stringify({ ...(JSON.parse(existing) as SddSession), ...updates }) });
      },
      getSession: async (id) => {
        const raw = await this.dataStore.invoke<string | null>('db_sdd_get_session', { id });
        return raw ? ({ ...JSON.parse(raw), tasks: [] } as SddSession) : null;
      },
      listSessions: async (projectId) => (await this.dataStore.invoke<string[]>('db_sdd_list_sessions', { projectId })).map((raw) => ({ ...JSON.parse(raw), tasks: [] }) as SddSession),
      createTask: async (task) => { await this.dataStore.invoke('db_sdd_upsert_task', { taskJson: JSON.stringify(task) }); },
      updateTask: async (id, updates) => {
        const raw = await this.dataStore.invoke<string | null>('db_sdd_get_task', { id });
        if (!raw) throw new Error(`SDD task ${id} not found.`);
        const current = JSON.parse(raw) as SddTask;
        await this.dataStore.invoke('db_sdd_upsert_task', { taskJson: JSON.stringify({ ...current, ...updates }) });
      },
      getTasksForSession: async (sessionId) => (await this.dataStore.invoke<string[]>('db_sdd_get_tasks', { sessionId })).map((raw) => JSON.parse(raw) as SddTask),
    };
  }

  private async savePlanFile(sessionId: string, spec: string, tasks: SddTask[]): Promise<void> {
    const planDirectory = path.join(this.workspacePath, '.hyscode', 'plans');
    const planPath = path.join(planDirectory, `PLAN-${sessionId}.md`);
    const taskList = tasks.map((task, index) => `${index + 1}. **${task.title}**\n   - Files: ${task.files.join(', ') || 'N/A'}\n   - Description: ${task.description}`).join('\n\n');
    await this.requireHost().invoke('create_directory', { path: planDirectory });
    await this.requireHost().invoke('write_file', { path: planPath, content: `# Implementation Plan\n\n## Specification\n\n${spec}\n\n## Tasks\n\n${taskList}\n` });
  }

  private async requestApproval(
    pending: ToolApprovalRequest,
    signal: AbortSignal,
  ): Promise<ApprovalDecision> {
    const interaction = pendingToolToInteraction(pending);
    const resolution = await this.waitForInteraction(interaction, signal);
    if (resolution.approved !== true) return false;
    if (pending.externalAccess) {
      return { approved: true, externalGrant: resolution.grant ?? 'once' };
    }
    return true;
  }

  private async requestModeSwitch(request: { id: string; fromMode: string; toMode: string; reason: string; contextSummary: string }): Promise<boolean> {
    const resolution = await this.waitForInteraction({ kind: 'mode_switch', requestId: request.id, fromMode: request.fromMode, toMode: request.toMode, reason: request.reason, contextSummary: request.contextSummary });
    return resolution.approved === true;
  }

  private async requestUserQuestions(id: string, questions: Parameters<NonNullable<ConstructorParameters<typeof Harness>[0]['onUserQuestionRequest']>>[1], title: string | undefined): Promise<AgentQuestionAnswer[]> {
    const resolution = await this.waitForInteraction({ kind: 'question', requestId: id, questions, ...(title ? { title } : {}) });
    return resolution.answers ?? [];
  }

  private waitForInteraction(
    interaction: InteractionRequest,
    signal?: AbortSignal,
  ): Promise<InteractionResolution> {
    this.emit({ type: 'event', event: 'interaction', payload: interaction });
    return new Promise<InteractionResolution>((resolve) => {
      let settled = false;
      const settle = (resolution: InteractionResolution): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(resolution);
      };
      const onAbort = (): void => {
        this.interactions.delete(interaction.requestId);
        settle({ requestId: interaction.requestId, approved: false });
      };
      this.interactions.set(interaction.requestId, { kind: interaction.kind, resolve: settle });
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private emitHarnessEvent(event: HarnessEvent): void {
    if (event.type === 'turn_recoverable_error') this.lastRecovery = event.recovery;
    if (event.type === 'terminal_progress') this.terminalRuntime?.setProgress(event.progress);
    if (event.type === 'turn_start' && !this.activeTurnId) this.activeTurnId = event.turnId ?? null;
    if (event.type === 'transcript_message' && this.belongsToActiveTurn(event)) {
      this.activeTurnMessages.push({ role: event.role, content: event.blocks });
    }
    if (event.type === 'tool_call_pending') {
      const pending = event.pending;
      this.emit({ type: 'event', event: 'harness_event', payload: { ...event, pending: { id: pending.id, toolName: pending.toolName, input: pending.input, description: pending.description, riskLevel: pending.riskLevel, ...(pending.externalAccess ? { externalAccess: pending.externalAccess } : {}) } } as HarnessEvent });
      return;
    }
    if (event.type === 'file_change_pending') {
      this.pendingFileChanges.set(event.change.toolCallId, {
        ...event.change,
        status: this.pendingFileChanges.get(event.change.toolCallId)?.status ?? 'pending',
      });
    }
    this.emit({ type: 'event', event: 'harness_event', payload: event });
  }

  private emitScopedHarnessEvent(ownerId: string, event: HarnessEvent): void {
    this.emit({ type: 'event', event: 'scoped_harness_event', payload: { ownerId, event } });
  }

  private belongsToActiveTurn(event: HarnessEvent): boolean {
    return !this.activeTurnId || !event.turnId || event.turnId === this.activeTurnId;
  }

  private emitDiagnostic(payload: DiagnosticPayload): void {
    this.emit({ type: 'event', event: 'diagnostic', payload });
  }

  private emit(message: BridgeEvent): void {
    this.output?.(message);
  }

  private async runtimeReady(): Promise<RuntimeReadyPayload> {
    const harness = this.requireHarness();
    const registry = getProviderRegistry();
    const providers = registry.list().map((provider) => ({ id: provider.id, name: provider.name, configured: provider.isConfigured(), models: provider.models }));
    const models = providers.flatMap((provider) => provider.configured ? provider.models : []);
    return {
      protocolVersion: 1,
      capabilitiesVersion: 3,
      workspacePath: this.workspacePath,
      projectId: this.projectId,
      providers,
      models,
      agentTypes: getAgentTypes(),
      modes: ['manual', 'yolo', 'smart', 'notify', 'session-trust', 'custom'],
      approvalMode: this.requireSettings().approvalMode,
      activeAgentType: harness.getAgentType(),
      activeProviderId: this.currentProviderId(),
      activeModelId: this.currentModelId(),
      activeThinking: normalizeStoredThinkingConfig(
        buildThinkingConfig(this.requireSettings(), this.currentProviderId(), this.currentModelId()) ?? { enabled: false },
        this.currentProviderId(),
        this.currentModelId(),
      ),
      activeThemeId: this.requireSettings().themeId,
      themes: this.themes,
      recentSessions: this.dataStore.listSessions(this.workspacePath).slice(0, 4),
      sidebarVisible: this.requireSettings().sidebarVisible,
      updates: {
        channel: this.requireSettings().updateChannel,
        checkForUpdatesOnStartup: this.requireSettings().checkForUpdatesOnStartup,
        autoDownload: this.requireSettings().autoDownload,
      },
      git: this.gitSummary,
      capabilities: {
        slashCommands: true,
        contextMentions: true,
        fileAttachments: true,
        directoryAttachments: true,
        terminalAttachments: true,
        imageAttachments: true,
        interactiveTerminal: true,
        approvals: true,
        fileReview: true,
        sdd: harness.getSddEngine() !== null,
        subAgents: this.requireSettings().subAgentEnabled,
        sessionManagement: true,
        terminalEvents: true,
        terminalInput: true,
        terminalResize: true,
        ndjsonProtocol: true,
      },
      context: this.contextState(),
      sdd: {
        sessionId: harness.getSddSessionId(),
        session: null,
        tasks: [],
        phase: null,
        spec: null,
        review: null,
        failedTask: harness.getSddFailedTask(),
      },
      terminals: await this.requireTerminalRuntime().list(),
      ...(this.session ? { session: this.session } : {}),
    };
  }

  private currentProviderId(): string {
    return this.getHarnessConfigValue('providerId');
  }

  private currentModelId(): string {
    return this.getHarnessConfigValue('modelId');
  }

  private getHarnessConfigValue(key: 'providerId' | 'modelId'): string {
    const registry = getProviderRegistry();
    if (key === 'providerId') return this.settings?.activeProviderId ?? registry.defaultProviderId ?? '';
    return this.settings?.activeModelId ?? registry.defaultModelId ?? '';
  }

  private async codexAuthDetected(): Promise<boolean> {
    try {
      await readFile(path.join(os.homedir(), '.codex', 'auth.json'), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  private createCodexInvoke(): CodexInvoke {
    const dataStore = this.dataStore;
    return async function* (params): AsyncIterable<StreamChunk> {
      const repoRoot = process.env.HYSCODE_REPO_ROOT || process.cwd();
      const sidecar = resolveCodexSidecar(repoRoot);
      if (!sidecar) {
        yield { type: 'error', error: 'Codex sidecar was not found. Set HYSCODE_CODEX_SIDECAR or build the Codex sidecar.' };
        return;
      }
      const threadId = params.sessionId
        ? await dataStore.loadCodexThread(params.sessionId, params.sessionFingerprint ?? null)
        : null;
      const child = spawn(sidecar.program, sidecar.args, { cwd: sidecar.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const abort = () => child.kill();
      params.signal?.addEventListener('abort', abort, { once: true });
      child.stdin.end(JSON.stringify({
        apiKey: params.apiKey,
        model: params.model,
        systemPrompt: params.systemPrompt,
        prompt: params.prompt,
        cwd: params.cwd,
        reasoningEffort: params.reasoningEffort,
        sandboxMode: params.sandboxMode,
        ...(threadId ? { threadId } : {}),
        ...(params.continuationPrompt ? { continuationPrompt: params.continuationPrompt } : {}),
      }));
      child.stderr.on('data', (data: Buffer) => { if (String(data).trim()) process.stderr.write(`[codex-sidecar] ${String(data)}`); });
      let exitCode: number | null = null;
      const closePromise = new Promise<number | null>((resolve) => child.once('close', resolve));
      let buffer = '';
      try {
        for await (const chunk of child.stdout) {
          buffer += String(chunk);
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines.filter(Boolean)) {
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line) as Record<string, unknown>;
            } catch (error) {
              yield { type: 'error', error: `Codex sidecar emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
              continue;
            }
            if (event.type === 'thread_started') {
              if (params.sessionId && typeof event.threadId === 'string' && event.threadId) {
                await dataStore.saveCodexThread(
                  params.sessionId,
                  params.sessionFingerprint ?? null,
                  event.threadId,
                );
              }
            }
            else if (event.type === 'text') yield { type: 'text_delta', text: String(event.content ?? '') };
            else if (event.type === 'thinking') yield { type: 'thinking_delta', text: String(event.content ?? '') };
            else if (event.type === 'tool_use') {
              const id = String(event.callId ?? crypto.randomUUID());
              yield { type: 'tool_call_start', id, name: String(event.toolName ?? 'tool') };
              if (typeof event.toolInput === 'string') yield { type: 'tool_call_delta', id, input: event.toolInput };
              yield { type: 'tool_call_end', id };
            }
            else if (event.type === 'message_boundary') yield { type: 'message_boundary' };
            else if (event.type === 'usage') {
              const usage: import('@hyscode/ai-providers').TokenUsage = {
                inputTokens: Number(event.inputTokens ?? 0),
                outputTokens: Number(event.outputTokens ?? 0),
                totalTokens: Number(event.inputTokens ?? 0) + Number(event.outputTokens ?? 0),
                reasoningTokens: optionalNumber(event.reasoningTokens),
              };
              const cacheReadTokens = optionalNumber(event.cacheReadTokens);
              const cacheWriteTokens = optionalNumber(event.cacheWriteTokens);
              if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens;
              if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
              yield { type: 'usage', usage };
            }
            else if (event.type === 'done') yield { type: 'done', stopReason: 'end_turn' };
            else if (event.type === 'error') yield { type: 'error', error: String(event.error ?? 'Codex sidecar failed') };
          }
        }
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer) as Record<string, unknown>;
            if (event.type === 'error') yield { type: 'error', error: String(event.error ?? 'Codex sidecar failed') };
          } catch (error) {
            yield { type: 'error', error: `Codex sidecar emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
          }
        }
        exitCode = await closePromise;
        if (exitCode !== null && exitCode !== 0 && !params.signal?.aborted) yield { type: 'error', error: `Codex sidecar exited with code ${exitCode}.` };
      } finally {
        params.signal?.removeEventListener('abort', abort);
        if (!child.killed) child.kill();
      }
    };
  }

  private requireHost(): CliHost {
    if (!this.host) throw new Error('Runtime host is not initialized.');
    return this.host;
  }

  private requireTerminalRuntime(): CliTerminalRuntime {
    if (!this.terminalRuntime) throw new Error('Terminal runtime is not initialized.');
    return this.terminalRuntime;
  }

  private userTerminalAccess(): TerminalAccess {
    return {
      conversationId: this.session?.id ?? this.projectId,
      source: 'user',
    };
  }

  private resolveWorkspacePath(value: string): string {
    return path.isAbsolute(value) ? path.normalize(value) : path.resolve(this.workspacePath, value);
  }

  private requireHarness(): Harness {
    if (!this.harness) throw new Error('Harness is not initialized.');
    return this.harness;
  }

  private requireSettings(): SharedTuiSettings {
    if (!this.settings) throw new Error('Shared settings are not initialized.');
    return this.settings;
  }

  private ok(id: string, result: unknown): BridgeResponse {
    return { type: 'response', id, ok: true, result };
  }

  private fail(id: string, error: string): BridgeResponse {
    return { type: 'response', id, ok: false, error };
  }
}

class CliTerminalRuntime implements TerminalRuntimeAdapter {
  private readonly entries = new Map<string, CliTerminalEntry>();

  constructor(
    private readonly host: CliHost,
    private readonly configuredShell: string,
    private readonly onUpdate: (terminal: TerminalSummary, cause: TerminalUpdateCause) => void = () => undefined,
  ) {}

  async acquire(request: TerminalAcquireRequest): Promise<TerminalBinding> {
    const isolationKey = request.ownerId ?? request.conversationId;
    if (!request.forceNew) {
      for (const entry of this.entries.values()) {
        if (entry.role !== 'agent') continue;
        if (entry.isolationKey !== isolationKey) continue;
        if (entry.cwd !== normalizeTerminalPath(request.cwd)) continue;
        if (request.sessionName && entry.sessionName !== request.sessionName) continue;
        if (entry.awaitingInput) continue;
        if (entry.activeToolCallId && entry.activeToolCallId !== request.toolCallId) continue;
        const alive = await this.host.invoke<boolean>('pty_exists', { ptyId: entry.binding.ptyId }).catch(() => false);
        if (!alive) {
          this.markExited(entry, entry.exitCode);
          continue;
        }
        entry.alive = true;
        entry.activeToolCallId = request.toolCallId;
        entry.awaitingInput = false;
        this.notify(entry, 'state');
        return entry.binding;
      }
    }

    return this.spawn({
      role: 'agent',
      isolationKey,
      ownerConversationId: request.conversationId,
      ...(request.ownerId ? { ownerId: request.ownerId } : {}),
      cwd: request.cwd,
      sessionName: request.sessionName,
      activeToolCallId: request.toolCallId,
    });
  }

  async openUserTerminal(request: {
    conversationId: string;
    cwd: string;
    name?: string;
    forceNew: boolean;
  }): Promise<TerminalBinding> {
    const cwd = normalizeTerminalPath(request.cwd);
    if (!request.forceNew) {
      for (const entry of this.entries.values()) {
        if (entry.role !== 'user' || entry.isolationKey !== request.conversationId || entry.cwd !== cwd) continue;
        if (request.name && entry.sessionName !== request.name) continue;
        if (entry.alive) return entry.binding;
      }
    }
    return this.spawn({
      role: 'user',
      isolationKey: request.conversationId,
      ownerConversationId: request.conversationId,
      cwd,
      ...(request.name ? { sessionName: request.name } : {}),
      activeToolCallId: null,
    });
  }

  async snapshot(terminalId: string, afterSequence = 0): Promise<TerminalSnapshot> {
    const entry = this.requireEntry(terminalId);
    const snapshot = await this.host.invoke<{
      data: string;
      from_sequence: number;
      to_sequence: number;
      truncated: boolean;
      alive: boolean;
      exit_code: number | null;
    }>('pty_snapshot', { ptyId: entry.binding.ptyId, afterSequence });
    entry.sequence = Math.max(entry.sequence, snapshot.to_sequence);
    entry.truncated = entry.truncated || snapshot.truncated;
    if (afterSequence === 0) entry.outputPreview = tail(snapshot.data);
    else if (snapshot.data) entry.outputPreview = tail(`${entry.outputPreview}${snapshot.data}`);
    if (snapshot.alive) {
      if (entry.alive) {
        entry.exitCode = snapshot.exit_code;
        this.notify(entry, 'output');
      }
    } else {
      this.markExited(entry, snapshot.exit_code);
    }
    return {
      data: snapshot.data,
      fromSequence: snapshot.from_sequence,
      toSequence: snapshot.to_sequence,
      truncated: snapshot.truncated,
      alive: snapshot.alive,
      exitCode: snapshot.exit_code,
    };
  }

  async list(): Promise<TerminalSummary[]> {
    const summaries: TerminalSummary[] = [];
    for (const terminalId of this.entries.keys()) summaries.push(await this.summary(terminalId));
    return summaries;
  }

  async summary(terminalId: string): Promise<TerminalSummary> {
    const entry = this.requireEntry(terminalId);
    await this.snapshot(terminalId, 0);
    return this.toSummary(entry);
  }

  async write(terminalId: string, data: string): Promise<void> {
    const entry = this.requireEntry(terminalId);
    if (!entry.alive) throw new Error(`Terminal "${terminalId}" is not writable.`);
    await this.host.invoke('pty_write', { ptyId: entry.binding.ptyId, data });
  }

  async writeUser(terminalId: string, data: string, approvalMode: string, access: TerminalAccess): Promise<void> {
    const entry = this.requireEntry(terminalId);
    this.authorize(terminalId, access);
    const allowed = entry.role === 'user'
      || (!entry.activeToolCallId && entry.awaitingInput && approvalMode !== 'yolo');
    if (!allowed) throw new Error('The terminal is owned by the Harness or is not waiting for input.');
    entry.awaitingInput = false;
    this.notify(entry, 'state');
    await this.write(terminalId, data);
  }

  async interrupt(terminalId: string): Promise<void> {
    const entry = this.requireEntry(terminalId);
    if (entry.alive) await this.host.invoke('pty_interrupt', { ptyId: entry.binding.ptyId });
  }

  async kill(terminalId: string): Promise<void> {
    const entry = this.requireEntry(terminalId);
    await this.host.invoke('pty_kill', { ptyId: entry.binding.ptyId });
    this.markExited(entry, entry.exitCode);
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const entry = this.requireEntry(terminalId);
    await this.host.invoke('pty_resize', { ptyId: entry.binding.ptyId, cols, rows });
  }

  authorize(terminalId: string, access: TerminalAccess): void {
    const entry = this.requireEntry(terminalId);
    const ownerMatches = entry.ownerConversationId === access.conversationId
      && entry.ownerId === access.ownerId;
    if (access.source === 'agent') {
      if (entry.role !== 'agent' || !ownerMatches) {
        throw new Error(`Terminal "${terminalId}" belongs to another terminal owner.`);
      }
      if (access.toolCallId && entry.activeToolCallId && entry.activeToolCallId !== access.toolCallId) {
        throw new Error(`Terminal "${terminalId}" is controlled by another tool.`);
      }
      return;
    }
    if (ownerMatches) return;
    throw new Error(`Terminal "${terminalId}" belongs to another conversation.`);
  }

  setProgress(progress: { terminalId: string; toolCallId: string; state: string; sequence: number }): void {
    const entry = this.entries.get(progress.terminalId);
    if (!entry) return;
    entry.sequence = Math.max(entry.sequence, progress.sequence);
    if (progress.state === 'awaiting_input') {
      entry.awaitingInput = true;
      entry.activeToolCallId = null;
    } else if (progress.state === 'started' || progress.state === 'running') {
      entry.awaitingInput = false;
      entry.activeToolCallId = progress.toolCallId;
    } else if (progress.state === 'complete' || progress.state === 'error' || progress.state === 'cancelled' || progress.state === 'background') {
      entry.awaitingInput = false;
    }
    this.notify(entry, 'state');
  }

  release(terminalId: string, toolCallId: string): void {
    const entry = this.entries.get(terminalId);
    if (!entry || (entry.activeToolCallId && entry.activeToolCallId !== toolCallId)) return;
    entry.activeToolCallId = null;
    this.notify(entry, 'state');
  }

  async subscribe(
    terminalId: string,
    onData: (data: string, sequence: number) => void,
    onExit: (exitCode: number | null) => void,
  ): Promise<() => void> {
    const entry = this.requireEntry(terminalId);
    const queued: Array<{ data: string; sequence: number }> = [];
    let replayComplete = false;
    let appliedSequence = 0;
    let exited = false;
    const deliverData = (data: string, sequence: number): void => {
      if (sequence <= appliedSequence) return;
      appliedSequence = sequence;
      onData(data, sequence);
    };
    const unsubscribeData = await this.host.listen('pty:data', (payload) => {
      const event = payload as TerminalDataEvent;
      if (event.pty_id !== entry.binding.ptyId || typeof event.data !== 'string') return;
      const chunk = { data: event.data, sequence: event.sequence ?? appliedSequence + 1 };
      if (!replayComplete) queued.push(chunk);
      else deliverData(chunk.data, chunk.sequence);
    });
    const unsubscribeExit = await this.host.listen('pty:exit', (payload) => {
      const event = payload as TerminalExitEvent;
      if (event.pty_id !== entry.binding.ptyId || exited) return;
      exited = true;
      onExit(event.code ?? null);
    });
    const replay = await this.snapshot(terminalId, 0);
    appliedSequence = replay.toSequence;
    if (replay.data) onData(replay.data, replay.toSequence);
    replayComplete = true;
    for (const chunk of queued.sort((left, right) => left.sequence - right.sequence)) deliverData(chunk.data, chunk.sequence);
    if (!replay.alive && !exited) {
      exited = true;
      onExit(replay.exitCode);
    }
    return () => {
      unsubscribeData();
      unsubscribeExit();
    };
  }

  async shutdown(): Promise<void> {
    for (const entry of this.entries.values()) entry.observerUnsubscribe?.();
    this.entries.clear();
  }

  private async spawn(request: {
    role: TerminalRole;
    isolationKey: string;
    ownerConversationId: string;
    ownerId?: string;
    cwd: string;
    sessionName?: string;
    activeToolCallId: string | null;
  }): Promise<TerminalBinding> {
    const terminalId = `terminal-${crypto.randomUUID()}`;
    const shell = this.resolveShell();
    const ptyId = await this.host.invoke<string>('pty_spawn', {
      id: terminalId,
      shell: shell.command,
      cwd: request.cwd,
      cols: 120,
      rows: 32,
    });
    const binding: TerminalBinding = { terminalId, ptyId, persistent: true, frameLanguage: shell.frameLanguage };
    const entry: CliTerminalEntry = {
      binding,
      role: request.role,
      isolationKey: request.isolationKey,
      ownerConversationId: request.ownerConversationId,
      ...(request.ownerId ? { ownerId: request.ownerId } : {}),
      cwd: normalizeTerminalPath(request.cwd),
      ...(request.sessionName ? { sessionName: request.sessionName } : {}),
      activeToolCallId: request.activeToolCallId,
      awaitingInput: false,
      alive: true,
      exitCode: null,
      sequence: 0,
      outputPreview: '',
      truncated: false,
      observerUnsubscribe: null,
    };
    this.entries.set(terminalId, entry);
    await this.attachObserver(entry);
    this.notify(entry, 'created');
    return binding;
  }

  private async attachObserver(entry: CliTerminalEntry): Promise<void> {
    const unsubscribeData = await this.host.listen('pty:data', (payload) => {
      const event = payload as TerminalDataEvent;
      if (event.pty_id !== entry.binding.ptyId || typeof event.data !== 'string') return;
      entry.sequence = Math.max(entry.sequence, event.sequence ?? entry.sequence + 1);
      entry.outputPreview = tail(`${entry.outputPreview}${event.data}`);
      this.notify(entry, 'output');
    });
    const unsubscribeExit = await this.host.listen('pty:exit', (payload) => {
      const event = payload as TerminalExitEvent;
      if (event.pty_id !== entry.binding.ptyId) return;
      entry.sequence = Math.max(entry.sequence, event.sequence ?? entry.sequence);
      this.markExited(entry, event.code ?? null);
    });
    entry.observerUnsubscribe = () => {
      unsubscribeData();
      unsubscribeExit();
    };
  }

  private markExited(entry: CliTerminalEntry, exitCode: number | null): void {
    if (!entry.alive) {
      if (entry.exitCode === null && exitCode !== null) entry.exitCode = exitCode;
      return;
    }
    entry.alive = false;
    entry.exitCode = exitCode;
    entry.activeToolCallId = null;
    entry.awaitingInput = false;
    this.notify(entry, 'exit');
  }

  private requireEntry(terminalId: string): CliTerminalEntry {
    const entry = this.entries.get(terminalId);
    if (!entry) throw new Error(`Terminal "${terminalId}" not found.`);
    return entry;
  }

  private toSummary(entry: CliTerminalEntry): TerminalSummary {
    const canUserWrite = entry.role === 'user' || (!entry.activeToolCallId && entry.awaitingInput);
    return {
      terminalId: entry.binding.terminalId,
      ptyId: entry.binding.ptyId,
      name: entry.sessionName ?? entry.binding.terminalId,
      alive: entry.alive,
      sequence: entry.sequence,
      outputPreview: entry.outputPreview,
      frameLanguage: entry.binding.frameLanguage,
      role: entry.role,
      cwd: entry.cwd,
      ownerConversationId: entry.ownerConversationId,
      ...(entry.ownerId ? { ownerId: entry.ownerId } : {}),
      activeToolCallId: entry.activeToolCallId,
      awaitingInput: entry.awaitingInput,
      exitCode: entry.exitCode,
      truncated: entry.truncated,
      canUserWrite,
      permissions: {
        read: true,
        write: canUserWrite,
        respond: entry.role === 'agent' && !entry.activeToolCallId && entry.awaitingInput,
        interrupt: entry.alive,
        kill: entry.alive,
        resize: entry.alive,
      },
    };
  }

  private notify(entry: CliTerminalEntry, cause: TerminalUpdateCause): void {
    this.onUpdate(this.toSummary(entry), cause);
  }

  private resolveShell(): { command: string; frameLanguage: TerminalBinding['frameLanguage'] } {
    const command = this.configuredShell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/sh');
    const name = path.basename(command).toLowerCase().replace(/\.exe$/u, '');
    if (name === 'powershell' || name === 'pwsh') return { command, frameLanguage: 'powershell' };
    if (name === 'bash' || name === 'sh' || name === 'zsh' || name === 'dash') return { command, frameLanguage: 'bash' };
    throw new Error(`Unsupported terminal shell "${command}". Configure PowerShell, bash, sh, zsh, or dash.`);
  }
}

function tracePersistenceArgs(trace: Trace, conversationId: string): Record<string, unknown> {
  return {
    id: trace.id,
    conversationId,
    mode: trace.mode,
    provider: trace.provider,
    model: trace.model,
    systemPromptHash: trace.systemPromptHash,
    systemPromptPreview: trace.systemPromptPreview,
    systemPromptTokens: trace.systemPromptTokens,
    toolCount: trace.toolCount,
    iterations: JSON.stringify(trace.iterations),
    tokenInput: trace.tokenUsage.inputTokens,
    tokenOutput: trace.tokenUsage.outputTokens,
    tokenTotal: trace.tokenUsage.totalTokens,
    tokenCacheRead: trace.tokenUsage.cacheReadTokens ?? 0,
    tokenCacheWrite: trace.tokenUsage.cacheWriteTokens ?? 0,
    tokenCacheMeasuredRead: trace.tokenUsage.cacheMeasuredReadTokens ?? 0,
    tokenCacheEligible: trace.tokenUsage.cacheEligibleTokens ?? 0,
    tokenCacheMeasured: trace.tokenUsage.cacheMeasuredEligibleTokens ?? 0,
    tokenCacheHitRequests: trace.tokenUsage.cacheHitRequests ?? 0,
    tokenCacheObservedRequests: trace.tokenUsage.cacheObservedRequests ?? 0,
    tokenCacheTotalRequests: trace.tokenUsage.cacheTotalRequests ?? 0,
    tokenCacheUnknownRequests: trace.tokenUsage.cacheUnknownRequests ?? 0,
    promptCache: trace.promptCache,
    stopReason: trace.stopReason,
    verificationPerformed: trace.verificationPerformed,
    verificationForced: trace.verificationForced,
    filesModified: JSON.stringify(trace.filesModified),
    errors: JSON.stringify(trace.errors),
    loopWarnings: JSON.stringify(trace.loopWarnings),
    durationMs: trace.durationMs,
    parentTurnId: trace.parentTurnId ?? null,
  };
}

function mergeTokenUsage(previous: TokenUsage | undefined, current: TokenUsage): TokenUsage {
  const inputTokens = (previous?.inputTokens ?? 0) + current.inputTokens;
  const outputTokens = (previous?.outputTokens ?? 0) + current.outputTokens;
  const measuredReadTokens = sumOptional(previous?.cacheMeasuredReadTokens, current.cacheMeasuredReadTokens);
  const eligibleTokens = sumOptional(previous?.cacheEligibleTokens, current.cacheEligibleTokens);
  const measuredEligibleTokens = sumOptional(
    previous?.cacheMeasuredEligibleTokens,
    current.cacheMeasuredEligibleTokens,
  );
  const hitRequests = sumOptional(previous?.cacheHitRequests, current.cacheHitRequests);
  const observedRequests = sumOptional(previous?.cacheObservedRequests, current.cacheObservedRequests);
  const totalRequests = sumOptional(previous?.cacheTotalRequests, current.cacheTotalRequests);
  const unknownRequests = sumOptional(previous?.cacheUnknownRequests, current.cacheUnknownRequests);
  const merged: TokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens: (previous?.totalTokens ?? 0) + current.totalTokens,
    cacheReadTokens: (previous?.cacheReadTokens ?? 0) + (current.cacheReadTokens ?? 0),
    cacheWriteTokens: (previous?.cacheWriteTokens ?? 0) + (current.cacheWriteTokens ?? 0),
    reasoningTokens: sumOptional(previous?.reasoningTokens, current.reasoningTokens),
    retryCount: sumOptional(previous?.retryCount, current.retryCount),
    requestCount: sumOptional(previous?.requestCount, current.requestCount),
    estimatedCostUsd: sumOptional(previous?.estimatedCostUsd, current.estimatedCostUsd),
    possibleDuplicateCharge: previous?.possibleDuplicateCharge || current.possibleDuplicateCharge || undefined,
    lastInputTokens: current.lastInputTokens ?? previous?.lastInputTokens,
    lastEffectiveInputTokens: current.lastEffectiveInputTokens ?? previous?.lastEffectiveInputTokens,
    peakInputTokens: Math.max(previous?.peakInputTokens ?? 0, current.peakInputTokens ?? 0),
    peakEffectiveInputTokens: Math.max(previous?.peakEffectiveInputTokens ?? 0, current.peakEffectiveInputTokens ?? 0),
  };
  if (measuredReadTokens !== undefined) merged.cacheMeasuredReadTokens = measuredReadTokens;
  if (eligibleTokens !== undefined) merged.cacheEligibleTokens = eligibleTokens;
  if (measuredEligibleTokens !== undefined) merged.cacheMeasuredEligibleTokens = measuredEligibleTokens;
  if (hitRequests !== undefined) merged.cacheHitRequests = hitRequests;
  if (observedRequests !== undefined) merged.cacheObservedRequests = observedRequests;
  if (totalRequests !== undefined) merged.cacheTotalRequests = totalRequests;
  if (unknownRequests !== undefined) merged.cacheUnknownRequests = unknownRequests;
  if ((measuredEligibleTokens ?? 0) > 0) {
    merged.cacheHitRate = (measuredReadTokens ?? 0) / (measuredEligibleTokens ?? 1);
  }
  if (inputTokens > 0 && measuredReadTokens !== undefined) {
    merged.cacheInputReadRatio = measuredReadTokens / inputTokens;
  }
  if ((observedRequests ?? 0) > 0) {
    merged.cacheRequestHitRate = (hitRequests ?? 0) / (observedRequests ?? 1);
  }
  if ((totalRequests ?? 0) > 0) {
    merged.cacheUnknownRate = (unknownRequests ?? 0) / (totalRequests ?? 1);
  }
  return merged;
}

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined;
  return (left ?? 0) + (right ?? 0);
}

function normalizeTerminalPath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function tail(value: string): string {
  return value.length <= MAX_TERMINAL_PREVIEW ? value : value.slice(-MAX_TERMINAL_PREVIEW);
}

function normalizeAgentType(value: unknown): AgentType {
  return value === 'build' || value === 'review' || value === 'debug' || value === 'plan' ? value : 'chat';
}

function normalizeApprovalMode(value: unknown): SharedTuiSettings['approvalMode'] {
  return value === 'manual' || value === 'yolo' || value === 'smart' || value === 'notify' || value === 'session-trust' || value === 'custom'
    ? value
    : 'manual';
}

function normalizeIterations(value: number | null | undefined, settings: SharedTuiSettings): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.floor(value));
  return settings.interactionLimitEnabled ? Math.max(1, Math.floor(settings.maxIterations)) : null;
}

function normalizeThinkingConfig(value: ThinkingConfig): ThinkingConfig {
  return {
    enabled: value.enabled === true,
    ...(value.level ? { level: value.level } : {}),
    ...(value.mode ? { mode: value.mode } : {}),
    ...(typeof value.budgetTokens === 'number' && Number.isFinite(value.budgetTokens) ? { budgetTokens: Math.max(1, Math.floor(value.budgetTokens)) } : {}),
    ...(value.type ? { type: value.type } : {}),
    ...(value.display ? { display: value.display } : {}),
  };
}

function modelThinkingVariants(providerId: string, modelId: string) {
  const provider = getProviderRegistry().get(providerId);
  return provider?.models.find((model) => model.id === modelId)?.thinkingVariants;
}

function validateRequestedThinkingConfig(value: ThinkingConfig, providerId: string, modelId: string): ThinkingConfig {
  const normalized = normalizeThinkingConfig(value);
  if (!normalized.enabled) return normalized;

  const variants = modelThinkingVariants(providerId, modelId);
  if (!variants || variants.kind === 'none') {
    throw new Error(`Thinking is not supported by model "${modelId || 'the selected model'}".`);
  }
  if (normalized.level && (!variants.levels || !variants.levels.includes(normalized.level))) {
    throw new Error(`Thinking level "${normalized.level}" is not supported by model "${modelId}".`);
  }
  return normalized;
}

function normalizeStoredThinkingConfig(value: ThinkingConfig, providerId: string, modelId: string): ThinkingConfig {
  const normalized = normalizeThinkingConfig(value);
  if (!normalized.enabled) return normalized;

  const variants = modelThinkingVariants(providerId, modelId);
  if (!variants || variants.kind === 'none') return { enabled: false };
  if (normalized.level && (!variants.levels || !variants.levels.includes(normalized.level))) {
    return {
      enabled: false,
      ...(variants.defaultLevel ? { level: variants.defaultLevel } : {}),
    };
  }
  return normalized;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

type SidecarCommand = {
  program: string;
  args: string[];
  cwd: string;
};

function resolveCodexSidecar(repoRoot: string): SidecarCommand | null {
  const configured = process.env.HYSCODE_CODEX_SIDECAR;
  if (configured && existsSync(configured)) {
    return { program: configured, args: [], cwd: path.dirname(configured) };
  }

  const executableDirectory = path.dirname(process.execPath);
  const executableNames = process.platform === 'win32' ? ['codex-sidecar.exe', 'codex-sidecar'] : ['codex-sidecar'];
  for (const name of executableNames) {
    const candidate = path.join(executableDirectory, name);
    if (existsSync(candidate)) return { program: candidate, args: [], cwd: executableDirectory };
  }

  const repositoryBinary = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'binaries', process.platform === 'win32' ? 'codex-sidecar.exe' : 'codex-sidecar');
  if (existsSync(repositoryBinary)) return { program: repositoryBinary, args: [], cwd: path.dirname(repositoryBinary) };

  const source = path.join(repoRoot, 'packages', 'codex-sidecar', 'src', 'index.ts');
  if (existsSync(source)) return { program: process.env.BUN_BINARY || 'bun', args: [source], cwd: repoRoot };
  return null;
}

function normalizeSendParams(raw: Record<string, unknown>): SendMessageParams {
  const images = Array.isArray(raw.images) ? raw.images.filter((image): image is { base64: string; mediaType: string } => typeof image === 'object' && image !== null && typeof (image as Record<string, unknown>).base64 === 'string' && typeof (image as Record<string, unknown>).mediaType === 'string') : undefined;
  const ruleTargetPaths = Array.isArray(raw.ruleTargetPaths)
    ? raw.ruleTargetPaths.filter((target): target is string => typeof target === 'string' && target.trim().length > 0)
    : undefined;
  const contextAttachments = Array.isArray(raw.contextAttachments)
    ? raw.contextAttachments.filter((attachment): attachment is ContextAttachment => typeof attachment === 'object' && attachment !== null && typeof (attachment as Record<string, unknown>).id === 'string' && typeof (attachment as Record<string, unknown>).kind === 'string')
    : undefined;
  return {
    message: String(raw.message ?? ''),
    history: Array.isArray(raw.history) ? raw.history as Message[] : undefined,
    images,
    ruleTargetPaths,
    contextAttachments,
  };
}

function normalizeContextKind(value: unknown): ContextAttachment['kind'] {
  return value === 'directory' || value === 'terminal' || value === 'image' || value === 'text' ? value : 'file';
}

function isImagePath(filePath: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(path.extname(filePath).toLowerCase());
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return '<unserializable>';
  }
}

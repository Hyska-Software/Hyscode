import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  Harness,
  MemoryManager,
  RuleLoader,
  SkillLoader,
  getAgentTypes,
  type AgentQuestionAnswer,
  type AgentType,
  type HarnessEvent,
  type SddDatabase,
  type SddSession,
  type SddTask,
  type Skill,
  type TerminalAcquireRequest,
  type TerminalBinding,
  type TerminalRuntimeAdapter,
  type TerminalSnapshot,
  type ToolHandler,
  type ToolResult,
} from '@hyscode/agent-harness';
import {
  getProviderRegistry,
  type CodexInvoke,
  type Message,
  type StreamChunk,
  type ThinkingConfig,
} from '@hyscode/ai-providers';
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
import {
  pendingToolToInteraction,
  type BridgeEvent,
  type BridgeRequest,
  type BridgeResponse,
  type DiagnosticPayload,
  type InteractionRequest,
  type InteractionResolution,
  type ProjectSummary,
  type RuntimeReadyPayload,
  type SendMessageParams,
  type SessionRecord,
  type SetConfigParams,
} from './protocol';

type PendingInteraction = {
  kind: InteractionRequest['kind'];
  resolve: (resolution: InteractionResolution) => void;
};

type PendingHostRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type TerminalEntry = {
  binding: TerminalBinding;
  unsubscribe: (() => void) | null;
  isolationKey: string;
  sessionName?: string;
  activeToolCallId: string | null;
};

type BridgeOutput = (message: BridgeResponse | BridgeEvent) => void;

export class TuiBridge {
  private readonly dataStore: CliDataStore;
  private configStore: SharedConfigStore;
  private readonly keyStore: SharedKeyStore;
  private host: CliHost | null = null;
  private harness: Harness | null = null;
  private settings: SharedTuiSettings | null = null;
  private mcp: McpClientManager | null = null;
  private session: SessionRecord | null = null;
  private workspacePath = '';
  private projectId = '';
  private activeRun: Promise<unknown> | null = null;
  private activeTurnId: string | null = null;
  private activeTurnMessages: Message[] = [];
  private subAgentsInFlight = 0;
  private readonly subAgentWaiters: Array<() => void> = [];
  private readonly interactions = new Map<string, PendingInteraction>();
  private readonly hostRequests = new Map<string, PendingHostRequest>();
  private readonly terminals = new Map<string, TerminalEntry>();
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
        case 'send_message':
          return this.ok(request.id, await this.sendMessage(request.params ?? {}));
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
    if (configPath) {
      this.configStore = new SharedConfigStore(configPath);
    }
    await this.dataStore.load();
    await this.keyStore.load();
    this.settings = await this.configStore.load();
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

    this.host = new CliHost(workspacePath, this.dataStore, this.keyStore, (command, args) => this.requestHost(command, args));
    const skillLoader = this.createSkillLoader();
    const ruleLoader = this.createRuleLoader();
    const terminalRuntime = new CliTerminalRuntime(this.host, this.settings.terminalShell);
    const sddDb = this.createSddDatabase();
    this.harness = new Harness({
      workspacePath,
      projectId: this.projectId,
      invoke: (command, args) => this.requireHost().invoke(command, args),
      listen: (event, handler) => this.requireHost().listen(event, handler),
      onEvent: (event) => this.emitHarnessEvent(event),
      onApprovalRequest: (pending) => this.requestApproval(pending),
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
      },
    });

    this.harness.setAgentType(activeAgentType);
    this.harness.setMode(this.harness.getAgentType() === 'chat' ? 'chat' : 'agent');
    await this.harness.loadSkills();
    this.harness.setActiveSkills(this.activeSkillsFor(this.harness.getAgentType(), skillLoader));
    const rules = await ruleLoader.loadAll();
    this.harness.setActiveRules(rules.filter((rule) => rule.enabled));

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
    const ready = this.runtimeReady();
    this.emit({ type: 'event', event: 'runtime_ready', payload: ready });
    return ready;
  }

  private async sendMessage(rawParams: Record<string, unknown>): Promise<unknown> {
    const params = normalizeSendParams(rawParams);
    if (!this.harness) throw new Error('Runtime is not initialized.');
    if (this.activeRun) throw new Error('A turn is already running.');
    // The harness owns and mutates its working history while it runs. Keep it
    // isolated from the persisted session array so persistTurn can append the
    // completed turn exactly once.
    const history = [...(params.history ?? this.session?.messages ?? [])];
    this.activeTurnId = null;
    this.activeTurnMessages = [];
    const run = this.harness.run({ userMessage: params.message, history, images: params.images });
    this.activeRun = run;
    try {
      const outcome = await run;
      await this.persistTurn(params, outcome.response, outcome.turnRecord.tokenUsage);
      return outcome;
    } finally {
      this.activeRun = null;
      this.activeTurnId = null;
      this.activeTurnMessages = [];
    }
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

  private loadSession(id: string): SessionRecord | null {
    const session = this.dataStore.loadSession(id);
    if (session && this.harness) {
      this.session = session;
      this.harness.setConversationId(session.id);
      this.harness.setAgentType(session.agentType);
      this.harness.setMode(session.agentType === 'chat' ? 'chat' : 'agent');
    }
    return session;
  }

  private async newSession(): Promise<SessionRecord> {
    const harness = this.requireHarness();
    this.session = await this.dataStore.createSession(this.workspacePath, harness.getAgentType(), this.currentProviderId(), this.currentModelId());
    harness.setConversationId(this.session.id);
    this.emit({ type: 'event', event: 'session_updated', payload: this.session });
    return this.session;
  }

  private async shutdown(): Promise<void> {
    this.cancel();
    for (const pending of this.hostRequests.values()) pending.reject(new Error('Runtime host was shut down.'));
    this.hostRequests.clear();
    for (const terminal of this.terminals.values()) terminal.unsubscribe?.();
    this.terminals.clear();
    if (this.mcp) await Promise.all(this.mcp.listServers().map((server) => this.mcp?.disconnect(server.config.id)));
    await this.host?.shutdown();
  }

  private requestHost(command: string, params: Record<string, unknown>): Promise<unknown> {
    const requestId = `host-${crypto.randomUUID()}`;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.hostRequests.set(requestId, { resolve, reject });
    });
    this.emit({
      type: 'event',
      event: 'host_request',
      payload: { requestId, method: command, params },
    });
    return promise;
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

  private async persistTurn(params: SendMessageParams, response: string, tokenUsage: unknown): Promise<void> {
    if (!this.session) return;
    const userContent: Message['content'] = [
      { type: 'text', text: params.message },
      ...(params.images ?? []).map((image) => ({ type: 'image' as const, base64: image.base64, mediaType: image.mediaType })),
    ];
    const user = makeSessionMessage({ role: 'user', content: userContent });
    const turnMessages = this.activeTurnMessages.map((message, index, messages) => makeSessionMessage(
      message,
      index === messages.length - 1 && message.role === 'assistant'
        ? tokenUsage as SessionRecord['messages'][number]['tokenUsage']
        : undefined,
    ));
    const hasAssistantResponse = turnMessages.some((message) => message.role === 'assistant' && message.content.some((block) => block.type === 'text' && block.text === response));
    const messages = [...this.session.messages, user, ...turnMessages];
    if (response && !hasAssistantResponse) messages.push(makeSessionMessage({ role: 'assistant', content: [{ type: 'text', text: response }] }, tokenUsage as SessionRecord['messages'][number]['tokenUsage']));
    this.session = { ...this.session, messages, messageCount: messages.length, title: this.session.title === 'New session' ? params.message.slice(0, 80) : this.session.title, updatedAt: new Date().toISOString(), providerId: this.currentProviderId(), modelId: this.currentModelId(), agentType: this.requireHarness().getAgentType() };
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
          onEvent: (event) => this.emitHarnessEvent(event),
          externalTools: manager ? this.externalMcpTools(manager) : [],
        });
        child.setOwnerId(context.toolCallId);
        const release = await this.acquireSubAgentSlot(settings.subAgentMaxConcurrent);
        try {
          const result = await child.run({ userMessage: task, history: [] });
          return { success: result.status === 'complete', output: result.response, error: result.status === 'complete' ? undefined : result.status };
        } finally {
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

  private async requestApproval(pending: Parameters<NonNullable<ConstructorParameters<typeof Harness>[0]['onApprovalRequest']>>[0]): Promise<boolean> {
    const interaction = pendingToolToInteraction(pending);
    const resolution = await this.waitForInteraction(interaction);
    return resolution.approved === true;
  }

  private async requestModeSwitch(request: { id: string; fromMode: string; toMode: string; reason: string; contextSummary: string }): Promise<boolean> {
    const resolution = await this.waitForInteraction({ kind: 'mode_switch', requestId: request.id, fromMode: request.fromMode, toMode: request.toMode, reason: request.reason, contextSummary: request.contextSummary });
    return resolution.approved === true;
  }

  private async requestUserQuestions(id: string, questions: Parameters<NonNullable<ConstructorParameters<typeof Harness>[0]['onUserQuestionRequest']>>[1], title: string | undefined): Promise<AgentQuestionAnswer[]> {
    const resolution = await this.waitForInteraction({ kind: 'question', requestId: id, questions, ...(title ? { title } : {}) });
    return resolution.answers ?? [];
  }

  private waitForInteraction(interaction: InteractionRequest): Promise<InteractionResolution> {
    this.emit({ type: 'event', event: 'interaction', payload: interaction });
    return new Promise<InteractionResolution>((resolve) => {
      this.interactions.set(interaction.requestId, { kind: interaction.kind, resolve });
    });
  }

  private emitHarnessEvent(event: HarnessEvent): void {
    if (event.type === 'turn_start' && !this.activeTurnId) this.activeTurnId = event.turnId ?? null;
    if (event.type === 'transcript_message' && this.belongsToActiveTurn(event)) {
      this.activeTurnMessages.push({ role: event.role, content: event.blocks });
    }
    if (event.type === 'tool_call_pending') {
      const pending = event.pending;
      this.emit({ type: 'event', event: 'harness_event', payload: { ...event, pending: { id: pending.id, toolName: pending.toolName, input: pending.input, description: pending.description, riskLevel: pending.riskLevel } } as HarnessEvent });
      return;
    }
    this.emit({ type: 'event', event: 'harness_event', payload: event });
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

  private runtimeReady(): RuntimeReadyPayload {
    const harness = this.requireHarness();
    const registry = getProviderRegistry();
    const providers = registry.list().map((provider) => ({ id: provider.id, name: provider.name, configured: provider.isConfigured(), models: provider.models }));
    const models = providers.flatMap((provider) => provider.configured ? provider.models : []);
    return {
      protocolVersion: 1,
      workspacePath: this.workspacePath,
      projectId: this.projectId,
      providers,
      models,
      agentTypes: getAgentTypes(),
      modes: ['manual', 'yolo', 'smart', 'notify', 'session-trust', 'custom'],
      activeAgentType: harness.getAgentType(),
      activeProviderId: this.currentProviderId(),
      activeModelId: this.currentModelId(),
      activeThinking: normalizeStoredThinkingConfig(
        buildThinkingConfig(this.requireSettings(), this.currentProviderId(), this.currentModelId()) ?? { enabled: false },
        this.currentProviderId(),
        this.currentModelId(),
      ),
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
    return async function* (params): AsyncIterable<StreamChunk> {
      const repoRoot = process.env.HYSCODE_REPO_ROOT || process.cwd();
      const sidecar = resolveCodexSidecar(repoRoot);
      if (!sidecar) {
        yield { type: 'error', error: 'Codex sidecar was not found. Set HYSCODE_CODEX_SIDECAR or build the Codex sidecar.' };
        return;
      }
      const child = spawn(sidecar.program, sidecar.args, { cwd: sidecar.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const abort = () => child.kill();
      params.signal?.addEventListener('abort', abort, { once: true });
      child.stdin.end(JSON.stringify({ apiKey: params.apiKey, model: params.model, systemPrompt: params.systemPrompt, prompt: params.prompt, cwd: params.cwd, reasoningEffort: params.reasoningEffort, sandboxMode: params.sandboxMode }));
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
            if (event.type === 'text') yield { type: 'text_delta', text: String(event.content ?? '') };
            else if (event.type === 'thinking') yield { type: 'thinking_delta', text: String(event.content ?? '') };
            else if (event.type === 'tool_use') {
              const id = String(event.callId ?? crypto.randomUUID());
              yield { type: 'tool_call_start', id, name: String(event.toolName ?? 'tool') };
              if (typeof event.toolInput === 'string') yield { type: 'tool_call_delta', id, input: event.toolInput };
              yield { type: 'tool_call_end', id };
            }
            else if (event.type === 'message_boundary') yield { type: 'message_boundary' };
            else if (event.type === 'usage') yield { type: 'usage', usage: { inputTokens: Number(event.inputTokens ?? 0), outputTokens: Number(event.outputTokens ?? 0), totalTokens: Number(event.inputTokens ?? 0) + Number(event.outputTokens ?? 0), cacheReadTokens: Number(event.cacheReadTokens ?? 0), reasoningTokens: Number(event.reasoningTokens ?? 0) } };
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
  private readonly entries = new Map<string, TerminalEntry>();

  constructor(private readonly host: CliHost, private readonly configuredShell: string) {}

  async acquire(request: TerminalAcquireRequest): Promise<TerminalBinding> {
    const isolationKey = request.ownerId ?? request.conversationId;
    if (!request.forceNew) {
      for (const [terminalId, entry] of this.entries) {
        if (entry.isolationKey !== isolationKey) continue;
        if (request.sessionName && entry.sessionName !== request.sessionName) continue;
        if (entry.activeToolCallId && entry.activeToolCallId !== request.toolCallId) continue;
        const alive = await this.host.invoke<boolean>('pty_exists', { ptyId: entry.binding.ptyId }).catch(() => false);
        if (!alive) {
          this.entries.delete(terminalId);
          continue;
        }
        entry.activeToolCallId = request.toolCallId;
        return entry.binding;
      }
    }

    const terminalId = `terminal-${crypto.randomUUID()}`;
    const frameLanguage = process.platform === 'win32' ? 'powershell' : 'bash';
    const ptyId = await this.host.invoke<string>('pty_spawn', { id: terminalId, shell: this.configuredShell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/sh'), cwd: request.cwd, cols: 120, rows: 32 });
    const binding: TerminalBinding = { terminalId, ptyId, persistent: true, frameLanguage };
    this.entries.set(terminalId, {
      binding,
      unsubscribe: null,
      isolationKey,
      ...(request.sessionName ? { sessionName: request.sessionName } : {}),
      activeToolCallId: request.toolCallId,
    });
    return binding;
  }

  async snapshot(terminalId: string, afterSequence = 0): Promise<TerminalSnapshot> {
    const entry = this.entries.get(terminalId);
    if (!entry) throw new Error(`Terminal "${terminalId}" not found.`);
    const snapshot = await this.host.invoke<{ data: string; from_sequence: number; to_sequence: number; truncated: boolean; alive: boolean; exit_code: number | null }>('pty_snapshot', { ptyId: entry.binding.ptyId, afterSequence });
    return { data: snapshot.data, fromSequence: snapshot.from_sequence, toSequence: snapshot.to_sequence, truncated: snapshot.truncated, alive: snapshot.alive, exitCode: snapshot.exit_code };
  }

  async write(terminalId: string, data: string): Promise<void> {
    const entry = this.entries.get(terminalId);
    if (!entry) throw new Error(`Terminal "${terminalId}" not found.`);
    await this.host.invoke('pty_write', { ptyId: entry.binding.ptyId, data });
  }

  async interrupt(terminalId: string): Promise<void> {
    const entry = this.entries.get(terminalId);
    if (entry) await this.host.invoke('pty_interrupt', { ptyId: entry.binding.ptyId });
  }

  async kill(terminalId: string): Promise<void> {
    const entry = this.entries.get(terminalId);
    if (!entry) return;
    entry.unsubscribe?.();
    await this.host.invoke('pty_kill', { ptyId: entry.binding.ptyId });
    this.entries.delete(terminalId);
  }

  release(terminalId: string, toolCallId: string): void {
    const entry = this.entries.get(terminalId);
    if (!entry || (entry.activeToolCallId && entry.activeToolCallId !== toolCallId)) return;
    entry?.unsubscribe?.();
    if (entry) {
      entry.unsubscribe = null;
      entry.activeToolCallId = null;
    }
  }

  async subscribe(terminalId: string, onData: (data: string, sequence: number) => void, onExit: (exitCode: number | null) => void): Promise<() => void> {
    const entry = this.entries.get(terminalId);
    if (!entry) throw new Error(`Terminal "${terminalId}" not found.`);
    entry.unsubscribe?.();
    const unsubscribeData = await this.host.listen('pty:data', (payload) => {
      const event = payload as { pty_id?: string; data?: string; sequence?: number };
      if (event.pty_id === entry.binding.ptyId && typeof event.data === 'string') onData(event.data, event.sequence ?? 0);
    });
    const unsubscribeExit = await this.host.listen('pty:exit', (payload) => {
      const event = payload as { pty_id?: string; code?: number | null };
      if (event.pty_id === entry.binding.ptyId) onExit(event.code ?? null);
    });
    const unsubscribe = () => { unsubscribeData(); unsubscribeExit(); };
    entry.unsubscribe = unsubscribe;
    const replay = await this.snapshot(terminalId, 0);
    if (replay.data) onData(replay.data, replay.toSequence);
    return unsubscribe;
  }
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
  return { message: String(raw.message ?? ''), history: Array.isArray(raw.history) ? raw.history as Message[] : undefined, images };
}

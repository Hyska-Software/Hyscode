import { readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isSensitiveTerminalPrompt,
  normalizeTerminalOutput,
  projectTerminalProgress,
  projectTerminalRuntimeSummary,
  validateTerminalFailure,
  validateTerminalSnapshot,
} from '@hyscode/agent-harness';
import type { AgentType, FileChangePending, HarnessEvent, SddTask, TerminalSnapshot } from '@hyscode/agent-harness';
import type { Message, ThinkingConfig, TokenUsage } from '@hyscode/ai-providers';
import type {
  BridgeMessage,
  BridgeRequest,
  BridgeResponse,
  CliUpdater,
  DownloadedUpdate,
  GitSummary,
  InteractionRequest,
  ProjectSummary,
  RuntimeReadyPayload,
  SessionRecord,
  SddStatePayload,
  TerminalSummary,
  TuiBridge,
} from '@hyscode/tui-runtime';
import { BUILTIN_THEMES, CliUpdaterError, DEFAULT_THEME_ID, normalizeTerminalViewport } from '@hyscode/tui-runtime';
import { MODE_OPTIONS, commandArgument, matchingCommands, parseSlashCommand, resolveCommandName, selectionOptions } from './commands';
import { AGENT_TYPES } from './types';
import type { AgentTaskListItem, CliOptions, CommandFlow, ContextView, InteractionState, Key, MemoryView, RuleView, RuntimeNotice, SkillView, SubAgentView, ToolView, TranscriptItem, TranscriptKind, UiState } from './types';
import type { TerminalHandoffOutcome } from './terminal-handoff';
import { SUBAGENT_OUTPUT_CAP, SUBAGENT_THINKING_CAP, appendCappedText, createSubAgentView, mergeTokenUsage } from './subagent-state';

const SELECTION_PAGE_SIZE = 8;
const MOUSE_SCROLL_LINES = 3;
const EMPTY_GIT_SUMMARY: GitSummary = { available: false, branch: '', insertions: 0, deletions: 0, changedFiles: 0 };

export type RuntimeClient = Pick<TuiBridge, 'handle'>;

export type TuiControllerOptions = {
  updater?: CliUpdater;
  interactive?: boolean;
  onTerminalAttach?: (terminalId: string) => Promise<TerminalHandoffOutcome>;
};

export class TuiController {
  readonly state: UiState;
  private readonly pendingRequests = new Map<string, BridgeRequest['method']>();
  private readonly pendingRequestParams = new Map<string, Record<string, unknown>>();
  private nextRequestId = 1;
  private liveStreamStart: number | null = null;
  private gitRefreshInFlight = false;
  private readonly updater: CliUpdater | null;
  private readonly interactive: boolean;
  private readonly onTerminalAttach: ((terminalId: string) => Promise<TerminalHandoffOutcome>) | null;
  private startupUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private downloadedUpdate: DownloadedUpdate | null = null;
  private initialized = false;
  private updateOperation = 0;
  private readonly terminalRawOutput = new Map<string, string>();
  private readonly terminalOutputSequence = new Map<string, number>();
  private currentTurnId: string | null = null;
  private currentConversationId: string | null = null;

  constructor(readonly options: CliOptions, private readonly runtime: RuntimeClient, controllerOptions: TuiControllerOptions = {}) {
    this.updater = controllerOptions.updater ?? null;
    this.interactive = controllerOptions.interactive ?? true;
    this.onTerminalAttach = controllerOptions.onTerminalAttach ?? null;
    this.state = {
      input: '',
      inputCursor: 0,
      inputHistory: [],
      historyIndex: null,
      workspace: options.workspace,
      projectId: options.workspace,
      provider: options.provider ?? '',
      model: options.model ?? '',
      git: EMPTY_GIT_SUMMARY,
      themeId: DEFAULT_THEME_ID,
      themes: [...BUILTIN_THEMES],
      sidebarVisible: true,
      mode: options.mode ?? 'chat',
      sessionTitle: 'New session',
      sessionMessageCount: 0,
      tabs: [],
      thinking: { enabled: false },
      approvalMode: 'manual',
      status: 'Starting shared runtime…',
      running: false,
      shouldQuit: false,
      interaction: null,
      transcript: [],
      tools: [],
      fileChanges: [],
      context: emptyContext(),
      terminals: [],
      activeTerminalId: null,
      terminalInput: null,
      sdd: emptySdd(),
      selectedSubagent: 0,
      subagentDetail: null,
      agentTasks: [],
      subagents: [],
      usage: emptyUsage(),
      notices: [],
      updates: emptyUpdates(),
      connectionState: 'connecting',
      recovery: null,
      mainPanel: 'chat',
      capabilities: null,
      rules: [],
      skills: [],
      memories: [],
      scroll: 0,
      lastError: null,
      currentSessionId: null,
      sessions: [],
      projects: [],
      providers: [],
      models: [],
      overlay: 'none',
      overlayIndex: 0,
      commandFlow: null,
      focus: 'composer',
      width: 120,
      height: 32,
    };
    this.updater?.setProgressListener((progress) => {
      this.state.updates.progress = progress;
    });
  }

  async start(): Promise<void> {
    await this.request('initialize', {
      workspacePath: this.options.workspace,
      projectId: this.options.workspace,
      ...(this.options.provider ? { providerId: this.options.provider } : {}),
      ...(this.options.model ? { modelId: this.options.model } : {}),
      ...(this.options.mode ? { agentType: this.options.mode } : {}),
      ...(this.options.configPath ? { configPath: this.options.configPath } : {}),
    });
    this.initialized = true;
    if (this.interactive && this.updater && this.state.updates.checkForUpdatesOnStartup) {
      this.startupUpdateTimer = setTimeout(() => { void this.checkForUpdates(true); }, 3000);
    }
  }

  async shutdown(): Promise<void> {
    if (this.startupUpdateTimer) {
      clearTimeout(this.startupUpdateTimer);
      this.startupUpdateTimer = null;
    }
    if (!this.initialized) return;
    await this.request('shutdown', {});
  }

  async refreshGitSummary(): Promise<void> {
    if (this.gitRefreshInFlight) return;
    this.gitRefreshInFlight = true;
    try {
      const result = await this.request('git_summary', {});
      const summary = result as Partial<GitSummary>;
      if (typeof summary.available !== 'boolean' || typeof summary.branch !== 'string') return;
      this.state.git = {
        available: summary.available,
        branch: summary.branch,
        insertions: typeof summary.insertions === 'number' ? summary.insertions : 0,
        deletions: typeof summary.deletions === 'number' ? summary.deletions : 0,
        changedFiles: typeof summary.changedFiles === 'number' ? summary.changedFiles : 0,
      };
    } catch {
      return;
    } finally {
      this.gitRefreshInFlight = false;
    }
  }

  async handleKey(key: Key): Promise<void> {
    if (key.type === 'mouse') {
      await this.handleMouseWheel(key);
      return;
    }
    if (this.state.interaction) {
      await this.handleInteractionKey(key, this.state.interaction);
      return;
    }
    if (this.state.commandFlow) {
      await this.handleCommandFlowKey(key);
      return;
    }
    if (this.state.overlay !== 'none') {
      await this.handleOverlayKey(key);
      return;
    }

    if (key.type === 'ctrl') {
      if (key.value === 'k') {
        this.openCommandPalette('/');
      } else if (key.value === 't') {
        await this.cycleThinking();
      } else if (key.value === 'c') {
        if (this.state.terminalInput) {
          await this.request('terminal_interrupt', { terminalId: this.state.terminalInput.terminalId });
          this.state.terminalInput = null;
          this.clearInput();
          this.state.status = 'Terminal interrupt requested';
        } else if (this.state.running) {
          await this.request('cancel', {});
          this.state.status = 'Cancellation requested';
        } else if (this.state.input) {
          this.clearInput();
        } else {
          this.state.shouldQuit = true;
        }
      } else if (key.value === 'o') {
        this.toggleLastToolExpansion();
      } else if (key.value === 'u') {
        this.state.input = this.state.input.slice(this.state.inputCursor);
        this.state.inputCursor = 0;
        this.syncCommandPalette();
      } else if (key.value === 'w') {
        this.deletePreviousWord();
      }
      return;
    }

    switch (key.type) {
      case 'character':
        this.insertText(key.value);
        break;
      case 'enter':
        if (this.panelSelectionActive()) this.togglePanelDetail();
        else await this.submitInput();
        break;
      case 'shift_enter':
        this.insertText('\n');
        break;
      case 'backspace':
        this.deletePreviousCharacter();
        break;
      case 'delete':
        this.deleteNextCharacter();
        break;
      case 'left':
        this.state.inputCursor = Math.max(0, this.state.inputCursor - 1);
        break;
      case 'right':
        this.state.inputCursor = Math.min(Array.from(this.state.input).length, this.state.inputCursor + 1);
        break;
      case 'home':
        if (this.state.focus === 'transcript') this.state.scroll = Number.MAX_SAFE_INTEGER;
        else this.state.inputCursor = 0;
        break;
      case 'end':
        if (this.state.focus === 'transcript') this.state.scroll = 0;
        else this.state.inputCursor = Array.from(this.state.input).length;
        break;
      case 'up':
        this.moveUp();
        break;
      case 'down':
        this.moveDown();
        break;
      case 'page_up':
        this.state.scroll += this.scrollPageLines();
        break;
      case 'page_down':
        this.state.scroll = Math.max(0, this.state.scroll - this.scrollPageLines());
        break;
      case 'tab':
        if (!this.state.sidebarVisible) {
          this.state.focus = this.state.focus === 'transcript' ? 'composer' : 'transcript';
        } else {
          this.state.focus = this.state.focus === 'composer' ? 'sidebar' : this.state.focus === 'sidebar' ? 'transcript' : 'composer';
        }
        break;
      case 'shift_tab':
        await this.cycleMode();
        break;
      case 'escape':
        if (this.closePanelDetail()) {
          this.state.status = 'Returned to list';
        } else {
          this.clearInput();
          this.state.status = 'Input cleared';
        }
        break;
      case 'f1':
        this.state.overlay = 'help';
        break;
    }
  }

  handleRuntimeMessage(message: BridgeMessage): void {
    if (message.type === 'response') {
      this.handleResponse(message);
      return;
    }
    switch (message.event) {
      case 'runtime_ready':
        this.applyRuntimeReady(message.payload);
        break;
      case 'harness_event':
        this.applyHarnessEvent(message.payload);
        break;
      case 'scoped_harness_event':
        this.applyScopedHarnessEvent(message.payload.ownerId, message.payload.event);
        break;
      case 'terminal_updated':
        this.applyTerminalUpdated(message.payload);
        break;
      case 'context_updated':
        this.applyContext(message.payload);
        break;
      case 'file_change_updated':
        this.applyFileChangeState(message.payload);
        break;
      case 'sdd_updated':
        this.applySdd(message.payload);
        break;
      case 'interaction':
        this.applyInteraction(message.payload);
        break;
      case 'diagnostic':
        this.applyDiagnostic(message.payload.level, message.payload.message);
        break;
      case 'session_updated':
        this.applySession(message.payload);
        break;
      case 'fatal':
        this.append('error', message.payload.message);
        this.state.lastError = message.payload.message;
        this.state.running = false;
        break;
      case 'host_request':
        this.append('error', 'The runtime emitted an unsupported remote host request.');
        break;
    }
  }

  private async request(method: BridgeRequest['method'], params: Record<string, unknown>): Promise<unknown> {
    const id = `tui-${method}-${this.nextRequestId}`;
    this.nextRequestId += 1;
    this.pendingRequests.set(id, method);
    this.pendingRequestParams.set(id, params);
    try {
      const response = await this.runtime.handle({ id, method, params });
      this.handleRuntimeMessage(response);
      if (!response.ok) throw new Error(response.error);
      return response.result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pendingRequests.delete(id);
      this.pendingRequestParams.delete(id);
      this.state.lastError = message;
      this.state.running = false;
      this.append('error', message);
      throw error;
    }
  }

  private handleResponse(response: BridgeResponse): void {
    const method = this.pendingRequests.get(response.id);
    this.pendingRequests.delete(response.id);
    const requestParams = this.pendingRequestParams.get(response.id) ?? {};
    this.pendingRequestParams.delete(response.id);
    if (!response.ok) {
      this.state.lastError = response.error;
      this.state.running = false;
      this.state.status = 'Runtime request failed';
      this.append('error', response.error);
      return;
    }
    this.state.lastError = null;
    switch (method) {
      case 'initialize':
      case 'set_mode':
      case 'set_config':
      case 'project_switch':
        if (method === 'project_switch') this.state.tabs = [];
        this.applyRuntimeReady(response.result as RuntimeReadyPayload);
        break;
      case 'session_list':
        this.applySessionList(response.result);
        break;
      case 'project_list':
        this.applyProjectList(response.result);
        break;
      case 'diagnostics':
        this.applyDiagnostics(response.result);
        break;
      case 'context_attach':
      case 'context_remove':
      case 'context_clear':
      case 'context_list':
        this.applyContext(response.result);
        break;
      case 'rules_list':
        this.state.mainPanel = 'activity';
        this.state.rules = (Array.isArray(asRecord(response.result).rules) ? asRecord(response.result).rules : []) as RuleView[];
        this.state.status = `${this.state.rules.length} rule(s) loaded`;
        break;
      case 'skills_list':
        this.state.mainPanel = 'activity';
        this.state.skills = (Array.isArray(response.result) ? response.result : []) as SkillView[];
        this.state.status = `${this.state.skills.length} skill(s) loaded`;
        break;
      case 'memory_list':
        this.state.mainPanel = 'activity';
        this.state.memories = (Array.isArray(response.result) ? response.result : []) as MemoryView[];
        this.state.status = `${this.state.memories.length} active memory item(s)`;
        break;
      case 'terminal_open':
      case 'terminal_list':
        this.applyTerminals(response.result);
        if (method === 'terminal_open') this.state.mainPanel = 'terminal';
        break;
      case 'terminal_snapshot':
        this.applyTerminalSnapshot(response.result, requestParams);
        break;
      case 'file_change_resolve':
      case 'file_change_resolve_all':
        this.state.status = 'File review updated';
        break;
      case 'sdd_start':
      case 'sdd_action':
        this.applySdd(response.result as SddStatePayload);
        this.state.mainPanel = 'sdd';
        break;
      case 'session_delete':
      case 'session_rename':
        if (method === 'session_delete' && typeof requestParams.id === 'string') {
          this.state.tabs = this.state.tabs.filter((tab) => tab.sessionId !== requestParams.id);
        }
        if (method === 'session_rename' && typeof requestParams.title === 'string') {
          this.state.tabs = this.state.tabs.map((tab) => tab.sessionId === requestParams.id ? { ...tab, title: requestParams.title as string } : tab);
        }
        this.state.status = method === 'session_delete' ? 'Session deleted' : 'Session renamed';
        break;
      case 'session_export':
        this.state.status = `Session exported to ${asRecord(response.result).path ?? 'workspace'}`;
        break;
      case 'trace_list':
        this.state.status = 'Trace loaded';
        break;
      case 'session_load':
      case 'session_new':
        this.applySession(response.result as SessionRecord);
        if (method === 'session_new') this.state.status = 'New session';
        break;
      case 'send_message':
        this.state.running = false;
        break;
      case 'shutdown':
        this.state.status = 'Runtime stopped';
        break;
      default:
        break;
    }
  }

  private applyRuntimeReady(payload: RuntimeReadyPayload): void {
    this.state.workspace = payload.workspacePath;
    this.state.projectId = payload.projectId;
    this.currentConversationId = payload.session?.id ?? this.currentConversationId;
    this.state.mode = payload.activeAgentType;
    this.state.provider = payload.activeProviderId;
    this.state.model = payload.activeModelId;
    if (payload.git) this.state.git = payload.git;
    this.state.themeId = payload.activeThemeId ?? this.state.themeId;
    if (payload.themes && payload.themes.length > 0) this.state.themes = payload.themes;
    if (payload.recentSessions) this.state.sessions = payload.recentSessions;
    this.state.sidebarVisible = payload.sidebarVisible ?? this.state.sidebarVisible;
    if (!this.state.sidebarVisible && this.state.focus === 'sidebar') this.state.focus = 'composer';
    if (payload.updates) {
      this.state.updates.channel = payload.updates.channel;
      this.state.updates.checkForUpdatesOnStartup = payload.updates.checkForUpdatesOnStartup;
      this.state.updates.autoDownload = payload.updates.autoDownload;
    }
    this.state.approvalMode = payload.approvalMode ?? this.state.approvalMode;
    this.state.thinking = {
      enabled: payload.activeThinking.enabled === true,
      ...(payload.activeThinking.level ? { level: payload.activeThinking.level } : {}),
    };
    this.state.providers = payload.providers;
    this.state.models = payload.models;
    this.state.usage.contextWindow = payload.models.find((model) => model.provider === payload.activeProviderId && model.id === payload.activeModelId)?.contextWindow ?? 0;
    this.state.capabilities = payload.capabilities ?? null;
    if (payload.session) {
      this.state.connectionState = 'connected';
      this.applySession(payload.session);
    }
    if (payload.context) this.applyContext(payload.context);
    if (payload.sdd) this.applySdd(payload.sdd);
    if (Array.isArray(payload.terminals)) {
      const merged = new Map<string, TerminalSummary>();
      for (const value of payload.terminals) {
        const terminal = normalizeTerminalSummary(value);
        if (!terminal) {
          this.append('error', 'Runtime terminal summary was invalid');
          continue;
        }
        this.mergeTerminal(merged, terminal);
        this.terminalOutputSequence.set(terminal.terminalId, terminal.sequence);
      }
      this.state.terminals = [...merged.values()];
      if (this.state.activeTerminalId && !merged.has(this.state.activeTerminalId)) this.state.activeTerminalId = null;
      if (!this.state.activeTerminalId) this.state.activeTerminalId = this.state.terminals[0]?.terminalId ?? null;
    }
    this.state.status = this.state.provider ? `Ready · thinking ${this.thinkingLabel()}` : 'No configured provider';
  }

  private applySession(session: SessionRecord): void {
    if (!session?.id) return;
    this.state.currentSessionId = session.id;
    this.currentConversationId = session.id;
    this.currentTurnId = null;
    this.state.sessionTitle = session.title || 'Untitled session';
    this.state.sessionMessageCount = session.messageCount;
    this.state.tabs = [
      ...this.state.tabs.filter((tab) => tab.sessionId !== session.id).map((tab) => ({ ...tab, active: false })),
      { id: `tab-${session.id}`, title: session.title || 'Untitled session', sessionId: session.id, active: true },
    ];
    this.state.transcript = [];
    this.state.tools = [];
    this.state.fileChanges = [];
    this.state.subagents = [];
    this.state.selectedSubagent = 0;
    this.state.subagentDetail = null;
    this.state.agentTasks = [];
    this.state.sdd = emptySdd();
    this.state.terminalInput = null;
    this.terminalRawOutput.clear();
    this.terminalOutputSequence.clear();
    this.liveStreamStart = null;
    const replayedToolIds = new Set<string>();
    for (const message of session.messages) {
      if (message.role === 'user') {
        const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
        if (text) this.append('user', text);
      } else {
        for (const item of this.contentItems(message.content, replayedToolIds)) this.appendItem(item);
      }
    }
    for (const tool of this.state.tools) {
      if (!replayedToolIds.has(tool.id)) continue;
      if (tool.status === 'running' || tool.status === 'pending') tool.status = 'cancelled';
    }
    if (this.state.tools.length > REPLAYED_TOOL_LIMIT) this.state.tools = this.state.tools.slice(-REPLAYED_TOOL_LIMIT);
    this.state.scroll = 0;
  }

  private contentItems(content: Message['content'], replayedToolIds?: Set<string>): TranscriptItem[] {
    return content.flatMap((block): TranscriptItem[] => {
      switch (block.type) {
        case 'text': return [{ kind: 'assistant', text: block.text }];
        case 'thinking': return [{ kind: 'thinking', text: block.thinking }];
        case 'tool_call': {
          replayedToolIds?.add(block.id);
          this.upsertTool({
            id: block.id,
            name: block.name,
            input: block.input,
            status: 'running',
            liveOutput: '',
            outputSequence: 0,
            expanded: false,
          });
          return [{ kind: 'tool', text: summarizeToolInput(block.name, block.input), toolId: block.id }];
        }
        case 'tool_result': {
          const existing = this.state.tools.some((tool) => tool.id === block.toolCallId);
          if (existing) {
            this.updateTool(block.toolCallId, {
              status: block.isError ? 'error' : 'success',
              output: block.output,
            });
            return [];
          }
          return [{ kind: 'result', text: block.output }];
        }
        case 'image': return [];
      }
    });
  }

  private applySessionList(result: unknown): void {
    this.state.sessions = Array.isArray(result) ? result as SessionRecord[] : [];
    this.state.overlayIndex = Math.min(this.state.overlayIndex, Math.max(0, this.state.sessions.length - 1));
    this.state.status = this.state.sessions.length ? `${this.state.sessions.length} saved session(s)` : 'No saved sessions for this workspace';
  }

  private applyProjectList(result: unknown): void {
    this.state.projects = Array.isArray(result) ? result as ProjectSummary[] : [];
    this.state.overlayIndex = Math.min(this.state.overlayIndex, Math.max(0, this.state.projects.length - 1));
    this.state.status = this.state.projects.length ? `${this.state.projects.length} project(s) available` : 'No saved projects';
  }

  private applyDiagnostics(result: unknown): void {
    if (!Array.isArray(result)) {
      this.append('error', 'Diagnostics response was invalid');
      return;
    }
    if (result.length === 0) {
      this.append('system', 'No diagnostics found.');
      return;
    }
    for (const value of result) {
      const diagnostic = asRecord(value);
      const file = stringValue(diagnostic.file, 'workspace');
      const line = numberValue(diagnostic.line, 1);
      const column = numberValue(diagnostic.col, 1);
      const severity = stringValue(diagnostic.severity, 'error');
      const message = stringValue(diagnostic.message, 'diagnostic');
      this.append(severity === 'error' ? 'error' : 'system', `${file}:${line}:${column} [${severity}] ${message}`);
    }
  }

  private applyContext(payload: unknown): void {
    const value = asRecord(payload);
    const attachments = Array.isArray(value.attachments) ? value.attachments : [];
    const gathered = Array.isArray(value.gathered) ? value.gathered : [];
    this.state.context = {
      attachments: attachments as ContextView['attachments'],
      gathered: gathered as ContextView['gathered'],
      gatheredTokens: numberValue(value.gatheredTokens, 0),
      activeRulePaths: stringArray(value.activeRulePaths),
      activeSkillNames: stringArray(value.activeSkillNames),
      capabilities: this.state.capabilities,
    };
  }

  private applyTerminals(result: unknown): void {
    const values = Array.isArray(result) ? result : [result];
    const terminals: TerminalSummary[] = [];
    for (const value of values) {
      const terminal = normalizeTerminalSummary(value);
      if (!terminal) {
        this.append('error', 'Runtime terminal summary was invalid');
        continue;
      }
      terminals.push(terminal);
    }
    if (Array.isArray(result)) {
      const merged = new Map(this.state.terminals.map((terminal) => [terminal.terminalId, terminal]));
      for (const terminal of terminals) this.mergeTerminal(merged, terminal);
      this.state.terminals = [...merged.values()];
    }
    else {
      const next = terminals[0];
      if (next) {
        const merged = new Map(this.state.terminals.map((terminal) => [terminal.terminalId, terminal]));
        this.mergeTerminal(merged, next);
        this.state.terminals = [...merged.values()];
        this.state.activeTerminalId = next.terminalId;
      }
    }
    for (const terminal of terminals) this.applyTerminalRuntimeSummary(terminal);
  }

  private applyTerminalSnapshot(result: unknown, requestParams: Record<string, unknown>): void {
    const snapshotRecord = asRecord(result);
    let snapshot: TerminalSnapshot;
    try {
      snapshot = validateTerminalSnapshot(snapshotRecord);
    } catch (error) {
      this.append('error', error instanceof Error ? error.message : String(error));
      return;
    }
    const terminalId = stringValue(snapshotRecord.terminalId, this.state.activeTerminalId ?? '');
    const terminal = this.state.terminals.find((candidate) => candidate.terminalId === terminalId);
    if (!terminal) return;
    const data = snapshot.data;
    const snapshotIsFinal = !snapshot.alive || Boolean(snapshot.failure);
    if (snapshot.toSequence < terminal.sequence && !snapshotIsFinal) return;
    const afterSequence = numberValue(requestParams.afterSequence, 0);
    if (afterSequence === 0 && snapshot.toSequence >= terminal.sequence) {
      terminal.outputPreview = normalizeTerminalOutput(data, 4_000);
    }
    terminal.sequence = Math.max(terminal.sequence, snapshot.toSequence);
    this.terminalOutputSequence.set(terminalId, Math.max(this.terminalOutputSequence.get(terminalId) ?? 0, snapshot.toSequence));
    const wasDead = !terminal.alive;
    terminal.alive = wasDead ? false : snapshot.alive && !snapshot.failure;
    if (snapshot.exitCode !== null || terminal.exitCode === null) terminal.exitCode = snapshot.exitCode;
    terminal.failure ??= snapshot.failure;
    terminal.truncated = snapshot.truncated || terminal.truncated;
    if (!terminal.alive || terminal.failure) {
      terminal.activeToolCallId = null;
      terminal.awaitingInput = false;
    }
    if (snapshot.failure) {
      this.state.status = `Terminal failed · ${snapshot.failure.message}`;
    } else if (!snapshot.alive || wasDead) {
      this.state.status = 'Terminal exited';
    }
    this.applyTerminalRuntimeSummary(terminal);
  }

  private applyTerminalRuntimeSummary(terminal: TerminalSummary): void {
    if (terminal.alive && !terminal.failure) return;
    const tool = [...this.state.tools]
      .reverse()
      .find((candidate) => {
        if (candidate.terminalId !== terminal.terminalId || candidate.terminalCanonical) return false;
        return candidate.status === 'running'
          || candidate.terminalState === 'started'
          || candidate.terminalState === 'running'
          || candidate.terminalState === 'awaiting_input';
      });
    if (!tool) return;
    const projection = projectTerminalRuntimeSummary(
      {
        terminalId: tool.terminalId,
        terminalState: tool.terminalState,
        outputSequence: tool.outputSequence,
        liveOutput: tool.liveOutput,
        failure: tool.failure,
        provisional: tool.terminalProvisional,
        canonical: tool.terminalCanonical,
      },
      {
        terminalId: terminal.terminalId,
        sequence: terminal.sequence,
        alive: terminal.alive,
        exitCode: terminal.exitCode ?? null,
        failure: terminal.failure,
      },
    );
    if (!projection) return;
    this.updateTool(tool.id, {
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
  }

  private applyTerminalUpdated(payload: unknown): void {
    const item = asRecord(payload);
    const terminal = normalizeTerminalSummary(item.terminal);
    if (!terminal) {
      this.append('error', 'Runtime terminal update was invalid');
      return;
    }
    const turnId = typeof item.turnId === 'string' ? item.turnId : null;
    const conversationId = typeof item.conversationId === 'string' ? item.conversationId : null;
    if (turnId && this.currentTurnId && turnId !== this.currentTurnId) return;
    if (conversationId && this.currentConversationId && conversationId !== this.currentConversationId) return;
    if (terminal.ownerConversationId && this.currentConversationId && terminal.ownerConversationId !== this.currentConversationId) return;
    const cause = item.cause === 'created' || item.cause === 'output' || item.cause === 'state' || item.cause === 'exit'
      ? item.cause
      : null;
    if (!cause) {
      this.append('error', 'Runtime terminal update cause was invalid');
      return;
    }
    const current = this.state.terminals.find((entry) => entry.terminalId === terminal.terminalId);
    const samePty = current?.ptyId === terminal.ptyId;
    const previousSequence = samePty
      ? this.terminalOutputSequence.get(terminal.terminalId) ?? 0
      : 0;
    const terminalIsFinal = !terminal.alive || Boolean(terminal.failure);
    if (samePty && terminal.sequence < previousSequence && !terminalIsFinal) return;
    if (samePty && current && !current.alive && terminal.alive && !terminal.failure) return;
    const merged = new Map(this.state.terminals.map((entry) => [entry.terminalId, entry]));
    this.mergeTerminal(merged, terminal);
    this.state.terminals = [...merged.values()];
    this.terminalOutputSequence.set(
      terminal.terminalId,
      Math.max(this.terminalOutputSequence.get(terminal.terminalId) ?? 0, terminal.sequence),
    );
    if (!this.state.activeTerminalId) this.state.activeTerminalId = terminal.terminalId;
    if (
      terminal.awaitingInput
      && terminal.role === 'agent'
      && !terminal.ownerId
      && terminal.canUserWrite !== false
      && this.state.approvalMode !== 'yolo'
    ) {
      this.state.terminalInput = {
        terminalId: terminal.terminalId,
        masked: isSensitiveTerminalPrompt(terminal.outputPreview),
      };
      this.state.status = 'Terminal input required';
    }
    if (!terminal.awaitingInput && this.state.terminalInput?.terminalId === terminal.terminalId) {
      this.state.terminalInput = null;
      this.clearInput();
    }
    if (cause === 'exit' && this.state.terminalInput?.terminalId === terminal.terminalId) {
      this.state.terminalInput = null;
      this.clearInput();
    }
    this.applyTerminalRuntimeSummary(terminal);
    if (terminal.failure) this.state.status = `Terminal failed · ${terminal.failure.message}`;
    else if (cause === 'exit') this.state.status = 'Terminal exited';
  }

  private mergeTerminal(target: Map<string, TerminalSummary>, next: TerminalSummary): void {
    const current = target.get(next.terminalId);
    const samePty = current?.ptyId === next.ptyId;
    const staleFinal = Boolean(
      current
      && samePty
      && next.sequence < current.sequence
      && (!next.alive || next.failure),
    );
    if (current && samePty && next.sequence < current.sequence && !staleFinal) return;
    if (current && samePty && !current.alive && next.alive && !next.failure) return;
    const exitCode = samePty
      && current?.exitCode !== undefined
      && (next.exitCode === undefined || next.exitCode === null)
      ? current.exitCode
      : next.exitCode;
    target.set(next.terminalId, {
      ...current,
      ...next,
      sequence: Math.max(current?.sequence ?? 0, next.sequence),
      ...(exitCode !== undefined ? { exitCode } : {}),
      alive: samePty && current && !current.alive ? false : next.alive && !next.failure,
      failure: samePty && current?.failure && !next.failure ? current.failure : next.failure,
      outputPreview: normalizeTerminalOutput(
        staleFinal ? current?.outputPreview ?? next.outputPreview : next.outputPreview ?? current?.outputPreview ?? '',
        4_000,
      ),
    });
    this.terminalOutputSequence.set(
      next.terminalId,
      Math.max(
        this.terminalOutputSequence.get(next.terminalId) ?? 0,
        current?.sequence ?? 0,
        next.sequence,
      ),
    );
  }

  private applySdd(payload: SddStatePayload): void {
    this.state.sdd = {
      ...payload,
      expandedTask: this.state.sdd.sessionId === payload.sessionId ? this.state.sdd.expandedTask : false,
      selectedTask: Math.min(this.state.sdd.selectedTask, Math.max(0, payload.tasks.length - 1)),
    };
    if (payload.phase) this.state.status = `SDD · ${payload.phase}`;
  }

  private applyFileChangeState(payload: { toolCallId: string; toolName: string; filePath: string; originalContent: string | null; newContent: string; status: 'pending' | 'accepted' | 'rejected' }): void {
    const existing = this.state.fileChanges.find((change) => change.toolCallId === payload.toolCallId);
    if (existing) Object.assign(existing, payload);
    else this.state.fileChanges.push({ ...payload, expanded: false });
  }

  private applyInteraction(payload: InteractionRequest): void {
    this.state.overlay = 'none';
    this.state.commandFlow = null;
    if (payload.kind === 'approval') {
      this.state.interaction = {
        kind: 'approval',
        requestId: payload.requestId,
        toolName: payload.toolCall.toolName,
        description: payload.toolCall.description,
        risk: payload.toolCall.riskLevel ?? 'moderate',
        input: payload.toolCall.input,
        toolCallId: payload.toolCall.id,
        ...(payload.toolCall.externalAccess
          ? { externalAccess: payload.toolCall.externalAccess }
          : {}),
      };
      this.state.status = payload.toolCall.externalAccess
        ? 'External access required · y allow once · d allow directory · n deny'
        : 'Approval required · y allow · n deny · t trust tool';
    } else if (payload.kind === 'mode_switch') {
      this.state.interaction = {
        kind: 'mode_switch',
        requestId: payload.requestId,
        from: payload.fromMode,
        to: payload.toMode,
        reason: payload.reason,
        contextSummary: payload.contextSummary,
      };
      this.state.status = 'Mode switch requested · y allow · n deny';
    } else {
      this.state.interaction = {
        kind: 'question',
        requestId: payload.requestId,
        title: payload.title ?? 'Agent question',
        questions: payload.questions,
        questionIndex: 0,
        selectedOption: 0,
        answers: [],
      };
      this.state.status = 'Answer required';
    }
  }

  private applyDiagnostic(level: 'info' | 'warning' | 'error', message: string): void {
    if (level === 'error') this.append('error', message);
    else if (message) this.state.status = message;
  }

  private applyScopedHarnessEvent(ownerId: string, event: HarnessEvent): void {
    this.applyHarnessEvent(event, ownerId);
  }

  private applyHarnessEvent(event: HarnessEvent, ownerId: string | null = null): void {
    switch (event.type) {
      case 'turn_start':
        if (ownerId) {
          this.upsertSubAgent(ownerId, { status: 'running', startedAt: Date.now() });
        } else {
          this.currentTurnId = event.turnId ?? null;
          this.currentConversationId = event.conversationId ?? this.currentConversationId;
          this.state.running = true;
          this.liveStreamStart = this.state.transcript.length;
          this.state.status = `Working · iteration ${event.iteration}`;
        }
        break;
      case 'stream_chunk':
        if (ownerId) {
          if (event.chunk.type === 'text_delta') this.upsertSubAgent(ownerId, { outputAppend: event.chunk.text });
          else if (event.chunk.type === 'thinking_delta') this.upsertSubAgent(ownerId, { thinkingAppend: event.chunk.text });
          else if (event.chunk.type === 'usage') this.upsertSubAgent(ownerId, { usageMerge: event.chunk.usage });
        } else if (event.chunk.type === 'text_delta') this.appendLive('assistant', event.chunk.text);
        else if (event.chunk.type === 'thinking_delta') this.appendLive('thinking', event.chunk.text);
        else if (event.chunk.type === 'usage') this.applyUsage(event.chunk.usage);
        else if (event.chunk.type === 'error') this.append('error', event.chunk.error);
        break;
      case 'transcript_message':
        if (event.role === 'assistant') {
          if (this.liveStreamStart !== null) this.state.transcript.splice(this.liveStreamStart);
          this.liveStreamStart = this.state.transcript.length;
          for (const item of this.contentItems(event.blocks)) this.appendItem(item);
        } else {
          for (const item of this.contentItems(event.blocks)) this.appendItem(item);
        }
        break;
      case 'assistant_segment_end':
        this.liveStreamStart = this.state.transcript.length;
        break;
      case 'tool_call_start':
        this.upsertTool({
          id: event.toolCallId,
          name: event.toolName,
          input: event.input,
          status: 'running',
          liveOutput: '',
          outputSequence: 0,
          expanded: false,
          ...(ownerId ? { ownerId } : {}),
        });
        if (ownerId) {
          this.upsertSubAgent(ownerId, { toolId: event.toolCallId });
        } else {
          if (event.toolName === 'spawn_subagent') {
            this.upsertSubAgent(event.toolCallId, {
              mode: stringValue(event.input.mode, 'review'),
              task: stringValue(event.input.task, 'Delegated task'),
              toolId: event.toolCallId,
            });
          }
          this.appendItem({ kind: 'tool', text: summarizeToolInput(event.toolName, event.input), toolId: event.toolCallId });
        }
        break;
      case 'tool_call_pending':
        this.upsertTool({
          id: event.pending.id,
          name: event.pending.toolName,
          input: event.pending.input,
          description: event.pending.description,
          status: 'pending',
          liveOutput: '',
          outputSequence: 0,
          expanded: false,
          ...(ownerId ? { ownerId } : {}),
        });
        this.state.status = `Approval required for ${event.pending.toolName}`;
        break;
      case 'tool_call_notification':
        this.updateTool(event.toolCallId, { description: event.description, status: 'approved' });
        this.state.status = event.description;
        break;
      case 'tool_call_result': {
        const resultMetadata = event.result.metadata ?? {};
        const terminalId = typeof resultMetadata.terminalId === 'string' ? resultMetadata.terminalId : undefined;
        const existing = this.state.tools.find((tool) => tool.id === event.toolCallId);
        const expanded = existing?.expanded;
        const linkedToTranscript = this.state.transcript.some((item) => item.toolId === event.toolCallId);
        let failure: ToolView['failure'] = null;
        if ('failure' in resultMetadata) {
          if (resultMetadata.failure === undefined) {
            failure = {
              operation: 'event',
              message: 'Terminal result failure must be null or a runtime failure.',
            };
          } else if (resultMetadata.failure === null) {
            failure = null;
          } else {
            try {
              failure = validateTerminalFailure(resultMetadata.failure, 'event');
            } catch (error) {
              failure = {
                operation: 'event',
                message: error instanceof Error ? error.message : String(error),
              };
            }
          }
        }
        const awaitingInput = resultMetadata.awaitingInput === true;
        const terminalState = terminalId
          ? awaitingInput
            ? 'awaiting_input'
            : failure
              ? 'error'
              : event.result.success
                ? resultMetadata.background === true ? 'background' : 'complete'
                : resultMetadata.cancelled === true ? 'cancelled' : 'error'
          : undefined;
        this.updateTool(event.toolCallId, {
          status: awaitingInput
            ? 'awaiting_input'
            : resultMetadata.cancelled === true || failure
              ? resultMetadata.cancelled === true ? 'cancelled' : 'error'
              : event.result.success
                ? 'success'
                : 'error',
          output: event.result.output,
          error: event.result.error,
          durationMs: event.durationMs,
          ...(typeof resultMetadata.sequence === 'number' && Number.isSafeInteger(resultMetadata.sequence) && resultMetadata.sequence >= 0 ? { outputSequence: resultMetadata.sequence } : {}),
          failure,
          ...(terminalId
            ? {
                terminalId,
                terminalState,
                liveOutput: event.result.output,
                terminalProvisional: false,
                terminalCanonical: true,
              }
            : {}),
          ...(event.toolName === 'spawn_subagent' && event.result.success && !ownerId
            ? { expanded: true }
            : expanded !== undefined
              ? { expanded }
              : {}),
        });
        if (ownerId) this.upsertSubAgent(ownerId, { toolId: event.toolCallId });
        else {
          this.applyToolResultMetadata(event.toolName, event.result.metadata);
          if (event.toolName === 'spawn_subagent') {
            const agent = this.state.subagents.find((candidate) => candidate.ownerId === event.toolCallId);
            this.addNotice('info', agent
              ? `Sub-agent finished · ${inlineText(agent.task || agent.mode)}`
              : 'Sub-agent finished · report expanded in transcript');
          } else if (!linkedToTranscript) {
            this.append('result', `${event.toolName} → ${(event.result.error ?? event.result.output) || formatValue(event.result)}`);
          }
        }
        break;
      }
      case 'terminal_progress':
        if (!this.acceptsCurrentTerminalEvent(event)) break;
        this.applyTerminalProgress(event.progress, ownerId);
        break;
      case 'api_request_sent':
        this.state.status = `Requesting ${event.providerId} / ${event.modelId} · iteration ${event.iteration}`;
        break;
      case 'retry_scheduled':
        this.state.status = `Retry scheduled · attempt ${event.attempt}`;
        break;
      case 'retry_started':
        this.state.status = `Retry started · attempt ${event.attempt}`;
        break;
      case 'connection_state_changed':
        this.state.connectionState = event.state;
        this.state.status = event.message ?? event.state;
        break;
      case 'turn_recoverable_error':
        this.state.status = 'Recoverable provider error · use /retry or send a follow-up';
        this.state.recovery = {
          action: event.recovery.action,
          partialText: event.recovery.partialText,
          retryCount: event.recovery.retryCount,
          possibleDuplicateCharge: event.recovery.possibleDuplicateCharge,
        };
        this.addNotice('warning', `${event.recovery.error.userMessage || event.recovery.error.technicalMessage} · ${event.recovery.action}`);
        break;
      case 'turn_end':
        this.sweepUnfinalizedTerminalTools(ownerId);
        this.applyUsage(event.tokenUsage);
        if (ownerId) {
          this.upsertSubAgent(ownerId, {
            status: event.reason === 'error' ? 'error' : event.reason === 'cancelled' || event.reason === 'cancelled_partial' ? 'cancelled' : 'done',
            stopReason: event.reason,
            endedAt: Date.now(),
          });
        } else {
          this.state.running = false;
          this.state.status = event.error ? `${event.reason}: ${event.error}` : event.reason;
          this.liveStreamStart = null;
          if (event.reason === 'complete' || event.reason === 'cancelled' || event.reason === 'cancelled_partial') this.state.recovery = null;
        }
        break;
      case 'context_overflow':
        this.state.status = `Context trimmed · ${event.droppedMessages} message(s)`;
        break;
      case 'file_change_pending':
        this.upsertFileChange(event.change);
        this.state.status = `${event.change.filePath} · review with /diffs`;
        break;
      case 'sdd_phase_change':
        this.state.sdd = { ...this.state.sdd, phase: event.phase };
        this.state.status = `SDD · ${event.phase}`;
        break;
      case 'sdd_task_start':
        this.upsertSddTask(event.task, 'in_progress');
        this.notifySddProgress(`started · ${event.task.title}`);
        break;
      case 'sdd_task_complete':
        this.upsertSddTask(event.task, event.task.status);
        this.notifySddProgress(`${event.task.status} · ${event.task.title}`);
        break;
      case 'context_gathered':
        this.state.context.gatheredTokens += event.tokenEstimate;
        this.state.status = `Gathered ${event.filePath} · ${event.reason}`;
        break;
      case 'context_dropped':
        this.state.context.gathered = this.state.context.gathered.filter((entry) => entry.path !== event.filePath);
        this.state.status = `Context dropped · ${event.filePath}`;
        break;
      case 'mode_switch_request':
        this.state.status = `Mode switch requested · ${event.request.fromMode} → ${event.request.toMode}`;
        break;
      case 'mode_switch_resolved':
        this.state.status = event.approved ? `Mode switched to ${event.request.toMode}` : 'Mode switch denied';
        break;
      case 'user_question_answered':
        this.state.status = 'Question answered';
        break;
      case 'memories_extracted':
        this.state.status = `${event.count} memory item(s) extracted`;
        break;
      case 'memory_recalled':
        this.state.status = `Memory recalled · ${event.title}`;
        break;
      case 'memory_created':
        this.state.status = `Memory created · ${event.memory.title}`;
        break;
      default:
        break;
    }
  }
  private sweepUnfinalizedTerminalTools(ownerId: string | null): void {
    for (const tool of this.state.tools) {
      const belongsToTurn = ownerId ? tool.ownerId === ownerId : !tool.ownerId;
      if (!belongsToTurn || !tool.terminalId || tool.terminalCanonical) continue;
      if (tool.input.background === true || tool.terminalState === 'background') continue;
      const active =
        tool.status === 'running'
        || tool.terminalState === 'started'
        || tool.terminalState === 'running'
        || tool.terminalState === 'awaiting_input';
      if (!active) continue;
      const failure = {
        operation: 'event' as const,
        message: 'Terminal command ended without a final result.',
      };
      this.updateTool(tool.id, {
        status: 'error',
        terminalState: 'error',
        terminalProvisional: true,
        terminalCanonical: false,
        failure,
        error: failure.message,
      });
      const terminal = this.state.terminals.find((candidate) => candidate.terminalId === tool.terminalId);
      if (terminal?.activeToolCallId === tool.id) {
        terminal.activeToolCallId = null;
        terminal.awaitingInput = false;
      }
    }
  }


  private upsertTool(tool: ToolView): void {
    const existing = this.state.tools.find((candidate) => candidate.id === tool.id);
    if (!existing) {
      this.state.tools.push(tool);
      return;
    }
    const currentIsFinal =
      existing.status === 'success' || existing.status === 'error' || existing.status === 'cancelled';
    const incomingIsFinal =
      tool.status === 'success' || tool.status === 'error' || tool.status === 'cancelled';
    const preserveStatus =
      (currentIsFinal && !incomingIsFinal)
      || (tool.status === 'running'
        && (existing.status === 'pending' || existing.status === 'approved' || existing.status === 'awaiting_input'));
    Object.assign(existing, tool, {
      status: preserveStatus ? existing.status : tool.status,
      liveOutput: tool.liveOutput || existing.liveOutput,
      outputSequence: Math.max(existing.outputSequence, tool.outputSequence),
    });
  }

  private updateTool(id: string, patch: Partial<ToolView> & { liveOutputAppend?: string }): void {
    const existing = this.state.tools.find((candidate) => candidate.id === id);
    if (!existing) {
      this.upsertTool({
        id,
        name: 'tool',
        input: {},
        status: patch.status ?? 'running',
        liveOutput: patch.liveOutputAppend ?? '',
        outputSequence: patch.outputSequence ?? 0,
        expanded: false,
        ...patch,
      });
      return;
    }
    if (existing.terminalCanonical && patch.terminalCanonical !== true) return;
    const { liveOutputAppend, ...rest } = patch;
    if (rest.outputSequence !== undefined && rest.outputSequence < existing.outputSequence) delete rest.outputSequence;
    if (
      rest.status
      && (existing.status === 'success' || existing.status === 'error' || existing.status === 'cancelled')
      && !(rest.status === 'success' || rest.status === 'error' || rest.status === 'cancelled')
    ) {
      rest.status = existing.status;
    }
    Object.assign(existing, rest);
    if (liveOutputAppend) existing.liveOutput += liveOutputAppend;
    if (existing.liveOutput.length > 65_536) existing.liveOutput = existing.liveOutput.slice(-65_536);
  }

  private applyTerminalProgress(progress: NonNullable<Extract<HarnessEvent, { type: 'terminal_progress' }>['progress']>, ownerId: string | null): void {
    const existing = this.state.tools.find((tool) => tool.id === progress.toolCallId);
    const previousSequence = Math.max(
      this.terminalOutputSequence.get(progress.terminalId) ?? 0,
      existing?.outputSequence ?? 0,
    );
    const current = existing
      ? {
          terminalId: existing.terminalId,
          terminalState: existing.terminalState,
          outputSequence: previousSequence,
          liveOutput: existing.liveOutput,
          failure: existing.failure,
          provisional: existing.terminalProvisional,
          canonical: existing.terminalCanonical,
        }
      : previousSequence > 0
        ? { outputSequence: previousSequence }
        : undefined;
    const projection = projectTerminalProgress(
      current,
      progress,
      {
        provisional: progress.state === 'complete'
          || progress.state === 'error'
          || progress.state === 'cancelled'
          || progress.state === 'background',
      },
    );
    if (!projection) return;

    const raw = this.terminalRawOutput.get(progress.terminalId) ?? '';
    const nextRaw = progress.sequence > previousSequence && progress.chunk
      ? `${raw}${progress.chunk}`.slice(-65_536)
      : raw;
    this.terminalRawOutput.set(progress.terminalId, nextRaw);
    this.terminalOutputSequence.set(progress.terminalId, projection.outputSequence);
    const liveOutput = normalizeTerminalOutput(nextRaw, 65_536);
    const status = progress.state === 'error'
      ? 'error'
      : progress.state === 'complete' || progress.state === 'background'
        ? 'success'
        : progress.state === 'cancelled'
          ? 'cancelled'
          : progress.state === 'awaiting_input'
            ? 'awaiting_input'
            : 'running';
    this.updateTool(progress.toolCallId, {
      liveOutput,
      terminalId: projection.terminalId,
      terminalState: projection.terminalState,
      outputSequence: projection.outputSequence,
      failure: projection.failure,
      terminalProvisional: projection.provisional,
      terminalCanonical: false,
      status,
    });
    if (progress.state === 'awaiting_input' && !ownerId && this.state.approvalMode !== 'yolo') {
      this.state.terminalInput = { terminalId: progress.terminalId, masked: isSensitiveTerminalPrompt(nextRaw) };
      this.state.mainPanel = 'terminal';
      this.state.status = 'Terminal input required';
    } else if (progress.state !== 'awaiting_input' && this.state.terminalInput?.terminalId === progress.terminalId) {
      this.state.terminalInput = null;
      this.clearInput();
    }
  }

  private acceptsCurrentTerminalEvent(event: HarnessEvent): boolean {
    if (event.turnId && this.currentTurnId && event.turnId !== this.currentTurnId) return false;
    if (event.conversationId && this.currentConversationId && event.conversationId !== this.currentConversationId) return false;
    return true;
  }

  private upsertFileChange(change: FileChangePending): void {
    const existing = this.state.fileChanges.find((candidate) => candidate.toolCallId === change.toolCallId);
    if (existing) {
      Object.assign(existing, change);
      return;
    }
    this.state.fileChanges.push({ ...change, status: 'pending', expanded: false });
  }

  private addNotice(level: RuntimeNotice['level'], text: string): void {
    if (!text) return;
    this.state.notices.push({ id: `notice-${Date.now()}-${this.state.notices.length}`, level, text, createdAt: Date.now() });
    if (this.state.notices.length > 80) this.state.notices.splice(0, this.state.notices.length - 80);
  }

  private applyUsage(usage: TokenUsage): void {
    this.state.usage.current = usage;
    this.state.usage.inputTokens = usage.inputTokens;
    this.state.usage.outputTokens = usage.outputTokens;
    this.state.usage.totalTokens = usage.totalTokens;
    this.state.usage.requestCount = usage.requestCount ?? this.state.usage.requestCount;
    this.state.usage.estimatedCost = usage.estimatedCostUsd ?? this.state.usage.estimatedCost;
    this.state.usage.session = mergeTokenUsage(this.state.usage.session, usage);
  }

  private upsertSddTask(task: SddTask, status: SddTask['status']): void {
    const tasks = [...this.state.sdd.tasks];
    const index = tasks.findIndex((candidate) => candidate.id === task.id);
    const updated = { ...task, status };
    if (index >= 0) tasks[index] = updated;
    else tasks.push(updated);
    this.state.sdd = { ...this.state.sdd, tasks, selectedTask: Math.min(this.state.sdd.selectedTask, Math.max(0, tasks.length - 1)) };
  }

  private upsertSubAgent(ownerId: string, patch: Partial<SubAgentView> & { outputAppend?: string; thinkingAppend?: string; toolId?: string; usageMerge?: TokenUsage }): void {
    let agent = this.state.subagents.find((candidate) => candidate.ownerId === ownerId);
    if (!agent) {
      agent = createSubAgentView(ownerId);
      this.state.subagents.push(agent);
    }
    const { outputAppend, thinkingAppend, toolId, usageMerge, ...rest } = patch;
    Object.assign(agent, rest);
    agent.output = appendCappedText(agent.output, outputAppend, SUBAGENT_OUTPUT_CAP);
    agent.thinking = appendCappedText(agent.thinking, thinkingAppend, SUBAGENT_THINKING_CAP);
    if (toolId && !agent.toolIds.includes(toolId)) agent.toolIds.push(toolId);
    if (usageMerge) agent.tokenUsage = mergeTokenUsage(agent.tokenUsage, usageMerge);
  }

  /** Projects turn-local checklist and skill metadata carried on tool results. */
  private applyToolResultMetadata(toolName: string, metadata: Record<string, unknown> | undefined): void {
    if (toolName !== 'manage_tasks' || !metadata) return;
    const tasks = Array.isArray(metadata.tasks) ? metadata.tasks : [];
    this.state.agentTasks = tasks
      .map((task): AgentTaskListItem | null => {
        const record = asRecord(task);
        return typeof record.id === 'number' && typeof record.title === 'string'
          ? { id: record.id, title: record.title, status: typeof record.status === 'string' ? record.status : 'not_started' }
          : null;
      })
      .filter((task): task is AgentTaskListItem => task !== null);
  }

  private notifySddProgress(detail: string): void {
    if (this.state.mainPanel === 'sdd') {
      this.state.status = `SDD · ${detail}`;
      return;
    }
    this.addNotice('info', `SDD task ${detail} · open with /sdd`);
  }

  private appendLive(kind: TranscriptKind, text: string): void {
    if (!text) return;
    const start = this.liveStreamStart ?? this.state.transcript.length;
    for (let index = this.state.transcript.length - 1; index >= start; index -= 1) {
      if (this.state.transcript[index].kind === kind) {
        this.state.transcript[index].text += text;
        return;
      }
    }
    this.append(kind, text);
  }

  private append(kind: TranscriptKind, text: string): void {
    this.appendItem({ kind, text });
  }

  private appendItem(item: TranscriptItem): void {
    if (!item.text && item.kind !== 'tool') return;
    if (item.kind === 'tool' && item.toolId !== undefined) {
      // The assistant transcript and live lifecycle events both describe one tool call.
      const existing = this.state.transcript.find(
        (candidate) => candidate.kind === 'tool' && candidate.toolId === item.toolId,
      );
      if (existing) {
        if (item.text && existing.text !== item.text) existing.text = item.text;
        return;
      }
    }
    this.state.transcript.push(item);
    if (this.state.transcript.length > TRANSCRIPT_LIMIT) {
      const removed = this.state.transcript.length - TRANSCRIPT_LIMIT;
      this.state.transcript.splice(0, removed);
      if (this.liveStreamStart !== null) this.liveStreamStart = Math.max(0, this.liveStreamStart - removed);
    }
    this.state.scroll = 0;
  }

  private async submitInput(): Promise<void> {
    if (this.state.interaction?.kind === 'question') {
      await this.submitQuestionAnswer();
      return;
    }
    const rawInput = this.state.input;
    const terminalInput = this.state.terminalInput;
    this.clearInput();
    if (terminalInput) {
      if (!rawInput.trim()) return;
      const terminalId = terminalInput.terminalId;
      this.state.terminalInput = null;
      try {
        await this.request('terminal_write', { terminalId, data: `${rawInput}\r\n` });
        this.state.status = 'Terminal input sent';
      } catch {
        this.state.status = 'Terminal input was rejected';
      }
      return;
    }
    const input = rawInput.trim();
    if (!input || this.state.running) return;
    this.state.inputHistory.push(input);
    if (input.startsWith('/')) {
      await this.runCommand(input);
      return;
    }
    if (input.startsWith('!')) {
      await this.runTerminalCommand(input.slice(1).trim());
      return;
    }
    const mention = parseContextMention(input);
    if (mention) {
      await this.request('context_attach', { kind: 'auto', path: mention.path, label: mention.path });
      if (!mention.message) {
        this.state.status = `Attached ${mention.path}`;
        return;
      }
      this.append('user', mention.message);
      this.state.running = true;
      this.state.status = 'Working…';
      await this.request('send_message', { message: mention.message });
      return;
    }
    this.append('user', input);
    this.state.running = true;
    this.state.status = 'Working…';
    await this.request('send_message', { message: input });
  }

  private async runCommand(input: string): Promise<void> {
    const parsed = parseSlashCommand(input);
    if (!parsed) return;
    const { args } = parsed;
    const name = resolveCommandName(parsed.name);
    switch (name) {
      case '/help':
        this.state.overlay = 'help';
        break;
      case '/mode':
        if (!args) this.openModeFlow();
        else await this.setMode(commandArgument(args));
        break;
      case '/thinking':
        if (!this.openThinkingFlow()) this.state.status = 'Thinking is not available for the selected model';
        break;
      case '/theme':
        if (!args) this.openThemeFlow();
        else await this.setTheme(commandArgument(args));
        break;
      case '/sidebar':
        await this.setSidebarVisibility(args);
        break;
      case '/update':
        await this.runUpdateCommand(args);
        break;
      case '/approval':
        if (!args) this.openActionFlow('approval');
        else await this.setApprovalMode(commandArgument(args));
        break;
      case '/model':
      case '/models': {
        const tokens = args.split(/\s+/).filter(Boolean);
        if (name === '/model' && tokens.length >= 2) await this.setModel(tokens[0], tokens.slice(1).join(' '));
        else this.openProviderFlow();
        break;
      }
      case '/new':
        await this.request('session_new', {});
        this.state.transcript = [];
        this.state.agentTasks = [];
        this.state.subagentDetail = null;
        this.state.status = 'New session';
        break;
      case '/sessions':
        this.state.overlay = 'sessions';
        this.state.overlayIndex = 0;
        await this.request('session_list', {});
        break;
      case '/load': {
        const id = commandArgument(args);
        if (id) await this.request('session_load', { id });
        else {
          this.state.overlay = 'sessions';
          this.state.overlayIndex = 0;
          await this.request('session_list', {});
        }
        break;
      }
      case '/rename': {
        const title = commandArgument(args);
        if (!title && this.state.currentSessionId) this.prepareCommandInput('/rename ', 'Type the new session title and press Enter');
        else if (!title) this.append('system', 'There is no active session to rename');
        else await this.request('session_rename', { id: this.state.currentSessionId, title });
        break;
      }
      case '/export':
        await this.request('session_export', { id: this.state.currentSessionId ?? undefined });
        break;
      case '/delete-session': {
        const id = commandArgument(args);
        if (id) await this.request('session_delete', { id });
        else await this.openSessionDeleteFlow();
        break;
      }
      case '/tab':
        if (!args) this.openActionFlow('tab');
        else await this.runTabCommand(args);
        break;
      case '/subagents':
        await this.runSubagentsCommand(args);
        break;
      case '/usage':
        this.state.mainPanel = 'activity';
        this.state.status = `${this.state.usage.totalTokens.toLocaleString()} tokens · ${this.state.usage.requestCount} request(s)`;
        break;
      case '/projects':
        this.state.overlay = 'projects';
        this.state.overlayIndex = 0;
        await this.request('project_list', {});
        break;
      case '/project': {
        const workspacePath = commandArgument(args);
        if (!workspacePath) {
          this.state.overlay = 'projects';
          this.state.overlayIndex = 0;
          await this.request('project_list', {});
        } else {
          await this.request('project_switch', { workspacePath });
          this.state.status = `Switching project to ${workspacePath}`;
        }
        break;
      }
      case '/diagnostics':
        await this.request('diagnostics', args ? { path: commandArgument(args) } : {});
        this.state.status = 'Diagnostics requested';
        break;
      case '/attach':
        if (!args) this.prepareCommandInput('/attach ', 'Type a path or terminal:<id> to attach and press Enter');
        else await this.attachContext(commandArgument(args));
        break;
      case '/context':
        if (!args) this.openActionFlow('context');
        else await this.runContextCommand(args);
        break;
      case '/rules':
        await this.request('rules_list', {});
        break;
      case '/skills':
        await this.request('skills_list', {});
        break;
      case '/memory':
        await this.request('memory_list', {});
        break;
      case '/terminal':
        if (!args) this.openActionFlow('terminal');
        else await this.runTerminalCommandAction(args);
        break;
      case '/diffs':
        if (!args) this.openActionFlow('diffs');
        else await this.runDiffCommand(args);
        break;
      case '/sdd':
        if (!args) this.openActionFlow('sdd');
        else await this.runSddCommand(args);
        break;
      case '/retry':
        this.state.running = true;
        await this.request('retry_turn', {});
        break;
      case '/continue':
        this.state.running = true;
        await this.request('continue_partial_turn', {});
        break;
      case '/cancel':
        await this.request('cancel', {});
        this.state.status = 'Cancellation requested';
        break;
      case '/clear':
        this.state.transcript = [];
        this.state.status = 'Conversation cleared';
        break;
      case '/quit':
      case '/exit':
        this.state.shouldQuit = true;
        break;
      default:
        this.state.status = `Unknown command: ${name} · press F1 for commands`;
        this.append('system', `Unknown command: ${name}`);
        break;
    }
  }

  private openActionFlow(action: 'approval' | 'context' | 'terminal' | 'diffs' | 'sdd' | 'tab' | 'subagents'): void {
    this.state.overlay = 'commands';
    const flow = { kind: 'action' as const, action, selected: 0 };
    if (action === 'approval') {
      const current = selectionOptions(this.state, flow).findIndex((option) => option.id === this.state.approvalMode);
      flow.selected = Math.max(0, current);
    }
    this.state.commandFlow = flow;
  }

  private async openSessionDeleteFlow(): Promise<void> {
    this.state.overlay = 'commands';
    this.state.commandFlow = { kind: 'session_delete', selected: 0 };
    await this.request('session_list', {});
  }

  private prepareCommandInput(input: string, status: string): void {
    this.state.input = input;
    this.state.inputCursor = Array.from(input).length;
    this.state.historyIndex = null;
    this.state.commandFlow = null;
    this.state.overlay = 'none';
    this.state.status = status;
  }

  private async setApprovalMode(value: string): Promise<void> {
    const modes = ['manual', 'smart', 'session-trust', 'notify', 'yolo', 'custom'];
    if (!modes.includes(value)) {
      this.append('system', `Invalid approval mode "${value}". Expected ${modes.join(', ')}.`);
      return;
    }
    await this.request('set_config', { approvalMode: value });
    this.state.approvalMode = value;
    this.state.status = `Approval mode: ${value}`;
  }

  private async attachContext(spec: string): Promise<void> {
    if (!spec) {
      this.append('system', 'Usage: /attach <path>, /attach terminal:<id>, or /attach image:<path>');
      return;
    }
    const normalized = commandArgument(spec);
    if (normalized.startsWith('terminal:')) {
      await this.request('context_attach', { kind: 'terminal', terminalId: normalized.slice('terminal:'.length), label: normalized });
    } else if (normalized.startsWith('image:')) {
      await this.request('context_attach', { kind: 'image', path: normalized.slice('image:'.length), label: normalized.slice('image:'.length) });
    } else if (normalized.startsWith('dir:')) {
      await this.request('context_attach', { kind: 'directory', path: normalized.slice('dir:'.length), label: normalized.slice('dir:'.length) });
    } else {
      await this.request('context_attach', { kind: 'auto', path: normalized, label: normalized });
    }
    this.state.status = `Attached ${normalized}`;
  }

  private async runContextCommand(args: string): Promise<void> {
    const tokens = args.split(/\s+/).filter(Boolean);
    const action = tokens[0] ?? 'list';
    if (action === 'clear') await this.request('context_clear', {});
    else if (action === 'remove' && tokens[1]) await this.request('context_remove', { id: commandArgument(tokens[1]) });
    else await this.request('context_list', {});
    this.state.status = `Context · ${this.state.context.attachments.length} attachment(s) · ${this.state.context.gatheredTokens} tokens`;
  }

  private async runTerminalCommandAction(args: string): Promise<void> {
    const tokens = args.split(/\s+/).filter(Boolean);
    const action = tokens[0] ?? 'list';
    if (action === 'open') {
      await this.request('terminal_open', { ...(tokens[1] ? { name: commandArgument(tokens.slice(1).join(' ')) } : {}) });
    } else if (action === 'focus' && tokens[1]) {
      this.state.activeTerminalId = commandArgument(tokens[1]);
      await this.request('terminal_snapshot', { terminalId: this.state.activeTerminalId });
      this.state.mainPanel = 'terminal';
    } else if (action === 'attach') {
      if (tokens[1]) await this.attachTerminal(commandArgument(tokens[1]));
      else this.state.commandFlow = { kind: 'terminal_handoff', selected: 0 };
      return;
    } else if (['read', 'interrupt', 'kill'].includes(action)) {
      if (!this.state.activeTerminalId) {
        this.state.status = 'No active terminal selected';
        return;
      }
      if (action === 'read') await this.request('terminal_snapshot', { terminalId: this.state.activeTerminalId });
      if (action === 'interrupt') await this.request('terminal_interrupt', { terminalId: this.state.activeTerminalId });
      if (action === 'kill') await this.request('terminal_kill', { terminalId: this.state.activeTerminalId });
    } else {
      await this.request('terminal_list', {});
    }
    this.state.mainPanel = 'terminal';
    this.state.status = `${this.state.terminals.length} terminal(s)`;
  }

  private async attachTerminal(terminalId: string): Promise<void> {
    const terminal = this.state.terminals.find((candidate) => candidate.terminalId === terminalId);
    if (!terminal) {
      this.state.status = `Terminal not found · ${terminalId}`;
      return;
    }
    if (!terminal.alive) {
      this.state.status = `Terminal has exited · ${terminal.name}`;
      return;
    }
    if (terminal.role === 'agent') {
      this.state.status = 'Agent terminals remain projected; only manual terminals support attach.';
      return;
    }
    if (!this.onTerminalAttach) {
      this.state.status = 'Interactive terminal attach is unavailable in this client.';
      return;
    }
    this.state.activeTerminalId = terminalId;
    this.state.mainPanel = 'terminal';
    this.state.status = `Attaching terminal · ${terminal.name}`;
    try {
      const outcome = await this.onTerminalAttach(terminalId);
      if (outcome.kind === 'detached') {
        this.state.status = `Detached terminal · ${terminal.name}`;
      } else if (outcome.failure) {
        this.state.status = `Terminal exited with failure · ${outcome.failure.message}`;
      } else {
        this.state.status = `Terminal exited · code ${outcome.exitCode ?? 'unknown'}`;
      }
    } catch (error) {
      this.state.status = 'Terminal attach failed';
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.append('error', this.state.lastError);
    }
  }

  private async runTerminalCommand(command: string): Promise<void> {
    if (!command) {
      await this.runTerminalCommandAction('list');
      return;
    }
    const active = this.state.terminals.find((terminal) => terminal.terminalId === this.state.activeTerminalId);
    if (!active || active.role !== 'user' || !active.alive) {
      const terminal = await this.request('terminal_open', {}) as TerminalSummary;
      this.applyTerminals(terminal);
    }
    if (!this.state.activeTerminalId) return;
    await this.request('terminal_write', { terminalId: this.state.activeTerminalId, data: `${command}\r` });
    await this.request('terminal_snapshot', { terminalId: this.state.activeTerminalId });
    this.state.mainPanel = 'terminal';
    this.state.status = `Terminal command sent · ${command}`;
  }

  private async runDiffCommand(args: string): Promise<void> {
    const action = commandArgument(args) || 'list';
    if (action === 'accept-all' || action === 'reject-all') {
      await this.request('file_change_resolve_all', { action: action === 'accept-all' ? 'accept' : 'reject' });
    } else if (action === 'accept' || action === 'reject') {
      const change = this.state.fileChanges.find((candidate) => candidate.status === 'pending');
      if (change) await this.request('file_change_resolve', { toolCallId: change.toolCallId, action });
    }
    this.state.mainPanel = 'activity';
    this.state.status = `${this.state.fileChanges.filter((change) => change.status === 'pending').length} file change(s) pending review`;
  }

  private async runSddCommand(args: string): Promise<void> {
    const trimmed = args.trim();
    if (!trimmed) {
      this.state.mainPanel = 'sdd';
      this.state.status = this.state.sdd.sessionId ? `SDD · ${this.state.sdd.phase ?? 'active'}` : 'Use /sdd and choose Start to describe a session';
      return;
    }
    if (trimmed === 'approve-spec') await this.request('sdd_action', { action: 'approve_spec' });
    else if (trimmed.startsWith('reject-spec')) await this.request('sdd_action', { action: 'reject_spec', feedback: trimmed.slice('reject-spec'.length).trim() });
    else if (trimmed === 'approve-plan') await this.request('sdd_action', { action: 'approve_plan' });
    else if (trimmed === 'resume') await this.request('sdd_action', { action: 'resume' });
    else await this.request('sdd_start', { description: trimmed });
    this.state.mainPanel = 'sdd';
  }

  private async runSubagentsCommand(args: string): Promise<void> {
    const tokens = args.trim().split(/\s+/u).filter(Boolean);
    const action = tokens[0] ?? 'list';
    if (action === 'cancel') {
      const target = this.resolveSubAgentTarget(tokens.slice(1).join(' '));
      if (!target) {
        if (this.state.subagents.some((agent) => agent.status === 'queued' || agent.status === 'running')) {
          this.state.overlay = 'commands';
          this.state.commandFlow = { kind: 'subagent_cancel', selected: 0 };
        } else {
          this.state.status = 'No active sub-agent to cancel';
        }
        return;
      }
      await this.requestSubAgentCancel(target);
      return;
    }
    if (/^\d+$/u.test(action)) {
      const index = Number(action) - 1;
      if (index >= 0 && index < this.state.subagents.length) {
        this.state.mainPanel = 'subagents';
        this.state.selectedSubagent = index;
        this.state.subagentDetail = index;
        this.state.status = `Sub-agent · ${this.state.subagents[index]?.mode}`;
      } else {
        this.state.status = `No sub-agent #${action} · ${this.state.subagents.length} recorded`;
      }
      return;
    }
    if (this.state.subagentDetail !== null && this.state.subagentDetail >= this.state.subagents.length) this.state.subagentDetail = null;
    this.state.mainPanel = 'subagents';
    this.state.selectedSubagent = Math.min(this.state.selectedSubagent, Math.max(0, this.state.subagents.length - 1));
    const active = this.state.subagents.filter((agent) => agent.status === 'queued' || agent.status === 'running').length;
    this.state.status = this.state.subagents.length
      ? `${active} active of ${this.state.subagents.length} sub-agent(s) · ↑↓ select · enter details`
      : 'No delegated agents in this session';
  }

  private resolveSubAgentTarget(token: string): SubAgentView | null {
    if (!token) return null;
    const agents = this.state.subagents;
    const byId = agents.find((agent) => agent.ownerId === token);
    if (byId) return byId;
    if (/^\d+$/u.test(token)) {
      const index = Number(token) - 1;
      return agents[index] ?? null;
    }
    return agents.find((agent) => (agent.status === 'queued' || agent.status === 'running') && (agent.task.startsWith(token) || agent.mode === token)) ?? null;
  }

  private async requestSubAgentCancel(target: SubAgentView): Promise<void> {
    if (target.status !== 'queued' && target.status !== 'running') {
      this.state.status = `Sub-agent already ${target.status}`;
      return;
    }
    await this.request('subagent_cancel', { ownerId: target.ownerId });
    target.status = 'cancelled';
    target.stopReason = 'cancelled';
    target.endedAt = Date.now();
    this.state.status = `Cancellation requested for ${target.mode} sub-agent`;
  }

  private async runTabCommand(args: string): Promise<void> {
    const action = commandArgument(args) || 'next';
    if (action === 'new') {
      await this.request('session_new', {});
      return;
    }
    if (action === 'close') {
      if (this.state.currentSessionId) await this.request('session_delete', { id: this.state.currentSessionId });
      return;
    }
    if (action === 'list') {
      this.state.status = `${this.state.tabs.length} tab(s)`;
      return;
    }
    if (action === 'next') {
      const currentIndex = this.state.tabs.findIndex((tab) => tab.active);
      const next = this.state.tabs[(currentIndex + 1) % Math.max(1, this.state.tabs.length)];
      if (next) await this.request('session_load', { id: next.sessionId });
      return;
    }
    const tab = this.state.tabs.find((candidate) => candidate.sessionId === action || candidate.id === action);
    if (tab) await this.request('session_load', { id: tab.sessionId });
    else this.state.status = `Tab not found: ${action}`;
  }

  private async setMode(value: string): Promise<void> {
    if (!AGENT_TYPES.includes(value as AgentType)) {
      this.append('system', `Invalid mode "${value}". Expected ${AGENT_TYPES.join(', ')}.`);
      return;
    }
    await this.request('set_mode', { agentType: value });
    this.state.status = `Mode set to ${value}`;
  }

  private async setModel(providerId: string, modelId: string): Promise<void> {
    await this.request('set_config', { providerId, modelId });
    const thinkingMenuOpened = this.openThinkingFlow();
    this.state.status = thinkingMenuOpened
      ? `Model set to ${providerId} / ${modelId} · choose thinking level`
      : `Model set to ${providerId} / ${modelId}`;
    if (!thinkingMenuOpened) this.closeCommandFlow();
  }

  private async setTheme(themeId: string): Promise<void> {
    const theme = this.state.themes.find((candidate) => candidate.id === themeId);
    if (!theme) {
      this.append('system', `Unknown theme "${themeId}". Use /theme to choose an available theme.`);
      return;
    }
    await this.request('set_config', { themeId });
    this.state.themeId = themeId;
    this.state.status = `Theme set to ${theme.name}`;
  }

  private async setSidebarVisibility(rawValue: string): Promise<void> {
    const value = rawValue.trim().toLowerCase();
    const nextValue = value === '' || value === 'toggle'
      ? !this.state.sidebarVisible
      : value === 'on' || value === 'show' || value === 'visible'
        ? true
        : value === 'off' || value === 'hide' || value === 'hidden'
          ? false
          : null;
    if (nextValue === null) {
      this.append('system', 'Usage: /sidebar [on|off|toggle]');
      return;
    }
    await this.request('set_config', { sidebarVisible: nextValue });
    this.state.sidebarVisible = nextValue;
    if (!nextValue && this.state.focus === 'sidebar') this.state.focus = 'composer';
    this.state.status = nextValue ? 'Sidebar enabled' : 'Sidebar disabled';
  }

  private openUpdateFlow(): void {
    this.state.overlay = 'commands';
    this.state.commandFlow = { kind: 'update', selected: 0 };
  }

  private async runUpdateCommand(rawArgs: string): Promise<void> {
    if (!this.updater) {
      this.state.updates.status = 'unsupported';
      this.state.updates.error = 'The VORTEX updater is not available in this runtime.';
      this.state.status = this.state.updates.error;
      return;
    }
    const args = rawArgs.trim();
    if (!args) {
      this.openUpdateFlow();
      if (this.state.updates.status === 'idle' || this.state.updates.status === 'up-to-date') await this.checkForUpdates(false);
      return;
    }
    const tokens = args.split(/\s+/u).filter(Boolean);
    const action = tokens[0]?.toLowerCase();
    if (action === 'check') {
      await this.checkForUpdates(false);
      return;
    }
    if (action === 'download' && !tokens[1]) {
      await this.downloadUpdate(false);
      return;
    }
    if ((action === 'apply' || action === 'install') && !tokens[1]) {
      await this.applyUpdate();
      return;
    }
    if (action === 'channel' && (tokens[1] === 'stable' || tokens[1] === 'pre-release')) {
      await this.setUpdatePreference({ updateChannel: tokens[1] });
      await this.checkForUpdates(false);
      return;
    }
    if (action === 'startup' && (tokens[1] === 'on' || tokens[1] === 'off')) {
      await this.setUpdatePreference({ checkForUpdatesOnStartup: tokens[1] === 'on' });
      return;
    }
    if ((action === 'auto-download' || action === 'download') && (tokens[1] === 'on' || tokens[1] === 'off')) {
      await this.setUpdatePreference({ autoDownload: tokens[1] === 'on' });
      return;
    }
    this.append('system', 'Usage: /update [check|download|apply|channel stable|channel pre-release|startup on|startup off|auto-download on|auto-download off]');
  }

  private async setUpdatePreference(params: { updateChannel?: 'stable' | 'pre-release'; checkForUpdatesOnStartup?: boolean; autoDownload?: boolean }): Promise<void> {
    await this.request('set_config', params);
    if (params.updateChannel) this.state.updates.channel = params.updateChannel;
    if (params.checkForUpdatesOnStartup !== undefined) this.state.updates.checkForUpdatesOnStartup = params.checkForUpdatesOnStartup;
    if (params.autoDownload !== undefined) this.state.updates.autoDownload = params.autoDownload;
    this.state.status = 'VORTEX update preferences saved';
  }

  private async checkForUpdates(silent: boolean): Promise<void> {
    if (!this.updater) return;
    if (this.state.updates.status === 'checking' || this.state.updates.status === 'downloading' || this.state.updates.status === 'applying') return;
    const operation = ++this.updateOperation;
    this.downloadedUpdate = null;
    this.state.updates.progress = null;
    this.state.updates.status = 'checking';
    this.state.updates.error = null;
    try {
      const release = await this.updater.check(this.state.updates.channel);
      if (operation !== this.updateOperation) return;
      this.state.updates.release = release;
      this.state.updates.installation = release?.installation ?? null;
      this.state.updates.status = release ? 'available' : 'up-to-date';
      this.state.status = release
        ? `VORTEX ${release.version} available`
        : 'VORTEX is up to date';
      await this.surfaceHelperFailures();
      if (release?.asset && this.state.updates.autoDownload) await this.downloadUpdate(true);
      if (silent && release) this.addNotice('info', `VORTEX ${release.version} is available · use /update to review`);
      if (silent && release && !release.asset && release.manualReason) this.addNotice('warning', release.manualReason);
    } catch (error) {
      if (operation !== this.updateOperation) return;
      const message = error instanceof CliUpdaterError ? error.message : error instanceof Error ? error.message : String(error);
      this.state.updates.status = error instanceof CliUpdaterError && error.code === 'unsupported' ? 'unsupported' : 'error';
      this.state.updates.error = message;
      if (!silent) this.append('error', message);
      else this.addNotice('warning', `VORTEX update check failed · ${message}`);
    }
  }

  private async surfaceHelperFailures(): Promise<void> {
    try {
      const prefix = 'vortex-update-helper-';
      const entries = await readdir(tmpdir()).catch(() => [] as string[]);
      const logs: { path: string; mtime: number }[] = [];
      for (const entry of entries) {
        if (!entry.startsWith(prefix)) continue;
        const logPath = join(tmpdir(), entry, 'update.log');
        try {
          const info = await stat(logPath);
          logs.push({ path: logPath, mtime: info.mtimeMs });
        } catch {
        }
      }
      logs.sort((left, right) => right.mtime - left.mtime);
      for (const { path } of logs.slice(0, 3)) {
        try {
          const content = await readFile(path, 'utf8');
          const failed = content.split('\n').filter((line) => line.includes('failed'));
          if (failed.length > 0) this.addNotice('warning', `VORTEX helper failed · ${failed[0]?.slice(0, 160)}`);
        } catch {
        }
      }
    } catch {
    }
  }

  private async downloadUpdate(silent: boolean): Promise<void> {
    if (!this.updater || !this.state.updates.release?.asset) return;
    if (this.state.running) {
      const message = 'Finish or cancel the active agent turn before downloading a VORTEX update.';
      this.state.updates.error = message;
      this.state.status = message;
      return;
    }
    const operation = ++this.updateOperation;
    this.state.updates.status = 'downloading';
    this.state.updates.progress = null;
    try {
      this.downloadedUpdate = await this.updater.download(this.state.updates.release);
      if (operation !== this.updateOperation) return;
      this.state.updates.status = 'ready';
      this.state.status = `VORTEX ${this.state.updates.release.version} downloaded · ready to install`;
    } catch (error) {
      if (operation !== this.updateOperation) return;
      const message = error instanceof Error ? error.message : String(error);
      this.state.updates.status = 'error';
      this.state.updates.error = message;
      if (!silent) this.append('error', message);
    }
  }

  private async applyUpdate(): Promise<void> {
    if (!this.updater || !this.downloadedUpdate) {
      this.state.status = 'Download the VORTEX update before installing it';
      return;
    }
    if (this.state.running) {
      this.state.status = 'Finish or cancel the active agent turn before installing a VORTEX update';
      return;
    }
    this.state.updates.status = 'applying';
    try {
      await this.updater.apply(this.downloadedUpdate);
      this.state.status = 'VORTEX update scheduled · exiting to complete installation';
      this.state.shouldQuit = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.updates.status = 'error';
      this.state.updates.error = message;
      this.append('error', message);
    }
  }

  private async cycleMode(): Promise<void> {
    const currentIndex = MODE_OPTIONS.findIndex((option) => option.value === this.state.mode);
    const next = MODE_OPTIONS[(currentIndex + 1) % MODE_OPTIONS.length];
    if (next) await this.setMode(next.value);
  }

  private async cycleThinking(): Promise<void> {
    const model = this.state.models.find((candidate) => candidate.provider === this.state.provider && candidate.id === this.state.model);
    const variants = model?.thinkingVariants;
    if (!variants || variants.kind === 'none') {
      this.state.status = 'Thinking is not available for the selected model';
      return;
    }

    type ThinkingLevel = Exclude<ThinkingConfig['level'], undefined>;
    const levels = [...(variants.levels ?? [])] as ThinkingLevel[];
    let thinking: ThinkingConfig;
    if (!this.state.thinking.enabled) {
      const level = this.state.thinking.level as ThinkingLevel | undefined ?? variants.defaultLevel ?? levels[0];
      thinking = { enabled: true, ...(level ? { level } : {}) };
    } else if (levels.length > 0 && this.state.thinking.level && levels.indexOf(this.state.thinking.level as ThinkingLevel) < levels.length - 1) {
      thinking = { enabled: true, level: levels[levels.indexOf(this.state.thinking.level as ThinkingLevel) + 1] };
    } else {
      thinking = { enabled: false };
    }

    await this.request('set_config', { providerId: this.state.provider, modelId: this.state.model, thinking });
    this.state.thinking = { enabled: thinking.enabled === true, ...(thinking.level ? { level: thinking.level } : {}) };
    this.state.status = `Thinking ${this.thinkingLabel()}`;
  }

  private async handleInteractionKey(key: Key, interaction: InteractionState): Promise<void> {
    if (interaction.kind === 'approval') {
      if (key.type === 'character' && key.value.length === 1) {
        const value = key.value.toLowerCase();
        if (interaction.externalAccess) {
          if (value === 'y') {
            await this.resolveInteraction(interaction.requestId, { approved: true, grant: 'once' });
          } else if (value === 'd') {
            await this.resolveInteraction(interaction.requestId, {
              approved: true,
              grant: 'session-directory',
            });
          } else if (value === 'n') {
            await this.resolveInteraction(interaction.requestId, { approved: false });
          }
          return;
        }
        if (value === 'y') await this.resolveInteraction(interaction.requestId, { approved: true });
        else if (value === 'n') await this.resolveInteraction(interaction.requestId, { approved: false });
        else if (value === 't') await this.resolveInteraction(interaction.requestId, { approved: true, trustTool: true, toolName: interaction.toolName });
        else if (value === 'a') {
          await this.request('set_config', { approvalMode: 'yolo' });
          await this.resolveInteraction(interaction.requestId, { approved: true });
          this.state.status = 'Approved and switched to yolo for this session';
        }
      }
      return;
    }
    if (interaction.kind === 'mode_switch') {
      if (key.type === 'character' && key.value.length === 1) {
        const value = key.value.toLowerCase();
        if (value === 'y') await this.resolveInteraction(interaction.requestId, { approved: true });
        else if (value === 'n') await this.resolveInteraction(interaction.requestId, { approved: false });
      }
      return;
    }
    if (key.type === 'enter') await this.submitInput();
    else if (key.type === 'up' || key.type === 'down') {
      const question = interaction.questions[interaction.questionIndex];
      const options = question?.options ?? [];
      if (options.length > 0) interaction.selectedOption = key.type === 'up'
        ? (interaction.selectedOption + options.length - 1) % options.length
        : (interaction.selectedOption + 1) % options.length;
    }
    else if (key.type === 'character') this.insertText(key.value);
    else if (key.type === 'shift_enter') this.insertText('\n');
    else if (key.type === 'backspace') this.deletePreviousCharacter();
    else if (key.type === 'delete') this.deleteNextCharacter();
    else if (key.type === 'left') this.state.inputCursor = Math.max(0, this.state.inputCursor - 1);
    else if (key.type === 'right') this.state.inputCursor = Math.min(Array.from(this.state.input).length, this.state.inputCursor + 1);
    else if (key.type === 'home') this.state.inputCursor = 0;
    else if (key.type === 'end') this.state.inputCursor = Array.from(this.state.input).length;
  }

  private async handleMouseWheel(key: Extract<Key, { type: 'mouse' }>): Promise<void> {
    const navigationKey: Key = { type: key.action === 'scroll_up' ? 'up' : 'down' };
    if (this.state.interaction) {
      await this.handleInteractionKey(navigationKey, this.state.interaction);
      return;
    }
    if (this.state.commandFlow) {
      await this.handleCommandFlowKey(navigationKey);
      return;
    }
    if (this.state.overlay !== 'none') {
      await this.handleOverlayKey(navigationKey);
      return;
    }
    const delta = key.action === 'scroll_up' ? MOUSE_SCROLL_LINES : -MOUSE_SCROLL_LINES;
    this.state.scroll = Math.max(0, this.state.scroll + delta);
  }

  private async resolveInteraction(requestId: string, params: Record<string, unknown>): Promise<void> {
    await this.request('resolve_interaction', { requestId, ...params });
    this.state.interaction = null;
    this.clearInput();
    this.state.status = 'Interaction resolved';
  }

  private async submitQuestionAnswer(): Promise<void> {
    const interaction = this.state.interaction;
    if (!interaction || interaction.kind !== 'question') return;
    const question = interaction.questions[interaction.questionIndex];
    if (!question) return;
    const selected = question.options?.[interaction.selectedOption]?.label;
    const typed = this.state.input.trim();
    const answer = typed || selected || (question.allowFreeform === false ? '' : 'Skipped');
    if (!answer && question.allowFreeform === false) return;
    const answers = [...interaction.answers.filter((candidate) => candidate.id !== question.id), { id: question.id, answer }];
    if (interaction.questionIndex + 1 < interaction.questions.length) {
      this.state.interaction = { ...interaction, questionIndex: interaction.questionIndex + 1, selectedOption: 0, answers };
      this.clearInput();
      this.state.status = `Answer ${interaction.questionIndex + 2} of ${interaction.questions.length}`;
      return;
    }
    await this.resolveInteraction(interaction.requestId, { answers });
  }

  private async handleCommandFlowKey(key: Key): Promise<void> {
    const flow = this.state.commandFlow;
    if (!flow) return;
    if (key.type === 'escape') {
      if (flow.kind === 'root') {
        this.state.commandFlow = null;
        this.state.overlay = 'none';
      } else {
        this.state.commandFlow = { kind: 'root', query: '/', selected: 0, inputDriven: true };
        this.state.input = '/';
        this.state.inputCursor = 1;
      }
      return;
    }
    if (key.type === 'character' && flow.kind === 'root') {
      if (flow.inputDriven) this.insertText(key.value);
      else {
        flow.query += key.value;
        flow.selected = 0;
      }
      return;
    }
    if (key.type === 'backspace' && flow.kind === 'root') {
      if (flow.inputDriven) this.deletePreviousCharacter();
      else {
        flow.query = flow.query.slice(0, -1) || '/';
        flow.selected = 0;
      }
      return;
    }
    if (flow.kind === 'root' && flow.inputDriven && (key.type === 'left' || key.type === 'right' || key.type === 'home' || key.type === 'end')) {
      if (key.type === 'left') this.state.inputCursor = Math.max(0, this.state.inputCursor - 1);
      else if (key.type === 'right') this.state.inputCursor = Math.min(Array.from(this.state.input).length, this.state.inputCursor + 1);
      else if (key.type === 'home') this.state.inputCursor = 0;
      else this.state.inputCursor = Array.from(this.state.input).length;
      this.syncCommandPalette();
      return;
    }
    if (flow.kind === 'root' && key.type === 'tab') {
      const command = matchingCommands(flow.query)[flow.selected];
      if (command) {
        this.state.input = `${command.name} `;
        this.state.inputCursor = Array.from(this.state.input).length;
        this.state.commandFlow = null;
        this.state.overlay = 'none';
      }
      return;
    }
    if (key.type === 'page_up' || key.type === 'page_down' || key.type === 'home' || key.type === 'end') {
      const count = this.flowOptions(flow).length;
      if (count > 0) {
        if (key.type === 'home') flow.selected = 0;
        else if (key.type === 'end') flow.selected = count - 1;
        else {
          const offset = Math.min(SELECTION_PAGE_SIZE, count);
          flow.selected = key.type === 'page_up'
            ? Math.max(0, flow.selected - offset)
            : Math.min(count - 1, flow.selected + offset);
        }
      }
      return;
    }
    if (key.type === 'up' || key.type === 'down') {
      const count = this.flowOptions(flow).length;
      if (count > 0) flow.selected = key.type === 'up' ? (flow.selected + count - 1) % count : (flow.selected + 1) % count;
      return;
    }
    if (key.type === 'enter') await this.acceptCommandFlow();
  }

  private async acceptCommandFlow(): Promise<void> {
    const flow = this.state.commandFlow;
    if (!flow) return;
    if (flow.kind === 'root') {
      const command = matchingCommands(flow.query)[flow.selected];
      if (!command) return;
      if (flow.inputDriven) this.clearInput();
      await this.runCommand(command.name);
      if (!this.state.commandFlow && !this.state.shouldQuit && this.state.overlay === 'commands') this.state.overlay = 'none';
      return;
    }
    if (flow.kind === 'action') {
      await this.acceptActionFlow(flow);
      return;
    }
    if (flow.kind === 'update') {
      await this.acceptUpdateFlow(flow);
      return;
    }
    if (flow.kind === 'context_remove') {
      const option = selectionOptions(this.state, flow)[flow.selected];
      if (option) {
        await this.request('context_remove', { id: option.id });
        this.state.status = `Removed context · ${option.label}`;
      }
      this.closeCommandFlow();
      return;
    }
    if (flow.kind === 'terminal_attach') {
      const option = selectionOptions(this.state, flow)[flow.selected];
      if (option) {
        await this.request('context_attach', { kind: 'terminal', terminalId: option.id, label: option.label });
        this.state.status = `Attached terminal · ${option.label}`;
      }
      this.closeCommandFlow();
      return;
    }
    if (flow.kind === 'terminal_select') {
      const option = selectionOptions(this.state, flow)[flow.selected];
      if (option) {
        this.state.activeTerminalId = option.id;
        await this.request('terminal_snapshot', { terminalId: option.id });
        this.state.mainPanel = 'terminal';
        this.state.status = `Focused terminal · ${option.label}`;
      }
      this.closeCommandFlow();
      return;
    }
    if (flow.kind === 'terminal_handoff') {
      const option = selectionOptions(this.state, flow)[flow.selected];
      if (option) await this.attachTerminal(option.id);
      this.closeCommandFlow();
      return;
    }
    if (flow.kind === 'diff_file') {
      const option = selectionOptions(this.state, flow)[flow.selected];
      if (option) {
        await this.request('file_change_resolve', { toolCallId: option.id, action: flow.action });
        this.state.mainPanel = 'activity';
        this.state.status = `${flow.action === 'accept' ? 'Accepted' : 'Rejected'} · ${option.label}`;
      }
      this.closeCommandFlow();
      return;
    }
    if (flow.kind === 'tab_select') {
      const option = selectionOptions(this.state, flow)[flow.selected];
      if (option) await this.request('session_load', { id: option.id });
      this.closeCommandFlow();
      return;
    }
    if (flow.kind === 'session_delete') {
      const option = selectionOptions(this.state, flow)[flow.selected];
      if (option) {
        await this.request('session_delete', { id: option.id });
        this.state.status = `Deleting session · ${option.label}`;
      }
      this.closeCommandFlow();
      return;
    }
    if (flow.kind === 'subagent_cancel') {
      const option = selectionOptions(this.state, flow)[flow.selected];
      const target = option ? this.resolveSubAgentTarget(option.id) : null;
      if (target) await this.requestSubAgentCancel(target);
      this.closeCommandFlow();
      return;
    }
    if (flow.kind === 'mode') {
      const option = MODE_OPTIONS[flow.selected];
      if (option) await this.setMode(option.value);
      this.closeCommandFlow();
      return;
    }
    if (flow.kind === 'provider') {
      const provider = this.state.providers[flow.selected];
      if (!provider) return;
      if (!provider.configured) {
        this.state.status = `${provider.name} is not configured`;
        return;
      }
      if (provider.models.length === 0) {
        this.state.status = `${provider.name} has no configured models`;
        return;
      }
      this.state.commandFlow = { kind: 'model', providerIndex: flow.selected, selected: 0 };
      return;
    }
    if (flow.kind === 'model') {
      const provider = this.state.providers[flow.providerIndex];
      const model = provider?.models[flow.selected];
      if (provider && model) await this.setModel(provider.id, model.id);
      else this.closeCommandFlow();
      return;
    }
    if (flow.kind === 'theme') {
      const option = selectionOptions(this.state, flow)[flow.selected];
      if (option) await this.setTheme(option.id);
      this.closeCommandFlow();
      return;
    }
    const thinking = this.thinkingForSelection(flow.selected);
    if (!thinking) {
      this.state.status = 'Thinking is not available for the selected model';
      this.closeCommandFlow();
      return;
    }
    await this.request('set_config', { providerId: this.state.provider, modelId: this.state.model, thinking });
    this.closeCommandFlow();
  }

  private async acceptUpdateFlow(flow: Extract<CommandFlow, { kind: 'update' }>): Promise<void> {
    const option = selectionOptions(this.state, flow)[flow.selected];
    if (!option) {
      this.closeCommandFlow();
      return;
    }
    if (option.id === 'check') {
      await this.checkForUpdates(false);
      return;
    }
    if (option.id === 'cancel') {
      this.updateOperation += 1;
      await this.updater?.cancelPending().catch(() => undefined);
      this.downloadedUpdate = null;
      this.state.updates.status = 'idle';
      this.state.updates.progress = null;
      this.state.updates.error = null;
      this.state.updates.release = null;
      this.state.status = 'VORTEX update cancelled';
      return;
    }
    if (option.id === 'retry') {
      await this.checkForUpdates(false);
      return;
    }
    if (option.id === 'download') {
      await this.downloadUpdate(false);
      return;
    }
    if (option.id === 'apply') {
      await this.applyUpdate();
      return;
    }
    if (option.id === 'manual') {
      const release = this.state.updates.release;
      this.append('system', release?.manualReason ?? 'Use the VORTEX release page to install this update manually.');
      if (release?.releaseUrl) this.append('system', `Release: ${release.releaseUrl}`);
      return;
    }
    if (option.id.startsWith('channel:')) {
      const channel = option.id.slice('channel:'.length);
      if (channel === 'stable' || channel === 'pre-release') {
        await this.setUpdatePreference({ updateChannel: channel });
        await this.checkForUpdates(false);
      }
      return;
    }
    if (option.id.startsWith('startup:')) {
      await this.setUpdatePreference({ checkForUpdatesOnStartup: option.id.endsWith(':on') });
      return;
    }
    if (option.id.startsWith('auto-download:')) {
      await this.setUpdatePreference({ autoDownload: option.id.endsWith(':on') });
      return;
    }
    this.closeCommandFlow();
  }

  private async acceptActionFlow(flow: Extract<CommandFlow, { kind: 'action' }>): Promise<void> {
    const option = selectionOptions(this.state, flow)[flow.selected];
    if (!option) {
      this.closeCommandFlow();
      return;
    }

    if (flow.action === 'approval') {
      await this.setApprovalMode(option.id);
      this.closeCommandFlow();
      return;
    }
    if (flow.action === 'context') {
      if (option.id === 'list') await this.runContextCommand('list');
      else if (option.id === 'attach') {
        this.prepareCommandInput('/attach ', 'Type a path or terminal:<id> to attach and press Enter');
        return;
      } else if (option.id === 'attach-terminal') {
        this.state.commandFlow = { kind: 'terminal_attach', selected: 0 };
        return;
      } else if (option.id === 'remove') {
        this.state.commandFlow = { kind: 'context_remove', selected: 0 };
        return;
      } else {
        await this.request('context_clear', {});
        this.state.status = 'Context cleared';
      }
      this.closeCommandFlow();
      return;
    }
    if (flow.action === 'terminal') {
      if (option.id === 'focus') {
        this.state.commandFlow = { kind: 'terminal_select', selected: 0 };
        return;
      }
      if (option.id === 'attach') {
        this.state.commandFlow = { kind: 'terminal_handoff', selected: 0 };
        return;
      }
      await this.runTerminalCommandAction(option.id);
      this.closeCommandFlow();
      return;
    }
    if (flow.action === 'diffs') {
      if (option.id === 'accept' || option.id === 'reject') {
        this.state.commandFlow = { kind: 'diff_file', action: option.id, selected: 0 };
        return;
      }
      await this.runDiffCommand(option.id);
      this.closeCommandFlow();
      return;
    }
    if (flow.action === 'sdd') {
      if (option.id === 'start') {
        this.prepareCommandInput('/sdd ', 'Describe the SDD request and press Enter');
        return;
      }
      if (option.id === 'reject-spec') {
        this.prepareCommandInput('/sdd reject-spec ', 'Add optional feedback and press Enter');
        return;
      }
      await this.runSddCommand(option.id);
      this.closeCommandFlow();
      return;
    }
    if (flow.action === 'subagents') {
      if (option.id === 'cancel') {
        this.state.commandFlow = { kind: 'subagent_cancel', selected: 0 };
        return;
      }
      await this.runSubagentsCommand('');
      this.closeCommandFlow();
      return;
    }
    if (option.id === 'select') {
      this.state.commandFlow = { kind: 'tab_select', selected: 0 };
      return;
    }
    await this.runTabCommand(option.id);
    this.closeCommandFlow();
  }

  private flowOptions(flow: CommandFlow): readonly unknown[] {
    if (flow.kind === 'root') return matchingCommands(flow.query);
    return selectionOptions(this.state, flow);
  }

  private thinkingForSelection(selected: number): ThinkingConfig | null {
    const model = this.state.models.find((candidate) => candidate.provider === this.state.provider && candidate.id === this.state.model);
    const variants = model?.thinkingVariants;
    if (!variants || variants.kind === 'none') return null;
    if (selected === 0) return { enabled: !this.state.thinking.enabled, ...(this.state.thinking.level ? { level: this.state.thinking.level as ThinkingConfig['level'] } : {}) };
    const level = variants.levels?.[selected - 1];
    return level ? { enabled: true, level } : null;
  }

  private openCommandPalette(query: string): void {
    this.state.overlay = 'commands';
    const inputDriven = this.state.input.startsWith('/') && !/\s/.test(this.state.input);
    this.state.commandFlow = { kind: 'root', query: query || '/', selected: 0, inputDriven };
  }

  private openModeFlow(): void {
    this.state.overlay = 'commands';
    this.state.commandFlow = { kind: 'mode', selected: Math.max(0, MODE_OPTIONS.findIndex((option) => option.value === this.state.mode)) };
  }

  private openProviderFlow(): void {
    this.state.overlay = 'commands';
    this.state.commandFlow = { kind: 'provider', selected: Math.max(0, this.state.providers.findIndex((provider) => provider.id === this.state.provider)) };
  }

  private openThinkingFlow(): boolean {
    const model = this.state.models.find((candidate) => candidate.provider === this.state.provider && candidate.id === this.state.model);
    const variants = model?.thinkingVariants;
    if (!variants || variants.kind === 'none') return false;

    const levels = [...(variants.levels ?? [])];
    const preferredLevel = this.state.thinking.enabled && this.state.thinking.level
      ? this.state.thinking.level
      : variants.defaultLevel ?? levels[0];
    const levelIndex = preferredLevel ? levels.findIndex((level) => level === preferredLevel) : -1;
    this.state.overlay = 'commands';
    this.state.commandFlow = { kind: 'thinking', selected: levelIndex >= 0 ? levelIndex + 1 : 0 };
    return true;
  }

  private openThemeFlow(): void {
    this.state.overlay = 'commands';
    const selected = this.state.themes.findIndex((theme) => theme.id === this.state.themeId);
    this.state.commandFlow = { kind: 'theme', selected: Math.max(0, selected) };
  }

  private closeCommandFlow(): void {
    this.state.commandFlow = null;
    this.state.overlay = 'none';
  }

  private syncCommandPalette(): void {
    if (this.state.commandFlow?.kind === 'root' && !this.state.commandFlow.inputDriven) return;
    if (this.state.input.startsWith('/') && !/\s/.test(this.state.input)) {
      const query = this.state.input.toLowerCase();
      const options = matchingCommands(query);
      this.state.overlay = 'commands';
      this.state.commandFlow = {
        kind: 'root',
        query,
        selected: Math.min(this.state.commandFlow?.selected ?? 0, Math.max(0, options.length - 1)),
        inputDriven: true,
      };
      return;
    }
    if (this.state.commandFlow?.kind === 'root' && this.state.commandFlow.inputDriven) {
      this.state.commandFlow = null;
      this.state.overlay = 'none';
    }
  }

  private async handleOverlayKey(key: Key): Promise<void> {
    if (key.type === 'escape' || key.type === 'f1') {
      this.state.overlay = 'none';
      return;
    }
    if (this.state.overlay === 'sessions' || this.state.overlay === 'projects') {
      const count = this.state.overlay === 'sessions' ? this.state.sessions.length : this.state.projects.length;
      if (key.type === 'up' || key.type === 'down') {
        if (count > 0) this.state.overlayIndex = key.type === 'up' ? (this.state.overlayIndex + count - 1) % count : (this.state.overlayIndex + 1) % count;
      } else if (key.type === 'page_up' || key.type === 'page_down' || key.type === 'home' || key.type === 'end') {
        if (count > 0) {
          if (key.type === 'home') this.state.overlayIndex = 0;
          else if (key.type === 'end') this.state.overlayIndex = count - 1;
          else {
            const offset = Math.min(SELECTION_PAGE_SIZE, count);
            this.state.overlayIndex = key.type === 'page_up'
              ? Math.max(0, this.state.overlayIndex - offset)
              : Math.min(count - 1, this.state.overlayIndex + offset);
          }
        }
      } else if (key.type === 'enter') {
        if (this.state.overlay === 'sessions') await this.loadSelectedSession();
        else await this.switchSelectedProject();
      }
    }
  }

  private async loadSelectedSession(): Promise<void> {
    const session = this.state.sessions[this.state.overlayIndex];
    if (!session) return;
    await this.request('session_load', { id: session.id });
    this.state.overlay = 'none';
    this.state.status = `Loading ${session.title}`;
  }

  private async switchSelectedProject(): Promise<void> {
    const project = this.state.projects[this.state.overlayIndex];
    if (!project) return;
    await this.request('project_switch', { workspacePath: project.workspacePath });
    this.state.overlay = 'none';
    this.state.status = `Switching project to ${project.workspacePath}`;
  }

  private insertText(text: string): void {
    const characters = Array.from(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
    const current = Array.from(this.state.input);
    current.splice(this.state.inputCursor, 0, ...characters);
    this.state.input = current.join('');
    this.state.inputCursor += characters.length;
    this.syncCommandPalette();
  }

  private deletePreviousCharacter(): void {
    const current = Array.from(this.state.input);
    if (this.state.inputCursor === 0) return;
    current.splice(this.state.inputCursor - 1, 1);
    this.state.input = current.join('');
    this.state.inputCursor -= 1;
    this.syncCommandPalette();
  }

  private deleteNextCharacter(): void {
    const current = Array.from(this.state.input);
    if (this.state.inputCursor >= current.length) return;
    current.splice(this.state.inputCursor, 1);
    this.state.input = current.join('');
    this.syncCommandPalette();
  }

  private deletePreviousWord(): void {
    const current = Array.from(this.state.input);
    let cursor = this.state.inputCursor;
    while (cursor > 0 && /\s/.test(current[cursor - 1])) cursor -= 1;
    while (cursor > 0 && !/\s/.test(current[cursor - 1])) cursor -= 1;
    current.splice(cursor, this.state.inputCursor - cursor);
    this.state.input = current.join('');
    this.state.inputCursor = cursor;
  }

  /** Enter opens the selected entry's detail view; enter again closes it. */
  private togglePanelDetail(): void {
    if (this.state.mainPanel === 'sdd') {
      if (this.state.sdd.tasks.length === 0) return;
      this.state.sdd = { ...this.state.sdd, expandedTask: !this.state.sdd.expandedTask };
      this.state.status = this.state.sdd.expandedTask ? 'Task details expanded' : 'Task details collapsed';
      return;
    }
    if (this.state.subagents.length === 0) return;
    this.state.subagentDetail = this.state.subagentDetail === null
      ? Math.min(this.state.selectedSubagent, this.state.subagents.length - 1)
      : null;
    const agent = this.state.subagents[this.state.selectedSubagent];
    this.state.status = agent ? (this.state.subagentDetail === null ? 'Closed sub-agent details' : `Sub-agent details · ${agent.mode}`) : this.state.status;
  }

  private closePanelDetail(): boolean {
    if (this.state.mainPanel === 'sdd' && this.state.sdd.expandedTask) {
      this.state.sdd = { ...this.state.sdd, expandedTask: false };
      return true;
    }
    if (this.state.mainPanel === 'subagents' && this.state.subagentDetail !== null) {
      this.state.subagentDetail = null;
      return true;
    }
    return false;
  }


  private clearInput(): void {
    this.state.input = '';
    this.state.inputCursor = 0;
    this.state.historyIndex = null;
    if (this.state.commandFlow?.kind === 'root' && this.state.commandFlow.inputDriven) {
      this.state.commandFlow = null;
      this.state.overlay = 'none';
    }
  }

  private moveUp(): void {
    if (this.state.focus === 'transcript') {
      this.state.scroll += 1;
      return;
    }
    if (this.panelSelectionActive()) {
      this.movePanelSelection(-1);
      return;
    }
    if (this.state.inputHistory.length === 0) return;
    const index = this.state.historyIndex === null ? this.state.inputHistory.length - 1 : Math.max(0, this.state.historyIndex - 1);
    this.state.historyIndex = index;
    this.state.input = this.state.inputHistory[index];
    this.state.inputCursor = Array.from(this.state.input).length;
  }

  private moveDown(): void {
    if (this.state.focus === 'transcript') {
      this.state.scroll = Math.max(0, this.state.scroll - 1);
      return;
    }
    if (this.panelSelectionActive()) {
      this.movePanelSelection(1);
      return;
    }
    if (this.state.historyIndex === null) return;
    if (this.state.historyIndex + 1 >= this.state.inputHistory.length) {
      this.clearInput();
      return;
    }
    const index = this.state.historyIndex + 1;
    this.state.historyIndex = index;
    this.state.input = this.state.inputHistory[index];
    this.state.inputCursor = Array.from(this.state.input).length;
  }

  /** Arrow keys browse the focused side panel while the composer draft is empty. */
  private panelSelectionActive(): boolean {
    if (this.state.input.trim()) return false;
    return this.state.mainPanel === 'sdd' || this.state.mainPanel === 'subagents';
  }

  private movePanelSelection(delta: number): void {
    if (this.state.mainPanel === 'sdd') {
      const total = this.state.sdd.tasks.length;
      if (total === 0) return;
      const next = this.state.sdd.selectedTask + delta;
      this.state.sdd = { ...this.state.sdd, selectedTask: Math.min(Math.max(next, 0), total - 1), expandedTask: false };
      return;
    }
    const total = this.state.subagents.length;
    if (total === 0) return;
    this.state.selectedSubagent = Math.min(Math.max(this.state.selectedSubagent + delta, 0), total - 1);
  }

  /** Collapses the newest expanded card first, else expands the newest card. */
  private toggleLastToolExpansion(): void {
    const newestExpanded = [...this.state.tools].reverse().find((tool) => tool.expanded);
    const tool = newestExpanded ?? this.state.tools[this.state.tools.length - 1];
    if (!tool) {
      this.state.status = 'No tool activity to expand yet';
      return;
    }
    tool.expanded = !tool.expanded;
    this.state.status = tool.expanded ? `Expanded ${tool.name} details` : `Collapsed ${tool.name} details`;
  }

  private scrollPageLines(): number {
    return Math.max(3, Math.floor(this.state.height / 4));
  }

  setViewport(width: number, height: number): void {
    const viewport = normalizeTerminalViewport(width, height);
    this.state.width = viewport.cols;
    this.state.height = viewport.rows;
  }

  async resizeActiveTerminal(width: number, height: number): Promise<void> {
    this.setViewport(width, height);
    if (!this.state.activeTerminalId) return;
    const viewport = normalizeTerminalViewport(width, height);
    await this.request('terminal_resize', {
      terminalId: this.state.activeTerminalId,
      cols: viewport.cols,
      rows: viewport.rows,
    }).catch((error: unknown) => {
      const message = `Terminal resize failed: ${error instanceof Error ? error.message : String(error)}`;
      this.state.lastError = message;
      this.state.status = message;
    });
  }

  pendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  private thinkingLabel(): string {
    return this.state.thinking.enabled ? this.state.thinking.level ?? 'on' : 'off';
  }
}

function normalizeTerminalSummary(value: unknown): TerminalSummary | null {
  const item = asRecord(value);
  if (
    typeof item.terminalId !== 'string'
    || item.terminalId.length === 0
    || typeof item.ptyId !== 'string'
    || item.ptyId.length === 0
    || typeof item.name !== 'string'
    || typeof item.alive !== 'boolean'
    || typeof item.sequence !== 'number'
    || !Number.isSafeInteger(item.sequence)
    || item.sequence < 0
    || typeof item.outputPreview !== 'string'
    || (item.frameLanguage !== 'bash' && item.frameLanguage !== 'powershell')
    || !('failure' in item)
    || item.failure === undefined
  ) {
    return null;
  }
  if (
    'role' in item
    && item.role !== undefined
    && item.role !== 'user'
    && item.role !== 'agent'
  ) return null;
  if (
    ('cwd' in item && item.cwd !== undefined && typeof item.cwd !== 'string')
    || ('ownerConversationId' in item && item.ownerConversationId !== undefined && typeof item.ownerConversationId !== 'string')
    || ('ownerId' in item && item.ownerId !== undefined && typeof item.ownerId !== 'string')
    || ('activeToolCallId' in item && item.activeToolCallId !== undefined && item.activeToolCallId !== null && typeof item.activeToolCallId !== 'string')
    || ('awaitingInput' in item && item.awaitingInput !== undefined && typeof item.awaitingInput !== 'boolean')
    || ('truncated' in item && item.truncated !== undefined && typeof item.truncated !== 'boolean')
    || ('handoffActive' in item && item.handoffActive !== undefined && typeof item.handoffActive !== 'boolean')
    || ('canUserWrite' in item && item.canUserWrite !== undefined && typeof item.canUserWrite !== 'boolean')
  ) return null;
  if (
    'exitCode' in item
    && item.exitCode !== undefined
    && item.exitCode !== null
    && (typeof item.exitCode !== 'number' || !Number.isSafeInteger(item.exitCode))
  ) return null;
  let failure: TerminalSummary['failure'];
  try {
    failure = validateTerminalFailure(item.failure, 'event');
  } catch {
    return null;
  }
  if (failure === null && item.failure !== null) return null;
  const permissions = item.permissions;
  if (
    permissions !== undefined
    && (
      typeof permissions !== 'object'
      || permissions === null
      || typeof (permissions as Record<string, unknown>).read !== 'boolean'
      || typeof (permissions as Record<string, unknown>).write !== 'boolean'
      || typeof (permissions as Record<string, unknown>).respond !== 'boolean'
      || typeof (permissions as Record<string, unknown>).interrupt !== 'boolean'
      || typeof (permissions as Record<string, unknown>).kill !== 'boolean'
      || typeof (permissions as Record<string, unknown>).resize !== 'boolean'
    )
  ) return null;
  const role = item.role === 'user' || item.role === 'agent' ? item.role : undefined;
  return {
    terminalId: item.terminalId,
    ptyId: item.ptyId,
    name: item.name,
    alive: item.alive,
    sequence: item.sequence,
    outputPreview: item.outputPreview,
    frameLanguage: item.frameLanguage,
    failure,
    ...(role ? { role } : {}),
    ...(typeof item.cwd === 'string' ? { cwd: item.cwd } : {}),
    ...(typeof item.ownerConversationId === 'string' ? { ownerConversationId: item.ownerConversationId } : {}),
    ...(typeof item.ownerId === 'string' ? { ownerId: item.ownerId } : {}),
    ...('activeToolCallId' in item && item.activeToolCallId !== undefined ? { activeToolCallId: item.activeToolCallId as string | null } : {}),
    ...('awaitingInput' in item && item.awaitingInput !== undefined ? { awaitingInput: item.awaitingInput as boolean } : {}),
    ...('exitCode' in item && item.exitCode !== undefined ? { exitCode: item.exitCode as number | null } : {}),
    ...('truncated' in item && item.truncated !== undefined ? { truncated: item.truncated as boolean } : {}),
    ...('handoffActive' in item && item.handoffActive !== undefined ? { handoffActive: item.handoffActive as boolean } : {}),
    ...('canUserWrite' in item && item.canUserWrite !== undefined ? { canUserWrite: item.canUserWrite as boolean } : {}),
    ...(permissions ? { permissions: permissions as TerminalSummary['permissions'] } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatValue(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? 'null';
  } catch {
    serialized = '<unserializable>';
  }
  return serialized.length > 2000 ? `${serialized.slice(0, 2000)}…` : serialized;
}

function emptyContext(): ContextView {
  return {
    attachments: [],
    gathered: [],
    gatheredTokens: 0,
    activeRulePaths: [],
    activeSkillNames: [],
    capabilities: null,
  };
}

function emptySdd(): UiState['sdd'] {
  return {
    sessionId: null,
    session: null,
    tasks: [],
    phase: null,
    spec: null,
    review: null,
    failedTask: null,
    selectedTask: 0,
    expandedTask: false,
  };
}

function emptyUsage(): UiState['usage'] {
  return {
    current: null,
    session: null,
    requestCount: 0,
    estimatedCost: 0,
    contextWindow: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function emptyUpdates(): UiState['updates'] {
  return {
    status: 'idle',
    channel: 'stable',
    checkForUpdatesOnStartup: true,
    autoDownload: false,
    release: null,
    progress: null,
    installation: null,
    error: null,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseContextMention(input: string): { path: string; message: string } | null {
  const match = /^@(?:"([^"]+)"|(\S+))(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match) return null;
  return { path: match[1] ?? match[2] ?? '', message: match[3]?.trim() ?? '' };
}

const REPLAYED_TOOL_LIMIT = 120;
const TRANSCRIPT_LIMIT = 500;

export function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  const firstString = (...keys: readonly string[]): string | null => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
  };
  const command = firstString('command', 'cmd', 'script');
  if (command) return inlineText(command);
  if (toolName === 'rename_file') {
    const from = firstString('path', 'filePath', 'from');
    const to = firstString('newPath', 'new_path', 'to');
    if (from && to) return `${inlineText(from)} → ${inlineText(to)}`;
  }
  if (toolName === 'spawn_subagent') {
    const mode = firstString('mode') ?? 'review';
    const task = firstString('task');
    return task ? `${mode}: ${inlineText(task)}` : mode;
  }
  const paths = [...new Set(['filePath', 'file_path', 'path', 'notebookPath', 'notebook_path']
    .map((key) => input[key])
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map(inlineText))];
  if (paths.length === 1) return paths[0];
  if (paths.length > 1) return `${paths[0]} (+${paths.length - 1} more)`;
  const query = firstString('pattern', 'query', 'search', 'url', 'question', 'symbol');
  if (query) return inlineText(query);
  let serialized: string;
  try {
    serialized = JSON.stringify(input) ?? '';
  } catch {
    serialized = '<unserializable>';
  }
  if (!serialized || serialized === '{}') return '';
  return inlineText(serialized.length > 160 ? `${serialized.slice(0, 160)}…` : serialized);
}

export function inlineText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

import type { AgentType, FileChangePending, HarnessEvent, SddTask } from '@hyscode/agent-harness';
import type { Message, ThinkingConfig } from '@hyscode/ai-providers';
import type {
  BridgeMessage,
  BridgeRequest,
  BridgeResponse,
  GitSummary,
  InteractionRequest,
  ProjectSummary,
  RuntimeReadyPayload,
  SessionRecord,
  SddStatePayload,
  TerminalSummary,
  TuiBridge,
} from '@hyscode/tui-runtime';
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from '@hyscode/tui-runtime';
import { MODE_OPTIONS, commandArgument, matchingCommands, parseSlashCommand, resolveCommandName, selectionOptions } from './commands';
import { AGENT_TYPES } from './types';
import type { CliOptions, CommandFlow, ContextView, InteractionState, Key, MemoryView, RuleView, RuntimeNotice, SkillView, SubAgentView, ToolView, TranscriptItem, TranscriptKind, UiState } from './types';

const SELECTION_PAGE_SIZE = 8;
const MOUSE_SCROLL_LINES = 3;
const EMPTY_GIT_SUMMARY: GitSummary = { available: false, branch: '', insertions: 0, deletions: 0, changedFiles: 0 };

export type RuntimeClient = Pick<TuiBridge, 'handle'>;

export class TuiController {
  readonly state: UiState;
  private readonly pendingRequests = new Map<string, BridgeRequest['method']>();
  private readonly pendingRequestParams = new Map<string, Record<string, unknown>>();
  private nextRequestId = 1;
  private liveStreamStart: number | null = null;
  private gitRefreshInFlight = false;

  constructor(readonly options: CliOptions, private readonly runtime: RuntimeClient) {
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
      sdd: emptySdd(),
      subagents: [],
      usage: emptyUsage(),
      notices: [],
      connectionState: 'connecting',
      recovery: null,
      mainPanel: 'chat',
      capabilities: null,
      selectedToolIndex: 0,
      rules: [],
      skills: [],
      memories: [],
      scroll: 0,
      lastError: null,
      currentSessionId: null,
      lastUserMessage: null,
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
  }

  async shutdown(): Promise<void> {
    if (this.pendingRequests.size === 0 && this.state.shouldQuit) return;
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
        if (this.state.running) {
          await this.request('cancel', {});
          this.state.status = 'Cancellation requested';
        } else if (this.state.input) {
          this.clearInput();
        } else {
          this.state.shouldQuit = true;
        }
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
        await this.submitInput();
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
        this.state.inputCursor = 0;
        break;
      case 'end':
        this.state.inputCursor = Array.from(this.state.input).length;
        break;
      case 'up':
        this.moveUp();
        break;
      case 'down':
        this.moveDown();
        break;
      case 'page_up':
        this.state.scroll += 5;
        break;
      case 'page_down':
        this.state.scroll = Math.max(0, this.state.scroll - 5);
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
        this.clearInput();
        this.state.status = 'Input cleared';
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
        this.applyTerminalSnapshot(response.result);
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
    this.state.mode = payload.activeAgentType;
    this.state.provider = payload.activeProviderId;
    this.state.model = payload.activeModelId;
    if (payload.git) this.state.git = payload.git;
    this.state.themeId = payload.activeThemeId ?? this.state.themeId;
    if (payload.themes && payload.themes.length > 0) this.state.themes = payload.themes;
    if (payload.recentSessions) this.state.sessions = payload.recentSessions;
    this.state.sidebarVisible = payload.sidebarVisible ?? this.state.sidebarVisible;
    if (!this.state.sidebarVisible && this.state.focus === 'sidebar') this.state.focus = 'composer';
    this.state.approvalMode = payload.approvalMode ?? this.state.approvalMode;
    this.state.thinking = {
      enabled: payload.activeThinking.enabled === true,
      ...(payload.activeThinking.level ? { level: payload.activeThinking.level } : {}),
    };
    this.state.providers = payload.providers;
    this.state.models = payload.models;
    this.state.usage.contextWindow = payload.models.find((model) => model.provider === payload.activeProviderId && model.id === payload.activeModelId)?.contextWindow ?? 0;
    this.state.capabilities = payload.capabilities ?? null;
    if (payload.context) this.applyContext(payload.context);
    if (payload.sdd) this.applySdd(payload.sdd);
    if (payload.terminals) this.applyTerminals(payload.terminals);
    if (payload.session) this.state.connectionState = 'connected';
    this.state.status = this.state.provider ? `Ready · thinking ${this.thinkingLabel()}` : 'No configured provider';
    if (payload.session) this.applySession(payload.session);
  }

  private applySession(session: SessionRecord): void {
    if (!session?.id) return;
    this.state.currentSessionId = session.id;
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
    this.state.sdd = emptySdd();
    this.liveStreamStart = null;
    this.state.lastUserMessage = null;
    for (const message of session.messages) {
      if (message.role === 'user') {
        const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
        if (text) {
          this.state.lastUserMessage = text;
          this.append('user', text);
        }
      } else {
        for (const item of this.contentItems(message.content)) this.append(item.kind, item.text);
      }
    }
    this.state.scroll = 0;
  }

  private contentItems(content: Message['content']): TranscriptItem[] {
    return content.flatMap((block): TranscriptItem[] => {
      switch (block.type) {
        case 'text': return [{ kind: 'assistant', text: block.text }];
        case 'thinking': return [{ kind: 'thinking', text: block.thinking }];
        case 'tool_call': return [{ kind: 'tool', text: `${block.name} ${formatValue(block.input)}` }];
        case 'tool_result': return [{ kind: 'result', text: block.output }];
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
    const terminals = values.filter((value): value is TerminalSummary => {
      const item = asRecord(value);
      return typeof item.terminalId === 'string' && typeof item.ptyId === 'string';
    });
    if (Array.isArray(result)) this.state.terminals = terminals;
    else {
      const next = terminals[0];
      if (next) {
        const index = this.state.terminals.findIndex((terminal) => terminal.terminalId === next.terminalId);
        if (index >= 0) this.state.terminals[index] = next;
        else this.state.terminals.push(next);
        this.state.activeTerminalId = next.terminalId;
      }
    }
  }

  private applyTerminalSnapshot(result: unknown): void {
    if (!this.state.activeTerminalId) return;
    const snapshot = asRecord(result);
    const terminal = this.state.terminals.find((candidate) => candidate.terminalId === this.state.activeTerminalId);
    if (!terminal) return;
    terminal.outputPreview = stringValue(snapshot.data, terminal.outputPreview).slice(-4000);
    terminal.sequence = numberValue(snapshot.toSequence, terminal.sequence);
    terminal.alive = snapshot.alive !== false;
  }

  private applySdd(payload: SddStatePayload): void {
    this.state.sdd = {
      ...payload,
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
      };
      this.state.status = 'Approval required · y allow · n deny · t trust tool';
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
          this.state.running = true;
          this.liveStreamStart = this.state.transcript.length;
          this.state.status = `Working · iteration ${event.iteration}`;
        }
        break;
      case 'stream_chunk':
        if (ownerId) {
          if (event.chunk.type === 'text_delta') this.upsertSubAgent(ownerId, { outputAppend: event.chunk.text });
          else if (event.chunk.type === 'thinking_delta') this.upsertSubAgent(ownerId, { thinkingAppend: event.chunk.text });
        } else if (event.chunk.type === 'text_delta') this.appendLive('assistant', event.chunk.text);
        else if (event.chunk.type === 'thinking_delta') this.appendLive('thinking', event.chunk.text);
        else if (event.chunk.type === 'usage') this.applyUsage(event.chunk.usage);
        else if (event.chunk.type === 'error') this.append('error', event.chunk.error);
        break;
      case 'transcript_message':
        if (event.role === 'assistant') {
          if (this.liveStreamStart !== null) this.state.transcript.splice(this.liveStreamStart);
          this.liveStreamStart = this.state.transcript.length;
          for (const item of this.contentItems(event.blocks)) this.append(item.kind, item.text);
        } else {
          for (const item of this.contentItems(event.blocks)) this.append(item.kind, item.text);
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
          this.append('tool', `${event.toolName} ${formatValue(event.input)}`);
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
      case 'tool_call_result':
        this.updateTool(event.toolCallId, {
          status: event.result.success ? 'success' : 'error',
          output: event.result.output,
          error: event.result.error,
          durationMs: event.durationMs,
        });
        if (ownerId) this.upsertSubAgent(ownerId, { toolId: event.toolCallId });
        else this.append('result', `${event.toolName} → ${(event.result.error ?? event.result.output) || formatValue(event.result)}`);
        break;
      case 'terminal_progress':
        this.updateTool(event.progress.toolCallId, {
          liveOutputAppend: event.progress.chunk,
          terminalId: event.progress.terminalId,
          terminalState: event.progress.state,
          outputSequence: event.progress.sequence,
          status: event.progress.state === 'error' ? 'error' : event.progress.state === 'complete' ? 'success' : 'running',
        });
        if (!ownerId && event.progress.chunk) this.appendLive('tool', event.progress.chunk);
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
        this.applyUsage(event.tokenUsage);
        if (ownerId) {
          this.upsertSubAgent(ownerId, { status: event.reason === 'error' ? 'error' : event.reason === 'cancelled' || event.reason === 'cancelled_partial' ? 'cancelled' : 'done', endedAt: Date.now() });
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
        this.state.mainPanel = 'sdd';
        break;
      case 'sdd_task_complete':
        this.upsertSddTask(event.task, event.task.status);
        this.state.mainPanel = 'sdd';
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

  private upsertTool(tool: ToolView): void {
    const existing = this.state.tools.find((candidate) => candidate.id === tool.id);
    if (!existing) {
      this.state.tools.push(tool);
      this.state.selectedToolIndex = this.state.tools.length - 1;
      return;
    }
    Object.assign(existing, tool, {
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
    const { liveOutputAppend, ...rest } = patch;
    Object.assign(existing, rest);
    if (liveOutputAppend) existing.liveOutput += liveOutputAppend;
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

  private applyUsage(usage: import('@hyscode/ai-providers').TokenUsage): void {
    this.state.usage.current = usage;
    this.state.usage.inputTokens = usage.inputTokens;
    this.state.usage.outputTokens = usage.outputTokens;
    this.state.usage.totalTokens = usage.totalTokens;
    this.state.usage.requestCount = usage.requestCount ?? this.state.usage.requestCount;
    this.state.usage.estimatedCost = usage.estimatedCostUsd ?? this.state.usage.estimatedCost;
    this.state.usage.session = mergeUsage(this.state.usage.session, usage);
  }

  private upsertSddTask(task: SddTask, status: SddTask['status']): void {
    const tasks = [...this.state.sdd.tasks];
    const index = tasks.findIndex((candidate) => candidate.id === task.id);
    const updated = { ...task, status };
    if (index >= 0) tasks[index] = updated;
    else tasks.push(updated);
    this.state.sdd = { ...this.state.sdd, tasks, selectedTask: Math.min(this.state.sdd.selectedTask, Math.max(0, tasks.length - 1)) };
  }

  private upsertSubAgent(ownerId: string, patch: Partial<SubAgentView> & { outputAppend?: string; thinkingAppend?: string; toolId?: string }): void {
    let agent = this.state.subagents.find((candidate) => candidate.ownerId === ownerId);
    if (!agent) {
      agent = {
        ownerId,
        mode: 'agent',
        task: '',
        status: 'queued',
        output: '',
        thinking: '',
        toolIds: [],
        startedAt: Date.now(),
        endedAt: null,
      };
      this.state.subagents.push(agent);
    }
    const { outputAppend, thinkingAppend, toolId, ...rest } = patch;
    Object.assign(agent, rest);
    if (outputAppend) agent.output += outputAppend;
    if (thinkingAppend) agent.thinking += thinkingAppend;
    if (toolId && !agent.toolIds.includes(toolId)) agent.toolIds.push(toolId);
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
    if (!text) return;
    this.state.transcript.push({ kind, text });
    if (this.state.transcript.length > 500) {
      const removed = this.state.transcript.length - 500;
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
    const input = this.state.input.trim();
    this.clearInput();
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
      this.state.lastUserMessage = mention.message;
      this.append('user', mention.message);
      this.state.running = true;
      this.state.status = 'Working…';
      await this.request('send_message', { message: mention.message });
      return;
    }
    this.state.lastUserMessage = input;
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
        this.state.lastUserMessage = null;
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
        this.state.mainPanel = 'activity';
        this.state.status = this.state.subagents.length ? `${this.state.subagents.length} sub-agent(s)` : 'No delegated agents in this session';
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

  private openActionFlow(action: 'approval' | 'context' | 'terminal' | 'diffs' | 'sdd' | 'tab'): void {
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
    } else {
      await this.request('terminal_list', {});
    }
    this.state.mainPanel = 'terminal';
    this.state.status = `${this.state.terminals.length} terminal(s)`;
  }

  private async runTerminalCommand(command: string): Promise<void> {
    if (!command) {
      await this.runTerminalCommandAction('list');
      return;
    }
    if (!this.state.activeTerminalId) {
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
    if (this.state.historyIndex === null) return;
    if (this.state.historyIndex + 1 >= this.state.inputHistory.length) {
      this.clearInput();
      return;
    }
    this.state.historyIndex += 1;
    this.state.input = this.state.inputHistory[this.state.historyIndex];
    this.state.inputCursor = Array.from(this.state.input).length;
  }

  setViewport(width: number, height: number): void {
    this.state.width = Math.max(40, width);
    this.state.height = Math.max(12, height);
  }

  pendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  private thinkingLabel(): string {
    return this.state.thinking.enabled ? this.state.thinking.level ?? 'on' : 'off';
  }
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mergeUsage(previous: import('@hyscode/ai-providers').TokenUsage | null, current: import('@hyscode/ai-providers').TokenUsage): import('@hyscode/ai-providers').TokenUsage {
  if (!previous) return { ...current };
  return {
    ...current,
    inputTokens: previous.inputTokens + current.inputTokens,
    outputTokens: previous.outputTokens + current.outputTokens,
    totalTokens: previous.totalTokens + current.totalTokens,
    requestCount: (previous.requestCount ?? 0) + (current.requestCount ?? 0),
    cacheReadTokens: (previous.cacheReadTokens ?? 0) + (current.cacheReadTokens ?? 0),
    cacheWriteTokens: (previous.cacheWriteTokens ?? 0) + (current.cacheWriteTokens ?? 0),
    reasoningTokens: (previous.reasoningTokens ?? 0) + (current.reasoningTokens ?? 0),
    retryCount: (previous.retryCount ?? 0) + (current.retryCount ?? 0),
    estimatedCostUsd: (previous.estimatedCostUsd ?? 0) + (current.estimatedCostUsd ?? 0),
  };
}

function parseContextMention(input: string): { path: string; message: string } | null {
  const match = /^@(?:"([^"]+)"|(\S+))(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match) return null;
  return { path: match[1] ?? match[2] ?? '', message: match[3]?.trim() ?? '' };
}

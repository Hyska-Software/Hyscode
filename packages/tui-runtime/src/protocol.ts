import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentType,
  FileChangePending,
  GatheredContextEntry,
  ApprovalMode,
  ExternalPathAccessRequest,
  ExternalPathGrant,
  HarnessEvent,
  PendingToolCall,
  SddSession,
  SddTask,
  ToolRiskLevel,
} from '@hyscode/agent-harness';
import type { AIModel, AIProvider, Message, ThinkingConfig, TokenUsage } from '@hyscode/ai-providers';
import type { ThemeSummary } from '@hyscode/theme';

export type BridgeRequest = {
  id: string;
  method:
    | 'initialize'
    | 'git_summary'
    | 'send_message'
    | 'retry_turn'
    | 'continue_partial_turn'
    | 'cancel'
    | 'set_mode'
    | 'set_config'
    | 'resolve_interaction'
    | 'session_list'
    | 'session_load'
    | 'session_new'
    | 'project_list'
    | 'project_switch'
    | 'diagnostics'
    | 'context_attach'
    | 'context_remove'
    | 'context_clear'
    | 'context_list'
    | 'rules_list'
    | 'skills_list'
    | 'memory_list'
    | 'terminal_list'
    | 'terminal_open'
    | 'terminal_snapshot'
    | 'terminal_write'
    | 'terminal_resize'
    | 'terminal_interrupt'
    | 'terminal_kill'
    | 'file_change_resolve'
    | 'file_change_resolve_all'
    | 'sdd_start'
    | 'sdd_action'
    | 'subagent_cancel'
    | 'session_delete'
    | 'session_rename'
    | 'session_export'
    | 'trace_list'
    | 'host_response'
    | 'host_event'
    | 'shutdown';
  params?: Record<string, unknown>;
};

export type BridgeResponse =
  | { type: 'response'; id: string; ok: true; result: unknown }
  | { type: 'response'; id: string; ok: false; error: string };

export type BridgeEvent =
  | { type: 'event'; event: 'runtime_ready'; payload: RuntimeReadyPayload }
  | { type: 'event'; event: 'harness_event'; payload: HarnessEvent }
  | { type: 'event'; event: 'interaction'; payload: InteractionRequest }
  | { type: 'event'; event: 'diagnostic'; payload: DiagnosticPayload }
  | { type: 'event'; event: 'host_request'; payload: HostRequestPayload }
  | { type: 'event'; event: 'session_updated'; payload: SessionRecord }
  | { type: 'event'; event: 'context_updated'; payload: ContextStatePayload }
  | { type: 'event'; event: 'file_change_updated'; payload: FileChangeState }
  | { type: 'event'; event: 'sdd_updated'; payload: SddStatePayload }
  | { type: 'event'; event: 'scoped_harness_event'; payload: ScopedHarnessEventPayload }
  | { type: 'event'; event: 'terminal_updated'; payload: TerminalUpdatedPayload }
  | { type: 'event'; event: 'fatal'; payload: { message: string } };

export type BridgeMessage = BridgeResponse | BridgeEvent;

export type RuntimeReadyPayload = {
  protocolVersion: 1;
  /** Additive capability version. protocolVersion remains 1 for old clients. */
  capabilitiesVersion?: number;
  workspacePath: string;
  projectId: string;
  providers: ProviderSummary[];
  models: AIModel[];
  agentTypes: AgentType[];
  modes: ApprovalMode[];
  activeAgentType: AgentType;
  activeProviderId: string;
  activeModelId: string;
  activeThinking: ThinkingConfig;
  /** Current shared UI theme and the themes available to the TUI selector. */
  activeThemeId?: string;
  themes?: ThemeSummary[];
  /** Sessions available to render in the startup welcome surface. */
  recentSessions?: SessionSummary[];
  /** Whether the TUI session sidebar is currently rendered. */
  sidebarVisible?: boolean;
  /** Current Git branch and line counts for uncommitted tracked changes. */
  git?: GitSummary;
  updates?: RuntimeUpdatesPayload;
  approvalMode?: ApprovalMode;
  capabilities?: RuntimeCapabilities;
  context?: ContextStatePayload;
  sdd?: SddStatePayload;
  terminals?: TerminalSummary[];
  session?: SessionRecord;
};

export type RuntimeUpdatesPayload = {
  channel: 'stable' | 'pre-release';
  checkForUpdatesOnStartup: boolean;
  autoDownload: boolean;
};

export type RuntimeCapabilities = {
  slashCommands: boolean;
  contextMentions: boolean;
  fileAttachments: boolean;
  directoryAttachments: boolean;
  terminalAttachments: boolean;
  imageAttachments: boolean;
  interactiveTerminal: boolean;
  approvals: boolean;
  fileReview: boolean;
  sdd: boolean;
  subAgents: boolean;
  sessionManagement: boolean;
  terminalEvents?: boolean;
  terminalInput?: boolean;
  terminalResize?: boolean;
  ndjsonProtocol?: boolean;
};

export type GitSummary = {
  available: boolean;
  branch: string;
  insertions: number;
  deletions: number;
  changedFiles: number;
};

export type ContextAttachment = {
  id: string;
  kind: 'file' | 'directory' | 'terminal' | 'image' | 'text';
  label: string;
  path?: string;
  terminalId?: string;
  content?: string;
  base64?: string;
  mediaType?: string;
  tokenEstimate?: number;
};

export type ContextStatePayload = {
  attachments: ContextAttachment[];
  gathered: GatheredContextEntry[];
  gatheredTokens: number;
  activeRulePaths: string[];
  activeSkillNames: string[];
};

export type TerminalSummary = {
  terminalId: string;
  ptyId: string;
  name: string;
  alive: boolean;
  sequence: number;
  outputPreview: string;
  frameLanguage: 'bash' | 'powershell';
  role?: 'user' | 'agent';
  cwd?: string;
  ownerConversationId?: string;
  ownerId?: string;
  activeToolCallId?: string | null;
  awaitingInput?: boolean;
  exitCode?: number | null;
  truncated?: boolean;
  canUserWrite?: boolean;
  permissions?: TerminalPermissions;
};

export type TerminalPermissions = {
  read: boolean;
  write: boolean;
  respond: boolean;
  interrupt: boolean;
  kill: boolean;
  resize: boolean;
};

export type TerminalUpdatedPayload = {
  terminal: TerminalSummary;
  cause: 'created' | 'output' | 'state' | 'exit';
  turnId?: string;
  conversationId?: string;
};

export type FileChangeState = FileChangePending & {
  status: 'pending' | 'accepted' | 'rejected';
};

export type SddStatePayload = {
  sessionId: string | null;
  session: SddSession | null;
  tasks: SddTask[];
  phase: SddSession['status'] | null;
  spec: string | null;
  review: string | null;
  failedTask: SddTask | null;
};

export type ScopedHarnessEventPayload = {
  ownerId: string;
  event: HarnessEvent;
};

export type ProviderSummary = Pick<AIProvider, 'id' | 'name'> & {
  configured: boolean;
  models: AIModel[];
};

export type InteractionRequest =
  | {
      kind: 'approval';
      requestId: string;
      toolCall: {
        id: string;
        toolName: string;
        input: Record<string, unknown>;
        description: string;
        riskLevel?: ToolRiskLevel;
        externalAccess?: ExternalPathAccessRequest;
      };
    }
  | {
      kind: 'mode_switch';
      requestId: string;
      fromMode: string;
      toMode: string;
      reason: string;
      contextSummary: string;
    }
  | {
      kind: 'question';
      requestId: string;
      title?: string;
      questions: AgentQuestion[];
    };

export type InteractionResolution = {
  requestId: string;
  approved?: boolean;
  trustTool?: boolean;
  /** External path grant chosen by the user; absent means one invocation. */
  grant?: ExternalPathGrant;
  answers?: AgentQuestionAnswer[];
};

export type DiagnosticPayload = {
  level: 'info' | 'warning' | 'error';
  message: string;
};

export type HostRequestPayload = {
  requestId: string;
  method: string;
  params: Record<string, unknown>;
};

export type SessionSummary = {
  id: string;
  title: string;
  workspacePath: string;
  providerId: string | null;
  modelId: string | null;
  agentType: AgentType;
  updatedAt: string;
  messageCount: number;
};

export type SessionMessage = Message & {
  id: string;
  createdAt: string;
  tokenUsage?: TokenUsage;
};

export type SessionRecord = SessionSummary & {
  messages: SessionMessage[];
};

export type ProjectSummary = {
  workspacePath: string;
  sessionCount: number;
  updatedAt: string;
};

export type InitializeParams = {
  workspacePath: string;
  projectId?: string;
  configPath?: string;
  providerId?: string;
  modelId?: string;
  agentType?: AgentType;
  approvalMode?: ApprovalMode;
};

export type SendMessageParams = {
  message: string;
  history?: Message[];
  images?: Array<{ base64: string; mediaType: string }>;
  ruleTargetPaths?: string[];
  contextAttachments?: ContextAttachment[];
};

export type SetConfigParams = {
  themeId?: string;
  sidebarVisible?: boolean;
  providerId?: string;
  modelId?: string;
  approvalMode?: ApprovalMode;
  maxIterations?: number | null;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number | null;
  thinking?: ThinkingConfig;
  updateChannel?: 'stable' | 'pre-release';
  checkForUpdatesOnStartup?: boolean;
  autoDownload?: boolean;
};

export function pendingToolToInteraction(
  pending: Pick<
    PendingToolCall,
    'id' | 'toolName' | 'input' | 'description' | 'riskLevel' | 'externalAccess'
  >,
): InteractionRequest {
  return {
    kind: 'approval',
    requestId: pending.id,
    toolCall: {
      id: pending.id,
      toolName: pending.toolName,
      input: pending.input,
      description: pending.description,
      riskLevel: pending.riskLevel,
      ...(pending.externalAccess ? { externalAccess: pending.externalAccess } : {}),
    },
  };
}

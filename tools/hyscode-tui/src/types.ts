import type { AgentQuestion, AgentQuestionAnswer, AgentType, HarnessEvent } from '@hyscode/agent-harness';
import type { Message, TokenUsage } from '@hyscode/ai-providers';
import type {
  BridgeMessage,
  ContextStatePayload,
  InteractionRequest,
  ProjectSummary,
  RuntimeCapabilities,
  ProviderSummary,
  RuntimeReadyPayload,
  SessionRecord,
  SessionSummary,
  SddStatePayload,
  ThemeSummary,
  TerminalSummary,
} from '@hyscode/tui-runtime';

export const AGENT_TYPES: readonly AgentType[] = ['chat', 'build', 'review', 'debug', 'plan'];

export type CliOptions = {
  workspace: string;
  provider?: string;
  model?: string;
  mode?: AgentType;
  configPath?: string;
};

export type CliParseResult =
  | { kind: 'run'; options: CliOptions }
  | { kind: 'help'; text: string }
  | { kind: 'version'; text: string };

export type TranscriptKind = 'user' | 'assistant' | 'thinking' | 'tool' | 'result' | 'system' | 'error';

export type TranscriptItem = {
  kind: TranscriptKind;
  text: string;
};

export type ToolViewStatus = 'pending' | 'approved' | 'running' | 'success' | 'error' | 'cancelled';

export type ToolView = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: ToolViewStatus;
  description?: string;
  output?: string;
  error?: string;
  durationMs?: number;
  liveOutput: string;
  terminalId?: string;
  terminalState?: string;
  outputSequence: number;
  expanded: boolean;
  ownerId?: string;
};

export type FileChangeView = {
  toolCallId: string;
  toolName: string;
  filePath: string;
  originalContent: string | null;
  newContent: string;
  status: 'pending' | 'accepted' | 'rejected';
  expanded: boolean;
};

export type UsageView = {
  current: TokenUsage | null;
  session: TokenUsage | null;
  requestCount: number;
  estimatedCost: number;
  contextWindow: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ContextView = ContextStatePayload & {
  capabilities: RuntimeCapabilities | null;
};

export type SddView = SddStatePayload & {
  selectedTask: number;
};

export type SubAgentView = {
  ownerId: string;
  mode: AgentType | string;
  task: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  output: string;
  thinking: string;
  toolIds: string[];
  startedAt: number;
  endedAt: number | null;
};

export type RuntimeNotice = {
  id: string;
  level: 'info' | 'warning' | 'error' | 'success';
  text: string;
  createdAt: number;
};

export type TuiTab = {
  id: string;
  title: string;
  sessionId: string;
  active: boolean;
};

export type RuleView = { id: string; name: string; filePath: string; scope: string; origin: string; mandatory: boolean; enabled: boolean };
export type SkillView = { id: string; name: string; description: string; scope: string; activation: string; active: boolean; status: string };
export type MemoryView = { id: string; title: string; summary: string; type: string; relevance_score?: number };

export type ThinkingState = {
  enabled: boolean;
  level?: string;
};

export type ModelOption = RuntimeReadyPayload['models'][number];

export type ProviderOption = ProviderSummary;

export type InteractionState =
  | {
      kind: 'approval';
      requestId: string;
      toolName: string;
      description: string;
      risk: string;
      input: Record<string, unknown>;
    }
  | {
      kind: 'mode_switch';
      requestId: string;
      from: string;
      to: string;
      reason: string;
      contextSummary: string;
    }
  | {
      kind: 'question';
      requestId: string;
      title: string;
      questions: AgentQuestion[];
      questionIndex: number;
      selectedOption: number;
      answers: AgentQuestionAnswer[];
    };

export type Overlay = 'none' | 'help' | 'sessions' | 'projects' | 'commands';

export type MainPanel = 'chat' | 'terminal' | 'sdd' | 'activity';

export type RecoveryView = { action: 'continue' | 'retry'; partialText: string; retryCount: number; possibleDuplicateCharge: boolean };

export type SelectionFlowAction = 'approval' | 'context' | 'terminal' | 'diffs' | 'sdd' | 'tab';

export type CommandFlow =
  | { kind: 'root'; query: string; selected: number; inputDriven: boolean }
  | { kind: 'mode'; selected: number }
  | { kind: 'provider'; selected: number }
  | { kind: 'model'; providerIndex: number; selected: number }
  | { kind: 'thinking'; selected: number }
  | { kind: 'theme'; selected: number }
  | { kind: 'action'; action: SelectionFlowAction; selected: number }
  | { kind: 'context_remove'; selected: number }
  | { kind: 'terminal_attach'; selected: number }
  | { kind: 'terminal_select'; selected: number }
  | { kind: 'diff_file'; action: 'accept' | 'reject'; selected: number }
  | { kind: 'tab_select'; selected: number }
  | { kind: 'session_delete'; selected: number };

export type Focus = 'composer' | 'transcript' | 'sidebar';

export type Key =
  | { type: 'character'; value: string }
  | { type: 'enter' | 'shift_enter' | 'escape' | 'backspace' | 'delete' | 'tab' | 'shift_tab' | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'page_up' | 'page_down' | 'f1' }
  | { type: 'mouse'; action: 'scroll_up' | 'scroll_down'; x: number; y: number }
  | { type: 'ctrl'; value: 'c' | 'k' | 't' | 'u' | 'w' };

export type UiState = {
  input: string;
  inputCursor: number;
  inputHistory: string[];
  historyIndex: number | null;
  workspace: string;
  projectId: string;
  provider: string;
  model: string;
  themeId: string;
  themes: ThemeSummary[];
  sidebarVisible: boolean;
  mode: AgentType;
  sessionTitle: string;
  sessionMessageCount: number;
  tabs: TuiTab[];
  thinking: ThinkingState;
  approvalMode: string;
  status: string;
  running: boolean;
  shouldQuit: boolean;
  interaction: InteractionState | null;
  transcript: TranscriptItem[];
  tools: ToolView[];
  fileChanges: FileChangeView[];
  context: ContextView;
  terminals: TerminalSummary[];
  activeTerminalId: string | null;
  sdd: SddView;
  subagents: SubAgentView[];
  usage: UsageView;
  notices: RuntimeNotice[];
  connectionState: string;
  recovery: RecoveryView | null;
  mainPanel: MainPanel;
  capabilities: RuntimeCapabilities | null;
  selectedToolIndex: number;
  rules: RuleView[];
  skills: SkillView[];
  memories: MemoryView[];
  scroll: number;
  lastError: string | null;
  currentSessionId: string | null;
  lastUserMessage: string | null;
  sessions: SessionSummary[];
  projects: ProjectSummary[];
  providers: ProviderOption[];
  models: ModelOption[];
  overlay: Overlay;
  overlayIndex: number;
  commandFlow: CommandFlow | null;
  focus: Focus;
  width: number;
  height: number;
};

export type RuntimeMessage = BridgeMessage;

export type RuntimeHarnessEvent = Extract<BridgeMessage, { type: 'event'; event: 'harness_event' }>['payload'] & HarnessEvent;

export type SessionMessage = SessionRecord['messages'][number] & Message;

export type RuntimeEventHandler = (message: RuntimeMessage) => void;

export type RuntimeInteraction = Extract<InteractionRequest, { kind: 'question' }>;

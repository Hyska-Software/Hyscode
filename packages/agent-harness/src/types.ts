// ─── Agent Harness Types ────────────────────────────────────────────────────
// Core types for the agent harness orchestration engine.

import type { Message, StreamChunk, ToolDefinition, ThinkingConfig } from '@hyscode/ai-providers';
import type { MemoryManager } from './memory-manager';

// ─── Tool System ────────────────────────────────────────────────────────────

export type ToolCategory = 'filesystem' | 'terminal' | 'git' | 'code' | 'browser' | 'mcp' | 'meta' | 'docker';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolHandler {
  definition: ToolDefinition;
  category: ToolCategory;
  requiresApproval: boolean;
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>;
}

export interface ToolExecutionContext {
  workspacePath: string;
  conversationId: string;
  /** The ID of the current tool call (set per-call by the harness) */
  toolCallId: string;
  /** Aborted when the owning turn is cancelled or times out. */
  signal: AbortSignal;
  /** Invoke a Tauri command */
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  /** Listen to a Tauri event. Returns an unlisten function. */
  listen?: (event: string, handler: (payload: unknown) => void) => Promise<() => void>;
  /** Callback fired when a file-writing tool mutates a file on disk */
  onFileChange?: (change: FileChangePending) => void;
  /** Access to gathered-context operations (set by harness) */
  gatheredContext?: {
    add(path: string, content: string, relevance: number, reason: string): number;
    remove(path: string): boolean;
    has(path: string): boolean;
    getAll(): GatheredContextEntry[];
    getTokens(): number;
    clear(): void;
  };
  /** Ask the user a set of questions. Pauses the agent loop until answered. */
  askUser?: (questions: AgentQuestion[], title?: string) => Promise<AgentQuestionAnswer[]>;
  /** PTY id of the persistent agent terminal session (if available). When set,
   *  run_terminal_command writes to this shared PTY instead of spawning a new one. */
  agentTerminalPtyId?: string;
  /** Callback fired after a terminal command completes (for environment context tracking). */
  onTerminalCommand?: (command: string, output: string, exitCode: number | null) => void;
  /** Project ID for scoped operations (e.g. memory) */
  projectId?: string;
  /** Memory manager for persistent cross-session knowledge */
  memoryManager?: MemoryManager;
  /** Reports whether Monaco has unsaved buffers that Git mutations could overwrite. */
  hasDirtyBuffers?: () => boolean;
}

/** Emitted when a tool writes/edits/creates a file so the UI can track it */
export interface FileChangePending {
  toolCallId: string;
  toolName: string;
  filePath: string;
  /** null when the file is newly created */
  originalContent: string | null;
  newContent: string;
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output: ToolResult;
  durationMs: number;
  approved: boolean;
  timestamp: string;
}

// ─── Approval System ────────────────────────────────────────────────────────

export type ApprovalMode =
  | 'manual'         // Review every tool call
  | 'yolo'           // Auto-approve everything
  | 'smart'          // Auto-approve read-only, ask for destructive
  | 'notify'         // Auto-approve all but show notifications
  | 'session-trust'  // Approve once per tool type, then auto-approve
  | 'custom';        // Per-category/tool overrides

export interface ApprovalConfig {
  mode: ApprovalMode;
  /** Per-category overrides (only used in 'custom' mode) */
  categoryOverrides?: Partial<Record<ToolCategory, boolean>>;
  /** Per-tool overrides (highest priority) */
  toolOverrides?: Record<string, boolean>;
  /** Tools already trusted in this session (used by 'session-trust' mode) */
  sessionTrustedTools?: Set<string>;
}

/** Risk level assigned to each tool call for smart approval */
export type ToolRiskLevel = 'safe' | 'moderate' | 'destructive';

/** Map of tool categories to their default risk level */
export const CATEGORY_RISK: Record<ToolCategory, ToolRiskLevel> = {
  filesystem: 'moderate',
  terminal: 'destructive',
  git: 'destructive',
  code: 'safe',
  browser: 'safe',
  mcp: 'moderate',
  meta: 'safe',
  docker: 'moderate',
};

/** Read-only tools that are always safe regardless of category */
export const SAFE_TOOLS = new Set([
  'read_file',
  'list_directory',
  'search_files',
  'search_text',
  'get_file_info',
  'list_code_symbols',
  'get_diagnostics',
  'grep_search',
  'docker_list_containers',
  'docker_list_images',
  'docker_container_logs',
]);

/** Destructive tools that always need approval (even in smart mode) */
export const DESTRUCTIVE_TOOLS = new Set([
  'run_terminal_command',
  'git_commit',
  'git_push',
  'delete_file',
  'git_reset',
]);

export interface PendingToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  description: string;
  riskLevel?: ToolRiskLevel;
  resolve: (approved: boolean, reason?: string) => void;
}

// ─── Context Manager ────────────────────────────────────────────────────────

export type ContextPriority = 'always' | 'high' | 'medium' | 'low';

export interface ContextSource {
  id: string;
  type: 'active_file' | 'selection' | 'context_chip' | 'git_diff' | 'file_tree' | 'terminal' | 'search_results' | 'gathered_file';
  priority: ContextPriority;
  content: string;
  tokenEstimate: number;
  /** Relevance score (0-1) for gathered files. Higher = more important to keep in context. */
  relevance?: number;
  metadata?: Record<string, unknown>;
}

/** Entry in the agent's gathered context — files the agent decided are important. */
export interface GatheredContextEntry {
  /** Absolute file path */
  path: string;
  /** File content */
  content: string;
  /** Relevance score (0-1): 0.8-1.0 = will modify, 0.5-0.7 = reference, 0.2-0.4 = glance */
  relevance: number;
  /** Why the agent gathered this file */
  reason: string;
  /** Estimated token count */
  tokenEstimate: number;
  /** Timestamp when gathered */
  gatheredAt: string;
}

export interface TokenBudget {
  maxInput: number;
  maxOutput: number;
  reserved: {
    systemPrompt: number;
    toolDefinitions: number;
    responseBuffer: number;
  };
  available: number;
}

export interface ContextSnapshot {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  totalTokens: number;
  budget: TokenBudget;
}

// ─── Agent Definitions ──────────────────────────────────────────────────────

export type AgentType = 'chat' | 'build' | 'review' | 'debug' | 'plan';

export interface AgentDefinition {
  type: AgentType;
  name: string;
  description: string;
  /** Base system prompt for this agent */
  basePrompt: string;
  /** Which tool categories this agent can use */
  allowedToolCategories: ToolCategory[];
  /** Additional tool names that are explicitly allowed/denied */
  toolOverrides?: { allow?: string[]; deny?: string[] };
  /** Skills that are always active for this agent */
  defaultSkills?: string[];
  /** Max iterations per turn */
  maxIterations: number;
  /** Output token limit */
  maxOutputTokens: number;
}

// ─── Conversation ───────────────────────────────────────────────────────────

export type ConversationMode = 'chat' | 'agent' | 'sdd';

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  mode: ConversationMode;
  agentType: AgentType;
  messages: Message[];
  contextFiles: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── SDD (Spec-Driven Development) ─────────────────────────────────────────

export type SddStatus =
  | 'describing'
  | 'specifying'
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'completed'
  | 'cancelled';

export type SddTaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';

export interface SddSession {
  id: string;
  projectId: string;
  conversationId: string;
  description: string;
  spec: string | null;
  specApproved: boolean;
  tasks: SddTask[];
  status: SddStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SddTask {
  id: string;
  sessionId: string;
  ordinal: number;
  title: string;
  description: string;
  files: string[];
  dependencies: string[];
  status: SddTaskStatus;
  agentOutput: string | null;
  toolCalls: ToolCallRecord[];
  createdAt: string;
  updatedAt: string;
}

// ─── Harness Configuration ──────────────────────────────────────────────────

export interface HarnessConfig {
  /** Default provider ID */
  providerId: string;
  /** Default model ID */
  modelId: string;
  /** Max iterations per agent turn */
  maxIterations: number;
  /** Max total input tokens per turn */
  maxInputTokens: number;
  /** Max output tokens per turn */
  maxOutputTokens: number;
  /** Turn timeout in ms */
  turnTimeoutMs: number;
  /** Approval configuration */
  approval: ApprovalConfig;
  /** Thinking/reasoning configuration */
  thinking?: ThinkingConfig;
}

export type TurnStatus =
  | 'complete'
  | 'max_iterations'
  | 'loop_detected'
  | 'cancelled'
  | 'error';

export type TurnRequest = {
  userMessage: string;
  history: Message[];
  images?: Array<{ base64: string; mediaType: string }>;
};

export type TurnOutcome = {
  turnId: string;
  status: TurnStatus;
  response: string;
  toolCalls: ToolCallRecord[];
  turnRecord: TurnRecord;
};

export const DEFAULT_HARNESS_CONFIG: HarnessConfig = {
  providerId: '',
  modelId: '',
  maxIterations: 25,
  maxInputTokens: 200_000,
  maxOutputTokens: 16_000,
  turnTimeoutMs: 300_000, // 5 minutes
  approval: {
    mode: 'manual',
  },
};

// ─── Harness Events ─────────────────────────────────────────────────────────
// Events emitted by the harness for UI updates.

type HarnessEventPayload =
  | { type: 'turn_start'; conversationId: string; iteration: number }
  | { type: 'api_request_sent'; iteration: number; providerId: string; modelId: string }
  | { type: 'stream_chunk'; chunk: StreamChunk }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_call_pending'; pending: PendingToolCall }
  | { type: 'tool_call_notification'; toolCallId: string; toolName: string; description: string }
  | { type: 'tool_call_result'; toolCallId: string; toolName: string; result: ToolResult; durationMs: number }
  | { type: 'turn_end'; reason: 'complete' | 'max_iterations' | 'cancelled' | 'error'; error?: string }
  | { type: 'context_overflow'; droppedMessages: number; droppedCategories: Array<'history' | 'orphan_tool'> }
  | { type: 'sdd_phase_change'; phase: SddStatus }
  | { type: 'sdd_task_start'; task: SddTask }
  | { type: 'sdd_task_complete'; task: SddTask }
  | { type: 'file_change_pending'; change: FileChangePending }
  | { type: 'mode_switch_request'; request: ModeSwitchRequest }
  | { type: 'mode_switch_resolved'; request: ModeSwitchRequest; approved: boolean }
  | { type: 'context_gathered'; filePath: string; relevance: number; reason: string; tokenEstimate: number }
  | { type: 'context_dropped'; filePath: string }
  | { type: 'user_question_request'; id: string; title?: string; questions: AgentQuestion[] }
  | { type: 'user_question_answered'; id: string; answers: AgentQuestionAnswer[] }
  | { type: 'memories_extracted'; count: number; memories: Array<{ title: string; type: MemoryType }> }
  | { type: 'memory_recalled'; memoryId: string; title: string }
  | { type: 'memory_created'; memory: Pick<Memory, 'id' | 'title' | 'type' | 'summary'> };

/** Every runtime event is correlated to its owning turn/conversation when applicable. */
export type HarnessEvent = HarnessEventPayload & {
  turnId?: string;
  conversationId?: string;
};

export type HarnessEventHandler = (event: HarnessEvent) => void;

// ─── Mode Switch (Inter-Agent Delegation) ───────────────────────────────────

export interface ModeSwitchRequest {
  id: string;
  fromMode: AgentType;
  toMode: AgentType;
  reason: string;
  contextSummary: string;
}

// ─── Agent ↔ User Questions ─────────────────────────────────────────────────
// Allows the agent to ask the user clarifying questions mid-turn.

export interface AgentQuestion {
  /** Unique ID for this question (e.g. "q1", "layout") */
  id: string;
  /** The question text to display */
  question: string;
  /** Optional predefined options the user can pick from */
  options?: AgentQuestionOption[];
  /** Whether the user can type a free-form answer (default: true) */
  allowFreeform?: boolean;
}

export interface AgentQuestionOption {
  /** Display label */
  label: string;
  /** Optional description shown below the label */
  description?: string;
}

export interface AgentQuestionAnswer {
  /** Matches AgentQuestion.id */
  id: string;
  /** The user's answer (selected option label or free-form text) */
  answer: string;
}

// ─── Rule Types ─────────────────────────────────────────────────────────────

export type RuleScope = 'global' | 'workspace';

export interface Rule {
  id: string;
  name: string;
  filePath: string;
  scope: RuleScope;
  content: string;
  enabled: boolean;
}

// ─── Skill Types ────────────────────────────────────────────────────────────

export type SkillScope = 'built-in' | 'global' | 'workspace';
export type SkillActivation = 'always' | 'manual' | 'trigger';

export interface SkillFrontmatter {
  name: string;
  description: string;
  version: string;
  scope: SkillScope;
  activation: SkillActivation;
  trigger?: string;
  agents?: AgentType[];
  globs?: string[];
}

export type SkillStatus = 'ok' | 'missing-content';

export interface Skill {
  id: string;
  frontmatter: SkillFrontmatter;
  content: string;
  filePath: string;
  active: boolean;
  /** Whether the skill has valid content or is just an empty directory stub. */
  status: SkillStatus;
}

// ─── Agent Task System ──────────────────────────────────────────────────────
// Lightweight in-conversation task tracking (similar to how Copilot tracks todos).

export type AgentTaskStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';

export interface AgentTask {
  id: number;
  title: string;
  status: AgentTaskStatus;
  detail?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Turn Record ────────────────────────────────────────────────────────────
// Structured record of a complete agent turn for observability and tracing.

export interface TurnRecord {
  id: string;
  conversationId: string;
  /** Agent mode used for this turn */
  mode: AgentType;
  /** Number of LLM iterations within this turn */
  iterations: number;
  /** All tool calls executed during this turn */
  toolCalls: ToolCallRecord[];
  /** Token usage for this turn */
  tokenUsage: { input: number; output: number };
  /** Why the turn ended */
  stopReason: 'complete' | 'max_iterations' | 'cancelled' | 'error';
  /** Whether the agent performed verification (test/lint/diff) */
  verificationPerformed: boolean;
  /** Whether verification was forced by middleware */
  verificationForced: boolean;
  /** Files modified during this turn */
  filesModified: string[];
  /** Total wall-clock duration in ms */
  durationMs: number;
  /** ISO timestamp */
  timestamp: string;
  /** Full structured trace (attached by the harness after finalization) */
  trace?: import('./trace-recorder').Trace;
}

// ─── Memory System ──────────────────────────────────────────────────────────
// Persistent cross-session knowledge store scoped per project.

export type MemoryType =
  | 'fact'
  | 'decision'
  | 'preference'
  | 'pattern'
  | 'workflow'
  | 'error_solution'
  | 'convention'
  | 'user_preference'
  | 'architecture_knowledge';

export type MemoryStatus = 'active' | 'archived';
export type MemoryCreatedBy = 'agent' | 'user' | 'system';

export interface Memory {
  id: string;
  projectId?: string;
  type: MemoryType;
  title: string;
  content: string;
  /** Short summary (<=300 chars) for cheap context injection. */
  summary: string;
  tags: string[];
  sourceConversationId?: string;
  sourceMessageIds?: string[];
  /** 0.0–1.0. Auto-decays when not accessed. Higher = injected sooner. */
  relevanceScore: number;
  accessCount: number;
  lastAccessedAt?: string;
  createdBy: MemoryCreatedBy;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryQuery {
  projectId?: string;
  /** Free-text query for FTS5 search */
  query?: string;
  types?: MemoryType[];
  tags?: string[];
  minRelevance?: number;
  status?: MemoryStatus;
  limit?: number;
  offset?: number;
}

/** Candidate memory extracted by the automatic extractor pipeline. */
export interface MemoryExtraction {
  type: MemoryType;
  title: string;
  content: string;
  summary: string;
  tags: string[];
  /** Confidence in this extraction (0.0-1.0). Low confidence = not persisted. */
  confidence: number;
  /** Source message indices used for deduplication */
  sourceSignature?: string;
}

// ─── Environment Context ────────────────────────────────────────────────────
// Deterministic context package assembled at the start of each agent turn.

export interface EnvironmentContext {
  /** Current working directory / workspace root */
  workspacePath: string;
  /** Active file open in the editor (if any) */
  activeFile?: { path: string; content: string; language: string };
  /** Current text selection in the editor (if any) */
  selection?: { text: string; filePath: string; startLine: number; endLine: number };
  /** Top-level directory structure */
  directoryTree?: string;
  /** Git branch and summary of uncommitted changes */
  gitState?: { branch: string; uncommittedFiles: number; summary: string };
  /** Last terminal command and its output snippet */
  lastTerminalCommand?: { command: string; output: string; exitCode: number | null };
}

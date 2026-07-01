// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  ToolCategory,
  ToolResult,
  ToolHandler,
  ToolExecutionContext,
  ToolCallRecord,
  ApprovalMode,
  ApprovalConfig,
  PendingToolCall,
  ToolRiskLevel,
  ContextPriority,
  ContextSource,
  GatheredContextEntry,
  TokenBudget,
  ContextSnapshot,
  AgentType,
  AgentDefinition,
  ConversationMode,
  Conversation,
  SddStatus,
  SddTaskStatus,
  SddSession,
  SddTask,
  HarnessConfig,
  HarnessEvent,
  HarnessEventHandler,
  FileChangePending,
  ModeSwitchRequest,
  AgentQuestion,
  AgentQuestionOption,
  AgentQuestionAnswer,
  Rule,
  RuleScope,
  SkillScope,
  SkillActivation,
  SkillFrontmatter,
  Skill,
  SkillStatus,
  AgentTaskStatus,
  AgentTask,
  TurnRecord,
  TurnRequest,
  TurnOutcome,
  TurnStatus,
  TurnTerminalStatus,
  ConnectionState,
  TurnRecoveryAction,
  RecoverableTurnError,
  TurnIdentity,
  TranscriptBlock,
  TurnTranscript,
  EnvironmentContext,
  // Memory system
  Memory,
  MemoryType,
  MemoryStatus,
  MemoryCreatedBy,
  MemoryQuery,
  MemoryExtraction,
} from './types';
export { DEFAULT_HARNESS_CONFIG, SAFE_TOOLS, DESTRUCTIVE_TOOLS, CATEGORY_RISK } from './types';

// ─── Core Modules ───────────────────────────────────────────────────────────
export { Harness } from './harness';
export type { HarnessOptions } from './harness';

export { ContextManager } from './context-manager';
export { RequestPreparation, estimateActualCost } from './request-preparation';
export type { PreparedChatRequest, RequestCostBreakdown } from './request-preparation';
export { ToolRouter } from './tool-router';
export { SkillLoader } from './skill-loader';
export type { SkillLoaderConfig } from './skill-loader';

export { RuleLoader } from './rule-loader';
export type { RuleLoaderConfig } from './rule-loader';

// ─── Middleware ──────────────────────────────────────────────────────────────
export type { MiddlewareContext, PreCompletionHook, PostToolHook } from './middleware';
export { verificationMiddleware, LoopDetectionMiddleware, compactToolOutput } from './middleware';

// ─── Agents ─────────────────────────────────────────────────────────────────
export { getAgentDefinition, getAllAgentDefinitions, getAgentTypes } from './agents';

// ─── Tools ──────────────────────────────────────────────────────────────────
export { getAllBuiltinTools } from './tools';
export { resolveWorkspacePath } from './path-policy';
export type { WorkspacePathOptions } from './path-policy';

// ─── Memory System ──────────────────────────────────────────────────────────
export { MemoryManager } from './memory-manager';
export { MemoryExtractor } from './memory-extractor';
export { MemoryContextProvider } from './memory-context-provider';

// ─── SDD Engine ─────────────────────────────────────────────────────────────
export { SddEngine, PlanManager } from './sdd-engine';
export type { SddDatabase, SddEngineConfig } from './sdd-engine';

// ─── Tracing ────────────────────────────────────────────────────────────────
export { TraceRecorder, analyzeTraces } from './trace-recorder';
export type { Trace, TraceIteration, TraceAnalysisSummary } from './trace-recorder';

// ─── Mode Policies ──────────────────────────────────────────────────────────
export {
  getModePolicy,
  getAllModePolicies,
  getDefaultPolicy,
  applyPolicyOverride,
  resetPolicy,
  resetAllPolicies,
  adjustPolicyForModel,
  getModelProfile,
  isPerRequestCostModel,
} from './mode-policies';
export type { ModePolicy, ModelProfile } from './mode-policies';
export { resolveEffectiveAgentPolicy, effectivePolicyConfig } from './effective-policy';
export type { EffectiveAgentPolicy, EffectivePolicyPreferences } from './effective-policy';

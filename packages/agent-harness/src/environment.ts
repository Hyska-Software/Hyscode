import type { MemoryManager } from './memory-manager';
import type { RuleLoader } from './rule-loader';
import type { SkillLoader } from './skill-loader';
import type { SddDatabase } from './sdd-engine';
import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentType,
  ApprovalDecision,
  ToolApprovalRequest,
  TerminalRuntimeAdapter,
  ToolHandler,
} from './types';
import type { ExternalPathAccessRegistry } from './external-path-access';
import type { KanbanTaskIntegration } from './task-integration';

/** Shared runtime dependencies used by a parent harness and its child turns. */
export interface HarnessEnvironment {
  workspacePath: string;
  projectId: string;
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen?: (event: string, handler: (payload: unknown) => void) => Promise<() => void>;
  onApprovalRequest?: (
    pending: ToolApprovalRequest,
    signal: AbortSignal,
  ) => Promise<ApprovalDecision>;
  onModeSwitchRequest?: (
    request: {
      id: string;
      fromMode: string;
      toMode: string;
      reason: string;
      contextSummary: string;
    },
    signal: AbortSignal,
  ) => Promise<boolean>;
  onUserQuestionRequest?: (
    id: string,
    questions: AgentQuestion[],
    title: string | undefined,
    signal: AbortSignal,
  ) => Promise<AgentQuestionAnswer[]>;
  sddDb?: SddDatabase;
  savePlanFile?: (
    sessionId: string,
    spec: string,
    tasks: import('./types').SddTask[],
  ) => Promise<void>;
  skillLoader?: SkillLoader;
  ruleLoader?: RuleLoader;
  onTerminalCommand?: (command: string, output: string, exitCode: number | null) => void;
  terminalRuntime?: TerminalRuntimeAdapter;
  memoryManager?: MemoryManager;
  hasDirtyBuffers?: () => boolean;
  externalPathAccess?: ExternalPathAccessRegistry;
  /** Optional Desktop-only persistent Kanban integration. */
  taskIntegration?: KanbanTaskIntegration;
}

export type ChildHarnessOptions = {
  agentType: AgentType;
  config?: Partial<import('./types').HarnessConfig>;
  onEvent?: import('./types').HarnessEventHandler;
  onApprovalRequest?: HarnessEnvironment['onApprovalRequest'];
  externalTools?: ToolHandler[];
};

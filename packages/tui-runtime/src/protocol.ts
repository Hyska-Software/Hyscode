import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentType,
  ApprovalMode,
  HarnessEvent,
  PendingToolCall,
  ToolRiskLevel,
} from '@hyscode/agent-harness';
import type { AIModel, AIProvider, Message, ThinkingConfig, TokenUsage } from '@hyscode/ai-providers';

export type BridgeRequest = {
  id: string;
  method:
    | 'initialize'
    | 'send_message'
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
  | { type: 'event'; event: 'fatal'; payload: { message: string } };

export type BridgeMessage = BridgeResponse | BridgeEvent;

export type RuntimeReadyPayload = {
  protocolVersion: 1;
  workspacePath: string;
  projectId: string;
  providers: ProviderSummary[];
  models: AIModel[];
  agentTypes: AgentType[];
  modes: ApprovalMode[];
  activeAgentType: AgentType;
  activeProviderId: string;
  activeModelId: string;
  session?: SessionRecord;
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
};

export type SetConfigParams = {
  providerId?: string;
  modelId?: string;
  approvalMode?: ApprovalMode;
  maxIterations?: number | null;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number | null;
  thinking?: ThinkingConfig;
};

export function pendingToolToInteraction(
  pending: Pick<PendingToolCall, 'id' | 'toolName' | 'input' | 'description' | 'riskLevel'>,
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
    },
  };
}

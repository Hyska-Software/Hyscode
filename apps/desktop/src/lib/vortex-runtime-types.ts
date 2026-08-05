import type { AgentMode } from '@/stores/agent-store';

export type VortexRuntimeStatus =
  | 'idle'
  | 'starting'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface VortexRuntimeSnapshot {
  key: string;
  projectPath: string;
  projectName: string;
  conversationId: string;
  title: string;
  mode: AgentMode;
  status: VortexRuntimeStatus;
  messageCount: number;
  pendingApprovals: number;
  pendingUserQuestion: boolean;
  startedAt: number;
  updatedAt: number;
  error: string | null;
}

export function isVortexRuntimeActive(status: VortexRuntimeStatus): boolean {
  return ['starting', 'queued', 'running', 'waiting', 'cancelling'].includes(status);
}

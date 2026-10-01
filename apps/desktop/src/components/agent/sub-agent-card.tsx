import { memo, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { SubagentCard as AuroraSubagentCard } from '@hyscode/ui';
import type { AgentStatus } from '@hyscode/ui';
import type { AgentMode, SubAgentState, ToolCallDisplay } from '@/stores/agent-store';
import { useAgentStore } from '@/stores/agent-store';
import { useEditorStore } from '@/stores/editor-store';
import { SubAgentDetails, formatDuration, formatTokens } from './sub-agent-details';

// ─── Mode Config ─────────────────────────────────────────────────────────────

const MODE_LABELS: Record<AgentMode, string> = {
  build: 'Build sub-agent',
  review: 'Review sub-agent',
  debug: 'Debug sub-agent',
  plan: 'Plan sub-agent',
  chat: 'Chat sub-agent',
};

function mapStatus(status: string): AgentStatus {
  switch (status) {
    case 'queued':
      return 'pending';
    case 'running':
    case 'cancelling':
      return 'running';
    case 'done':
      return 'success';
    case 'error':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'running';
  }
}

// ─── SubAgentCard ─────────────────────────────────────────────────────────────

interface SubAgentCardProps {
  input: Record<string, unknown>;
  toolCallId: string;
  /** Transcript tool call, used when the live store entry is gone (reload). */
  toolCall?: ToolCallDisplay;
}

/**
 * Synthesize card state from the recorded tool call when the live store
 * entry is missing (session restore, reload). Pure — unit-tested.
 */
export function syntheticSubAgentState(
  toolCallId: string,
  input: Record<string, unknown>,
  toolCall?: ToolCallDisplay,
): SubAgentState {
  const task = typeof input.task === 'string' ? input.task : 'Sub-agent task';
  const mode = (input.mode as AgentMode) ?? 'build';
  const status: SubAgentState['status'] = !toolCall
    ? 'running'
    : toolCall.status === 'success'
      ? 'done'
      : toolCall.status === 'error'
        ? 'error'
        : toolCall.status === 'cancelled' || toolCall.status === 'cancelling'
          ? 'cancelled'
          : 'running';
  return {
    id: toolCallId,
    task,
    mode,
    status,
    output: toolCall?.output ?? toolCall?.error ?? '',
    toolCalls: [],
    startedAt: toolCall?.startedAt ?? Date.now(),
    ...(toolCall?.completedAt ? { completedAt: toolCall.completedAt } : {}),
  };
}

export const SubAgentCard = memo(function SubAgentCard({
  input,
  toolCallId,
  toolCall,
}: SubAgentCardProps) {
  const task = (input.task as string) ?? '';
  const mode = (input.mode as AgentMode) ?? 'build';
  const liveSubAgent = useAgentStore((s) => s.subAgents.find((a) => a.id === toolCallId));
  const subAgent = liveSubAgent ?? syntheticSubAgentState(toolCallId, input, toolCall);
  const isLive = liveSubAgent !== undefined;
  const status = subAgent.status;
  const isRunning = status === 'running';

  // Live elapsed-time ticker while the sub-agent is running.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const name = MODE_LABELS[mode] ?? MODE_LABELS.build;

  // ── Collapsed-header metadata: duration + token usage ──
  const durationMs = subAgent.completedAt
    ? subAgent.completedAt - subAgent.startedAt
    : isRunning
      ? now - subAgent.startedAt
      : null;
  const durationText = durationMs != null ? formatDuration(durationMs) : '';
  const usage = subAgent.tokenUsage;
  const metaParts: string[] = [];
  if (durationText) metaParts.push(durationText);
  if (usage && usage.totalTokens > 0) {
    metaParts.push(`${formatTokens(usage.totalTokens)} tok`);
    if (usage.requestCount) metaParts.push(`${usage.requestCount} req`);
  }
  const meta = metaParts.length > 0 ? metaParts.join(' · ') : null;

  const openInEditor = () => {
    const conversationId = subAgent.conversationId ?? useAgentStore.getState().conversationId ?? '';
    useEditorStore.getState().openSubAgentTab(subAgent, conversationId);
  };

  const result = (
    <div className="mt-1 space-y-1 border-l border-border pl-3">
      <button
        onClick={openInEditor}
        className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Open sub-agent execution in an editor tab"
      >
        <ExternalLink className="h-2.5 w-2.5" />
        Open in editor
      </button>
      {!isLive && (
        <p className="text-[11px] italic text-muted-foreground">
          Live sub-agent state unavailable — showing the recorded tool result.
        </p>
      )}
      <SubAgentDetails subAgent={subAgent} isRunning={isRunning} showCancel={isLive} />
    </div>
  );

  return (
    <div className="agent-fade-in my-3">
      <AuroraSubagentCard
        name={name}
        task={task}
        status={mapStatus(status)}
        meta={meta}
        result={result}
        defaultOpen={true}
      />
    </div>
  );
});

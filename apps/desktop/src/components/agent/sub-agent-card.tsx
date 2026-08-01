import { memo, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { SubagentCard as AuroraSubagentCard } from '@hyscode/ui';
import type { AgentStatus } from '@hyscode/ui';
import type { AgentMode } from '@/stores/agent-store';
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
    case 'queued': return 'pending';
    case 'running':
    case 'cancelling': return 'running';
    case 'done': return 'success';
    case 'error': return 'error';
    case 'cancelled': return 'cancelled';
    default: return 'running';
  }
}

// ─── SubAgentCard ─────────────────────────────────────────────────────────────

interface SubAgentCardProps {
  input: Record<string, unknown>;
  toolCallId: string;
}

export const SubAgentCard = memo(function SubAgentCard({ input, toolCallId }: SubAgentCardProps) {
  const task = (input.task as string) ?? '';
  const mode = (input.mode as AgentMode) ?? 'build';
  const subAgent = useAgentStore((s) => s.subAgents.find((a) => a.id === toolCallId));
  const status = subAgent?.status ?? 'running';
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
  const durationMs = subAgent?.completedAt
    ? subAgent.completedAt - subAgent.startedAt
    : isRunning && subAgent
      ? now - subAgent.startedAt
      : null;
  const durationText = durationMs != null ? formatDuration(durationMs) : '';
  const usage = subAgent?.tokenUsage;
  const metaParts: string[] = [];
  if (durationText) metaParts.push(durationText);
  if (usage && usage.totalTokens > 0) {
    metaParts.push(`${formatTokens(usage.totalTokens)} tok`);
    if (usage.requestCount) metaParts.push(`${usage.requestCount} req`);
  }
  const meta = metaParts.length > 0 ? metaParts.join(' · ') : null;

  const openInEditor = () => {
    if (!subAgent) return;
    const conversationId =
      subAgent.conversationId ?? useAgentStore.getState().conversationId ?? '';
    useEditorStore.getState().openSubAgentTab(subAgent, conversationId);
  };

  const result = (
    <div className="mt-1 space-y-1 border-l border-border pl-3">
      {subAgent && (
        <button
          onClick={openInEditor}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Open sub-agent execution in an editor tab"
        >
          <ExternalLink className="h-2.5 w-2.5" />
          Open in editor
        </button>
      )}
      {subAgent ? (
        <SubAgentDetails subAgent={subAgent} isRunning={isRunning} />
      ) : (
        <p className="text-[11px] italic text-muted-foreground">Sub-agent state not found.</p>
      )}
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

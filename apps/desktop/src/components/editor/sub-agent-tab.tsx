import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import type { AgentStatus } from '@hyscode/ui';
import { StatusIcon } from '@hyscode/ui';
import type { SubAgentState } from '@/stores/agent-store';
import { useAgentStore } from '@/stores/agent-store';
import { SubAgentDetails, formatDuration, formatTokens } from '../agent/sub-agent-details';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<string, string> = {
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

/**
 * Resolve the live sub-agent state across chat tabs.
 * Returns the live entry when found, otherwise undefined.
 */
export function resolveSubAgentState(
  state: ReturnType<typeof useAgentStore.getState>,
  conversationId: string,
  subAgentId: string,
): SubAgentState | undefined {
  if (state.conversationId === conversationId) {
    return state.subAgents.find((agent) => agent.id === subAgentId);
  }
  return state.tabStates[conversationId]?.subAgents.find((agent) => agent.id === subAgentId);
}

// ─── SubAgentTabView ─────────────────────────────────────────────────────────
// Editor tab showing the same execution body as the chat card, with live
// updates while the owning conversation is open and a frozen snapshot
// fallback when the chat tab has been closed.

export function SubAgentTabView({
  subAgentId,
  conversationId,
  snapshot,
}: {
  subAgentId: string;
  conversationId: string;
  snapshot: SubAgentState;
}) {
  const live = useAgentStore((s) => resolveSubAgentState(s, conversationId, subAgentId));
  const subAgent = live ?? snapshot;
  const isStale = !live;
  const isRunning = subAgent.status === 'running';

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const durationMs = subAgent.completedAt
    ? subAgent.completedAt - subAgent.startedAt
    : isRunning
      ? now - subAgent.startedAt
      : null;
  const metaParts: string[] = [];
  if (durationMs != null) metaParts.push(formatDuration(durationMs));
  if (subAgent.tokenUsage && subAgent.tokenUsage.totalTokens > 0) {
    metaParts.push(`${formatTokens(subAgent.tokenUsage.totalTokens)} tok`);
    if (subAgent.tokenUsage.requestCount) metaParts.push(`${subAgent.tokenUsage.requestCount} req`);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-3 py-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-info-500/10 text-info-600 dark:text-info-400 [&_svg]:size-3.5">
          <Bot />
        </span>
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {MODE_LABELS[subAgent.mode] ?? 'Sub-agent'}
        </span>
        {isStale && (
          <span className="shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
            stale snapshot — chat tab closed
          </span>
        )}
        {metaParts.length > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {metaParts.join(' · ')}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <StatusIcon status={mapStatus(subAgent.status)} className="size-3.5" />
          <span className="capitalize">{subAgent.status}</span>
        </span>
      </div>

      {/* Execution body — same interface as the chat card */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <SubAgentDetails subAgent={subAgent} isRunning={isRunning} />
      </div>
    </div>
  );
}

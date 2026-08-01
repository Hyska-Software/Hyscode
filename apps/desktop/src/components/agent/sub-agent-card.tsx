import { memo, useEffect, useRef, useState } from 'react';
import { Square, Timer } from 'lucide-react';
import { SubagentCard as AuroraSubagentCard } from '@hyscode/ui';
import type { AgentStatus } from '@hyscode/ui';
import type { AgentMode, ToolCallDisplay } from '@/stores/agent-store';
import { useAgentStore } from '@/stores/agent-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { useSettingsStore } from '@/stores/settings-store';
import { CompactToolCallRow } from './tool-call-card';
import { MarkdownContent } from './markdown-renderer';
import { ThinkingBlock } from './thinking-block';

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

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
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
  const toolCalls: ToolCallDisplay[] = subAgent?.toolCalls ?? [];
  const output = subAgent?.output ?? '';
  const isRunning = status === 'running';
  const isCancellable = status === 'queued' || status === 'running';
  const thinkingCollapsedByDefault = useSettingsStore((s) => s.thinkingCollapsedByDefault);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Live elapsed-time ticker while the sub-agent is running.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    if (isRunning && scrollRef.current && toolCalls.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolCalls.length, isRunning]);

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

  const result = (
    <div className="mt-1 space-y-1 border-l border-border pl-3">
      {subAgent?.thinking && (
        <ThinkingBlock
          content={subAgent.thinking}
          isStreaming={isRunning}
          defaultOpen={isRunning && !thinkingCollapsedByDefault}
        />
      )}
      {toolCalls.length > 0 && (
        <div ref={scrollRef} className="max-h-[320px] space-y-0.5 overflow-y-auto py-1">
          {toolCalls.map((tc) => (
            <CompactToolCallRow key={tc.id} toolCall={tc} />
          ))}
          {isRunning && (
            <div className="flex items-center gap-1.5 py-1 text-[10px] text-muted-foreground">
              <span className="flex gap-0.5">
                <span className="agent-dot-bounce h-1 w-1 rounded-full bg-primary/40" />
                <span className="agent-dot-bounce h-1 w-1 rounded-full bg-primary/40" style={{ animationDelay: '0.16s' }} />
                <span className="agent-dot-bounce h-1 w-1 rounded-full bg-primary/40" style={{ animationDelay: '0.32s' }} />
              </span>
              working...
            </div>
          )}
        </div>
      )}
      {status === 'queued' && (
        <div className="flex items-center gap-1.5 py-1 text-[10px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
          Waiting for a slot{typeof subAgent?.queuePosition === 'number' && subAgent.queuePosition > 1
            ? ` (position ${subAgent.queuePosition})`
            : ''}
          {subAgent?.resourceMode === 'exclusive' && ' · exclusive workspace'}
        </div>
      )}
      {isCancellable && (
        <button
          onClick={() => HarnessBridge.get().cancelSubAgent(toolCallId)}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        >
          <Square className="h-2.5 w-2.5" />
          Cancel sub-agent
        </button>
      )}
      {output && (
        <div className="pt-2">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {isRunning ? 'Streaming output' : 'Result'}
          </p>
          <div className="max-h-[400px] overflow-y-auto">
            {output.startsWith('__SUBAGENT_STATUS__:') ? (
              <p className="text-[11px] italic text-muted-foreground">
                {output.replace('__SUBAGENT_STATUS__:', '')}
              </p>
            ) : isRunning ? (
              // Plain text while streaming: markdown parsing of a growing
              // buffer on every chunk is the main card bottleneck.
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.65] text-foreground/80">
                {output}
              </pre>
            ) : (
              <MarkdownContent content={output} className="text-xs leading-[1.65]" />
            )}
          </div>
        </div>
      )}
      {usage && usage.totalTokens > 0 && (
        <p className="flex items-center gap-1 pt-1 text-[10px] text-muted-foreground">
          <Timer className="h-2.5 w-2.5" />
          {formatTokens(usage.totalTokens)} tokens · {usage.requestCount ?? 0} request(s)
        </p>
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

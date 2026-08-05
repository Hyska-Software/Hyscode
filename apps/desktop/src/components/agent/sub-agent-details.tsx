import { useEffect, useRef } from 'react';
import { Square, Timer } from 'lucide-react';
import type { SubAgentState, ToolCallDisplay } from '@/stores/agent-store';
import { useSettingsStore } from '@/stores/settings-store';
import { getActiveAgentBridge } from '@/lib/active-agent-bridge';
import { CompactToolCallRow } from './tool-call-card';
import { MarkdownContent } from './markdown-renderer';
import { ThinkingBlock } from './thinking-block';

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
}

// ─── SubAgentDetails ─────────────────────────────────────────────────────────
// Shared execution body used by the chat card and the editor tab.

export function SubAgentDetails({
  subAgent,
  isRunning,
  showCancel = true,
}: {
  subAgent: SubAgentState;
  isRunning: boolean;
  showCancel?: boolean;
}) {
  const toolCalls: ToolCallDisplay[] = subAgent.toolCalls ?? [];
  const output = subAgent.output ?? '';
  const isCancellable = subAgent.status === 'queued' || subAgent.status === 'running';
  const thinkingCollapsedByDefault = useSettingsStore((s) => s.thinkingCollapsedByDefault);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRunning && scrollRef.current && toolCalls.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolCalls.length, isRunning]);

  return (
    <div className="space-y-1">
      {subAgent.thinking && (
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
      {subAgent.status === 'queued' && (
        <div className="flex items-center gap-1.5 py-1 text-[10px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
          Waiting for a slot
          {typeof subAgent.queuePosition === 'number' && subAgent.queuePosition > 1
            ? ` (position ${subAgent.queuePosition})`
            : ''}
          {subAgent.resourceMode === 'exclusive' && ' · exclusive workspace'}
        </div>
      )}
      {showCancel && isCancellable && (
        <button
          onClick={() => getActiveAgentBridge().cancelSubAgent(subAgent.id)}
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
      {subAgent.tokenUsage && subAgent.tokenUsage.totalTokens > 0 && (
        <p className="flex items-center gap-1 pt-1 text-[10px] text-muted-foreground">
          <Timer className="h-2.5 w-2.5" />
          {formatTokens(subAgent.tokenUsage.totalTokens)} tokens ·{' '}
          {subAgent.tokenUsage.requestCount ?? 0} request(s)
        </p>
      )}
    </div>
  );
}

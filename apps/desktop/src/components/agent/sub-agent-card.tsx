import { memo, useEffect, useRef } from 'react';
import { SubagentCard as AuroraSubagentCard } from '@hyscode/ui';
import type { AgentStatus } from '@hyscode/ui';
import type { AgentMode, ToolCallDisplay } from '@/stores/agent-store';
import { useAgentStore } from '@/stores/agent-store';
import { CompactToolCallRow } from './tool-call-card';
import { MarkdownContent } from './markdown-renderer';

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
    case 'running': return 'running';
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
  const toolCalls: ToolCallDisplay[] = subAgent?.toolCalls ?? [];
  const output = subAgent?.output ?? '';
  const isRunning = status === 'running';
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRunning && scrollRef.current && toolCalls.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolCalls.length, isRunning]);

  const name = MODE_LABELS[mode] ?? MODE_LABELS.build;

  const result = (
    <div className="mt-1 space-y-1 border-l border-border pl-3">
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
            ) : (
              <MarkdownContent content={output} className="text-xs leading-[1.65]" />
            )}
          </div>
        </div>
      )}
      {subAgent?.tokenUsage && (
        <p className="pt-1 text-[10px] text-muted-foreground">
          {subAgent.tokenUsage.totalTokens.toLocaleString()} tokens ·{' '}
          {subAgent.tokenUsage.requestCount ?? 0} request(s)
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
        result={result}
        defaultOpen={true}
      />
    </div>
  );
});

import { useState, memo, useEffect, useRef } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Loader2,
  Hammer,
  Search,
  Bug,
  Map,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentMode, ToolCallDisplay } from '@/stores/agent-store';
import { useAgentStore } from '@/stores/agent-store';
import { CompactToolCallRow } from './tool-call-card';
import { MarkdownContent } from './markdown-renderer';

// ─── Mode Config ─────────────────────────────────────────────────────────────

const MODE_CONFIG: Record<AgentMode, { label: string; color: string; Icon: React.ElementType }> = {
  build: { label: 'Build', color: 'text-blue-400', Icon: Hammer },
  review: { label: 'Review', color: 'text-warning', Icon: Search },
  debug: { label: 'Debug', color: 'text-destructive', Icon: Bug },
  plan: { label: 'Plan', color: 'text-purple-400', Icon: Map },
  chat: { label: 'Chat', color: 'text-muted-foreground', Icon: Bot },
};

// ─── SubAgentCard ─────────────────────────────────────────────────────────────

interface SubAgentCardProps {
  /** The spawn_subagent tool call input */
  input: Record<string, unknown>;
  /** The stable tool call id — matches SubAgentState.id when present */
  toolCallId: string;
}

export const SubAgentCard = memo(function SubAgentCard({ input, toolCallId }: SubAgentCardProps) {
  const task = (input.task as string) ?? '';
  const mode = (input.mode as AgentMode) ?? 'build';

  const subAgent = useAgentStore((s) => s.subAgents.find((a) => a.id === toolCallId));

  const status = subAgent?.status ?? 'running';
  const toolCalls: ToolCallDisplay[] = subAgent?.toolCalls ?? [];
  const output = subAgent?.output ?? '';

  // Auto-expand while running so the user sees live progress
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isRunning = status === 'running';

  // Auto-scroll to bottom while running as new tool calls arrive
  useEffect(() => {
    if (isRunning && expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolCalls.length, isRunning, expanded]);

  const cfg = MODE_CONFIG[mode] ?? MODE_CONFIG.build;
  const { Icon: ModeIcon } = cfg;
  const hasBody = toolCalls.length > 0 || !!output;

  return (
    <div className="agent-fade-in my-3 border-l-2 border-foreground/[0.08] pl-3">
      {/* ── Header ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasBody}
        className={cn(
          'flex w-full items-center gap-2 py-1 text-left transition-colors',
          hasBody && 'cursor-pointer hover:text-foreground',
          !hasBody && 'cursor-default',
        )}
      >
        {/* Status icon */}
        <span className="flex-shrink-0">
          {status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          {status === 'done' && <Check className="h-3.5 w-3.5 text-success/80" />}
          {status === 'error' && <X className="h-3.5 w-3.5 text-destructive" />}
        </span>

        {/* Mode badge */}
        <span
          className={cn(
            'flex flex-shrink-0 items-center gap-1.5 text-[11px] font-semibold',
            cfg.color,
          )}
        >
          <ModeIcon className="h-3 w-3" />
          {cfg.label} sub-agent
        </span>

        {/* Task summary */}
        <span className="flex-1 truncate text-[11px] text-foreground/55">{task}</span>

        {/* Tool count badge */}
        {toolCalls.length > 0 && (
          <span className="flex-shrink-0 text-[10px] text-muted-foreground/50">
            {toolCalls.length} tool{toolCalls.length !== 1 ? 's' : ''}
          </span>
        )}

        {/* Chevron */}
        {hasBody && (
          <span className="flex-shrink-0 text-muted-foreground/30 transition-transform">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        )}
      </button>

      {/* ── Expanded body ── */}
      {expanded && hasBody && (
        <div className="mt-1 border-l border-foreground/[0.06] pl-3">
          {/* Scrollable tool call list */}
          {toolCalls.length > 0 && (
            <div
              ref={scrollRef}
              className="scrollbar-thin scrollbar-thumb-foreground/10 max-h-[320px] space-y-0.5 overflow-y-auto py-1"
            >
              {toolCalls.map((tc) => (
                <CompactToolCallRow key={tc.id} toolCall={tc} />
              ))}
              {/* Live pulse at bottom when running */}
              {isRunning && (
                <div className="flex items-center gap-1.5 py-1 text-[10px] text-muted-foreground/40">
                  <span className="flex gap-0.5">
                    <span className="agent-dot-bounce h-1 w-1 rounded-full bg-primary/40" />
                    <span
                      className="agent-dot-bounce h-1 w-1 rounded-full bg-primary/40"
                      style={{ animationDelay: '0.16s' }}
                    />
                    <span
                      className="agent-dot-bounce h-1 w-1 rounded-full bg-primary/40"
                      style={{ animationDelay: '0.32s' }}
                    />
                  </span>
                  working…
                </div>
              )}
            </div>
          )}

          {/* Output — rendered as markdown or as a status notice */}
          {output && (
            <div
              className={cn(
                'border-t border-foreground/[0.06] pt-2',
                toolCalls.length > 0 && 'mt-2',
              )}
            >
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                {isRunning ? 'Streaming output' : 'Result'}
              </p>
              {/* Scrollable markdown output */}
              <div className="scrollbar-thin scrollbar-thumb-foreground/10 max-h-[400px] overflow-y-auto">
                {output.startsWith('__SUBAGENT_STATUS__:') ? (
                  <p className="text-[11px] italic text-muted-foreground/60">
                    {output.replace('__SUBAGENT_STATUS__:', '')}
                  </p>
                ) : (
                  <MarkdownContent content={output} className="text-[12px] leading-[1.65]" />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

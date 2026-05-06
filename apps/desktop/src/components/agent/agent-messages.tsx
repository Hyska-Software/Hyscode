import { Sparkles, ChevronDown, ChevronRight, Brain, AlertCircle } from 'lucide-react';
import { useRef, useEffect, useState, memo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAgentStore } from '@/stores/agent-store';
import { ToolCallGroup } from './tool-call-card';
import { SubAgentCard } from './sub-agent-card';
import { ApprovalDialog } from './approval-dialog';
import { ModeSwitchDialog } from './mode-switch-dialog';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/stores/agent-store';
import { MarkdownContent } from './markdown-renderer';

// ─── Thinking Block (collapsible dropdown) ────────────────────────────────────

const ThinkingBlock = memo(function ThinkingBlock({
  content,
  isStreaming,
  defaultOpen = false,
}: {
  content: string;
  isStreaming?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="agent-fade-in my-0.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 rounded-md border border-foreground/[0.06] bg-muted/[0.15] px-2 py-1 text-left text-[10px] text-muted-foreground/70 transition-all hover:bg-muted/[0.35] hover:text-muted-foreground"
      >
        {open ? <ChevronDown className="h-2.5 w-2.5 shrink-0" /> : <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
        <Brain className="h-2.5 w-2.5 shrink-0 text-accent/60" />
        <span className="font-medium">Thinking</span>
        {isStreaming && (
          <span className="ml-0.5 flex items-center gap-[3px]">
            <span className="agent-dot-bounce h-1 w-1 rounded-full bg-accent/50" />
            <span className="agent-dot-bounce h-1 w-1 rounded-full bg-accent/50" style={{ animationDelay: '0.16s' }} />
            <span className="agent-dot-bounce h-1 w-1 rounded-full bg-accent/50" style={{ animationDelay: '0.32s' }} />
          </span>
        )}
        {!isStreaming && content && (
          <span className="ml-auto text-[9px] text-muted-foreground/40 font-normal">
            {content.split(/\s+/).filter(Boolean).length} words
          </span>
        )}
      </button>
      {open && (
        <div className="agent-fade-in mt-1 max-h-[260px] overflow-y-auto rounded-lg bg-muted/[0.2] ring-1 ring-inset ring-foreground/[0.06] px-3 py-2.5">
          <p className="text-[11px] leading-[1.72] text-foreground/60 whitespace-pre-wrap">{content}</p>
        </div>
      )}
    </div>
  );
});

// ─── Streaming Cursor ─────────────────────────────────────────────────────────

function StreamingIndicator() {
  return (
    <div className="agent-fade-in flex items-center gap-[4px] py-1.5">
      <span className="agent-dot-bounce h-[5px] w-[5px] rounded-full bg-accent/60" />
      <span className="agent-dot-bounce h-[5px] w-[5px] rounded-full bg-accent/60" style={{ animationDelay: '0.16s' }} />
      <span className="agent-dot-bounce h-[5px] w-[5px] rounded-full bg-accent/60" style={{ animationDelay: '0.32s' }} />
    </div>
  );
}

// ─── Agent Output Block (markdown, shown after tool calls) ────────────────────

const AgentOutputBlock = memo(function AgentOutputBlock({ content }: { content: string }) {
  return (
    <div className="agent-fade-in rounded-lg bg-muted/[0.1] ring-1 ring-inset ring-foreground/[0.05] px-3 py-2.5">
      <MarkdownContent content={content} />
    </div>
  );
});

// ─── Error Message ────────────────────────────────────────────────────────────

const ErrorMessage = memo(function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="agent-fade-in flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-red-500/10">
        <AlertCircle className="h-3 w-3 text-red-400" />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-red-400/70">Error</span>
        <p className="text-[12px] leading-relaxed text-red-300/90">{message}</p>
      </div>
    </div>
  );
});

// ─── Memoized Message Item ────────────────────────────────────────────────────

interface MessageItemProps {
  msg: ChatMessage;
  isConsecutiveAssistant: boolean;
  showSeparator: boolean;
  /** true only for the very last message when the agent is streaming */
  isActivelyStreaming: boolean;
}

const MessageItem = memo(function MessageItem({
  msg,
  isConsecutiveAssistant,
  showSeparator,
  isActivelyStreaming,
}: MessageItemProps) {
  const hasToolCalls = (msg.toolCalls?.length ?? 0) > 0;

  // Skip empty assistant messages that have no content, thinking, tool calls, or error
  const isEmptyAssistant =
    msg.role === 'assistant' &&
    !(msg.thinking || msg.content?.trim() || hasToolCalls || isActivelyStreaming || msg.isError);
  if (isEmptyAssistant) return null;

  // Skip empty user messages that have no text and no image blocks
  const hasUserContent = msg.content?.trim() || msg.blocks?.some((b) => b.type === 'image');
  const isEmptyUser = msg.role === 'user' && !hasUserContent;
  if (isEmptyUser) return null;

  return (
    <div className="group/msg">
      {/* User message — distinct bubble */}
      {msg.role === 'user' && (
        <div className="mb-1 mt-0.5">
          <div className="rounded-xl bg-muted/[0.4] ring-1 ring-inset ring-foreground/[0.05] px-3.5 py-2.5">
            {/* Render attached images from blocks */}
            {msg.blocks && msg.blocks.some((b) => b.type === 'image') && (
              <div className="flex flex-wrap gap-2 mb-2">
                {msg.blocks
                  .filter((b): b is import('@hyscode/ai-providers').ImageContent => b.type === 'image')
                  .map((img, i) => (
                    <img
                      key={i}
                      src={`data:${img.mediaType};base64,${img.base64}`}
                      alt="attached"
                      className="max-w-[240px] max-h-[180px] rounded-md border border-border/30 object-contain"
                    />
                  ))}
              </div>
            )}
            <MarkdownContent content={msg.content} />
          </div>
        </div>
      )}

      {/* Assistant message — flex layout with persistent icon column */}
      {msg.role === 'assistant' && (msg.thinking || msg.content?.trim() || hasToolCalls || isActivelyStreaming || msg.isError) && (
        <div className={cn('mb-1', isConsecutiveAssistant ? '' : 'mt-2')}>
          <div className="flex gap-2">
            {/* Icon column — shows avatar for first in group, spacer for consecutive */}
            {!isConsecutiveAssistant ? (
              <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md bg-accent/15">
                <Sparkles className="h-2.5 w-2.5 text-accent" />
              </div>
            ) : (
              <div className="w-4 shrink-0" />
            )}

            {/* Content column */}
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              {/* Role label (first in group only) */}
              {!isConsecutiveAssistant && (
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-medium text-muted-foreground/60">Agent</span>
                  {isActivelyStreaming && (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent/70 animate-pulse" />
                  )}
                </div>
              )}

              {/* Thinking block (collapsible dropdown) */}
              {msg.thinking && (
                <ThinkingBlock
                  content={msg.thinking}
                  isStreaming={isActivelyStreaming && !msg.content?.trim()}
                  defaultOpen={isActivelyStreaming || !msg.content?.trim()}
                />
              )}

              {hasToolCalls ? (
                /* Mid-loop message: show tool calls compactly, then agent output */
                <>
                  {/* Render sub-agent cards for spawn_subagent calls */}
                  {msg.toolCalls!
                    .filter((tc) => tc.name === 'spawn_subagent')
                    .map((tc) => (
                      <SubAgentCard key={tc.id} toolCallId={tc.id} input={tc.input} />
                    ))}
                  {/* Render all other tool calls via the standard group */}
                  <ToolCallGroup toolCalls={msg.toolCalls!} />
                  {msg.content?.trim() && <AgentOutputBlock content={msg.content} />}
                </>
              ) : msg.isError ? (
                <ErrorMessage message={msg.content} />
              ) : msg.content?.trim() ? (
                /* Final response: full markdown */
                <AgentOutputBlock content={msg.content} />
              ) : isActivelyStreaming ? (
                <StreamingIndicator />
              ) : null}
            </div>
          </div>
          {showSeparator && <div className="my-3 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />}
        </div>
      )}

    </div>
  );
});

// ─── Agent Messages ───────────────────────────────────────────────────────────

export function AgentMessages() {
  // Split selectors: messageCount + lastMessageId for knowing WHEN to re-render the list,
  // but individual messages are read per-item via stable references.
  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const pendingApprovals = useAgentStore((s) => s.pendingApprovals);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages (throttled to avoid jank during fast streaming)
  const lastScrollRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    // Throttle scroll to at most once per 100ms during streaming
    if (isStreaming && now - lastScrollRef.current < 100) return;
    lastScrollRef.current = now;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isStreaming, pendingApprovals.length]);

  // Empty state
  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="flex min-h-[200px] items-center justify-center p-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-raised">
                <Sparkles className="h-5 w-5 text-accent opacity-60" />
              </div>
              <p className="text-xs font-medium">How can I help?</p>
              <p className="max-w-[220px] text-[11px] leading-relaxed text-muted-foreground">
                Ask me to write code, explain concepts, review changes, or build features.
              </p>
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden">
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-0.5 px-4 py-3 max-w-[720px] mx-auto w-full">
          {messages.map((msg, idx) => {
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const nextMsg = idx < messages.length - 1 ? messages[idx + 1] : null;
            const isConsecutiveAssistant =
              msg.role === 'assistant' && prevMsg?.role === 'assistant';
            const showSeparator =
              msg.role === 'assistant' && nextMsg?.role === 'user';
            const isLast = idx === messages.length - 1;

            return (
              <MessageItem
                key={msg.id}
                msg={msg}
                isConsecutiveAssistant={isConsecutiveAssistant}
                showSeparator={showSeparator}
                isActivelyStreaming={isStreaming && isLast}
              />
            );
          })}

          {/* Pending approvals */}
          {pendingApprovals.map((approval) => (
            <ApprovalDialog key={approval.id} approval={approval} />
          ))}

          {/* Pending mode switch delegation */}
          <ModeSwitchDialog />

          {/* Scroll anchor */}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

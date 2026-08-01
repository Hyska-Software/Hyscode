import { memo } from 'react';
import { ThinkingBlock as AuroraThinkingBlock } from '@hyscode/ui';
import { ThinkingMarkdown } from './markdown-renderer';

// ─── Thinking Block (Aurora-styled, collapsible) ────────────────────────────
// Shared by the chat message list and sub-agent cards.

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  isStreaming,
  defaultOpen = false,
}: {
  content: string;
  isStreaming?: boolean;
  defaultOpen?: boolean;
}) {
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const label = (
    <span className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-muted-foreground">Thinking</span>
      {isStreaming && (
        <span className="flex items-center gap-[3px]">
          <span className="agent-dot-bounce h-1 w-1 rounded-full bg-primary/50" />
          <span className="agent-dot-bounce h-1 w-1 rounded-full bg-primary/50" style={{ animationDelay: '0.16s' }} />
          <span className="agent-dot-bounce h-1 w-1 rounded-full bg-primary/50" style={{ animationDelay: '0.32s' }} />
        </span>
      )}
      {!isStreaming && content && (
        <span className="text-[9px] font-normal text-muted-foreground/60">
          {wordCount} words
        </span>
      )}
    </span>
  );
  return (
    <AuroraThinkingBlock
      label={label}
      thinking={isStreaming}
      defaultOpen={defaultOpen}
      className="agent-fade-in text-[11px]"
    >
      <div className="border-l border-border pl-3 pt-1 pb-1">
        <ThinkingMarkdown
          content={content}
          className="text-[11px] leading-[1.72] text-foreground/60"
        />
      </div>
    </AuroraThinkingBlock>
  );
});

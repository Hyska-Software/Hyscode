import { useState } from 'react';
import { FileCode, Brain, Terminal, ChevronDown, ChevronRight } from 'lucide-react';
import { ContextPill } from '@hyscode/ui';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agent-store';

function relevanceColor(relevance: number): string {
  if (relevance >= 0.8) return 'text-success';
  if (relevance >= 0.5) return 'text-blue-400';
  return 'text-muted-foreground';
}

const pillSize = 'text-[11px] px-1 py-px [&_svg]:size-3 max-w-[10rem]';

export function ContextChipsBar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const contextFiles = useAgentStore((s) => s.contextFiles);
  const removeContextFile = useAgentStore((s) => s.removeContextFile);
  const gatheredContext = useAgentStore((s) => s.gatheredContext);
  const attachedImages = useAgentStore((s) => s.attachedImages);
  const attachedTerminal = useAgentStore((s) => s.attachedTerminal);

  const totalItems =
    contextFiles.length +
    gatheredContext.length +
    attachedImages.length +
    (attachedTerminal ? 1 : 0);

  if (totalItems === 0) return null;

  return (
    <div className="px-4 py-1">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="inline-flex items-center gap-0.5 rounded px-0.5 py-px text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {isExpanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <span>
          {totalItems} context {totalItems === 1 ? 'item' : 'items'}
        </span>
      </button>

      {isExpanded && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {contextFiles.length > 0 &&
            contextFiles.map((file) => {
              const basename = file.split(/[\\/]/).pop() ?? file;
              return (
                <ContextPill
                  key={file}
                  label={basename}
                  icon={<FileCode />}
                  onRemove={() => removeContextFile(file)}
                  className={pillSize}
                />
              );
            })}
          {attachedImages.length > 0 &&
            attachedImages.map((img) => (
              <ContextPill
                key={img.id}
                label={img.name}
                onRemove={() => useAgentStore.getState().removeAttachedImage(img.id)}
                className={pillSize}
              />
            ))}
          {attachedTerminal && (
            <ContextPill
              label={attachedTerminal.name}
              icon={<Terminal />}
              onRemove={() => useAgentStore.getState().setAttachedTerminal(null)}
              className={pillSize}
            />
          )}
          {gatheredContext.length > 0 &&
            gatheredContext.map((entry) => {
              const basename = entry.path.split(/[\\/]/).pop() ?? entry.path;
              return (
                <span
                  key={entry.path}
                  className="inline-flex items-center gap-1 rounded-md bg-card px-1 py-px text-[11px] text-foreground"
                  title={`${entry.path} (relevance: ${entry.relevance.toFixed(2)}, ~${entry.tokenEstimate} tokens)`}
                >
                  <Brain className={cn('size-3 shrink-0', relevanceColor(entry.relevance))} />
                  <span className="max-w-[10rem] truncate">{basename}</span>
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}

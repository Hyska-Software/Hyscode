import { FileCode, Brain, Terminal } from 'lucide-react';
import { ContextPill } from '@hyscode/ui';
import { useAgentStore } from '@/stores/agent-store';

function relevanceColor(relevance: number): string {
  if (relevance >= 0.8) return 'text-success';
  if (relevance >= 0.5) return 'text-blue-400';
  return 'text-muted-foreground';
}

export function ContextChipsBar() {
  const contextFiles = useAgentStore((s) => s.contextFiles);
  const removeContextFile = useAgentStore((s) => s.removeContextFile);
  const gatheredContext = useAgentStore((s) => s.gatheredContext);
  const attachedImages = useAgentStore((s) => s.attachedImages);
  const attachedTerminal = useAgentStore((s) => s.attachedTerminal);

  if (
    contextFiles.length === 0 &&
    gatheredContext.length === 0 &&
    attachedImages.length === 0 &&
    !attachedTerminal
  )
    return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2">
      {contextFiles.length > 0 &&
        contextFiles.map((file) => {
          const basename = file.split(/[\\/]/).pop() ?? file;
          return (
            <ContextPill
              key={file}
              label={basename}
              icon={<FileCode />}
              onRemove={() => removeContextFile(file)}
            />
          );
        })}
      {attachedImages.length > 0 &&
        attachedImages.map((img) => (
          <ContextPill
            key={img.id}
            label={img.name}
            onRemove={() => useAgentStore.getState().removeAttachedImage(img.id)}
          />
        ))}
      {attachedTerminal && (
        <ContextPill
          label={attachedTerminal.name}
          icon={<Terminal />}
          onRemove={() => useAgentStore.getState().setAttachedTerminal(null)}
        />
      )}
      {gatheredContext.length > 0 &&
        gatheredContext.map((entry) => {
          const basename = entry.path.split(/[\\/]/).pop() ?? entry.path;
          return (
            <span
              key={entry.path}
              className="inline-flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 text-xs text-foreground"
              title={`${entry.path} (relevance: ${entry.relevance.toFixed(2)}, ~${entry.tokenEstimate} tokens)`}
            >
              <Brain className={relevanceColor(entry.relevance)} />
              <span className="max-w-[120px] truncate">{basename}</span>
            </span>
          );
        })}
    </div>
  );
}

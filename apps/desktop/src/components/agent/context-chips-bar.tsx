import { FileCode, Brain, Terminal, X } from 'lucide-react';
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
      {contextFiles.length > 0 && (
        <>
          <span className="text-[10px] text-muted-foreground/50">Attached:</span>
          {contextFiles.map((file) => {
            const basename = file.split(/[\\/]/).pop() ?? file;
            return (
              <span
                key={file}
                className="group/chip flex items-center gap-1 rounded-md border border-foreground/[0.06] bg-transparent px-2 py-0.5 text-[10px] text-foreground/80 transition-colors hover:border-foreground/[0.12] hover:text-foreground"
                title={file}
              >
                <FileCode className="h-2.5 w-2.5 text-muted-foreground/50" />
                <span className="max-w-[120px] truncate">{basename}</span>
                <button
                  onClick={() => removeContextFile(file)}
                  className="ml-0.5 rounded-full p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-foreground group-hover/chip:opacity-100"
                >
                  <X className="h-2 w-2" />
                </button>
              </span>
            );
          })}
        </>
      )}
      {attachedImages.length > 0 && (
        <>
          <span className="ml-1 text-[10px] text-muted-foreground/50">Images:</span>
          {attachedImages.map((img) => (
            <span
              key={img.id}
              className="group/chip flex items-center gap-1 rounded-md border border-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/80"
              title={img.name}
            >
              <img
                src={img.previewUrl}
                alt={img.name}
                className="h-4 w-4 rounded-sm object-cover"
              />
              <span className="max-w-[80px] truncate">{img.name}</span>
              <button
                onClick={() => useAgentStore.getState().removeAttachedImage(img.id)}
                className="ml-0.5 rounded-full p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-foreground group-hover/chip:opacity-100"
              >
                <X className="h-2 w-2" />
              </button>
            </span>
          ))}
        </>
      )}
      {attachedTerminal && (
        <span
          className="group/chip flex items-center gap-1 rounded-md border border-foreground/[0.06] px-2 py-0.5 text-[10px] text-foreground/80"
          title={`Terminal snapshot: ${attachedTerminal.name}`}
        >
          <Terminal className="h-2.5 w-2.5 text-muted-foreground/50" />
          <span className="max-w-[120px] truncate">{attachedTerminal.name}</span>
          <button
            onClick={() => useAgentStore.getState().setAttachedTerminal(null)}
            className="ml-0.5 rounded-full p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-foreground group-hover/chip:opacity-100"
          >
            <X className="h-2 w-2" />
          </button>
        </span>
      )}
      {gatheredContext.length > 0 && (
        <>
          <span className="ml-1 text-[10px] text-muted-foreground/50">Gathered:</span>
          {gatheredContext.map((entry) => {
            const basename = entry.path.split(/[\\/]/).pop() ?? entry.path;
            return (
              <span
                key={entry.path}
                className="flex items-center gap-1 rounded-md border border-foreground/[0.04] bg-transparent px-2 py-0.5 text-[10px] text-foreground/70"
                title={`${entry.path} (relevance: ${entry.relevance.toFixed(2)}, ~${entry.tokenEstimate} tokens)`}
              >
                <Brain className={`h-2.5 w-2.5 ${relevanceColor(entry.relevance)}`} />
                <span className="max-w-[120px] truncate">{basename}</span>
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}

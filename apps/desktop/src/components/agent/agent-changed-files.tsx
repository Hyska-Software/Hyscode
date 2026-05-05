import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Check, Undo2, FileCode2, FileText } from 'lucide-react';
import { useAgentStore } from '@/stores/agent-store';
import { useEditorStore } from '@/stores/editor-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { cn } from '@/lib/utils';
import { detectLanguage } from '@/lib/lsp-bridge';
import type { AgentEditSession } from '@/stores/agent-store';

function computeLineCounts(session: AgentEditSession) {
  const oldLines = session.originalContent?.split('\n').length ?? 0;
  const newLines = session.newContent.split('\n').length;
  const added = Math.max(0, newLines - oldLines);
  const removed = Math.max(0, oldLines - newLines);
  return { added, removed };
}

export function AgentChangedFiles() {
  const [expanded, setExpanded] = useState(true);

  const allSessions = useAgentStore((s) => s.agentEditSessions);
  const sessions = useMemo(
    () => allSessions.filter(
      (es) => es.phase === 'streaming' || es.phase === 'pending_review',
    ),
    [allSessions],
  );

  const totalStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const s of sessions) {
      const c = computeLineCounts(s);
      added += c.added;
      removed += c.removed;
    }
    return { added, removed };
  }, [sessions]);

  if (sessions.length === 0) return null;

  const handleAcceptAll = () => {
    HarnessBridge.get().resolveAllEditSessions(true);
  };

  const handleRejectAll = () => {
    HarnessBridge.get().resolveAllEditSessions(false);
  };

  const handleOpenFile = (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    useEditorStore.getState().openTab({
      id: filePath,
      filePath,
      fileName,
      language: detectLanguage(filePath),
    });
  };

  return (
    <div className="agent-fade-in shrink-0 border-t border-border/10 bg-surface-raised/[0.04]">
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left hover:bg-white/[0.02] transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
        )}
        <FileText className="h-3 w-3 text-muted-foreground/40" />
        <span className="text-[11px] text-muted-foreground/60">
          {sessions.length} {sessions.length === 1 ? 'file' : 'files'} changed
        </span>
        <span className="ml-1 flex items-center gap-1 text-[10px] tabular-nums">
          {totalStats.added > 0 && (
            <span className="text-green-400">+{totalStats.added}</span>
          )}
          {totalStats.removed > 0 && (
            <span className="text-red-400">-{totalStats.removed}</span>
          )}
        </span>

        {/* Keep / Undo */}
        <div className="ml-auto flex items-center gap-1">
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); handleAcceptAll(); }}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-green-400 hover:bg-green-500/15 transition-colors"
          >
            <Check className="h-3 w-3" />
            Keep
          </span>
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); handleRejectAll(); }}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Undo2 className="h-3 w-3" />
            Undo
          </span>
        </div>
      </button>

      {/* File list */}
      {expanded && (
        <div className="flex flex-col gap-1 px-2 pb-2">
          {sessions.map((session) => {
            const fileName = session.filePath.split(/[\\/]/).pop() ?? session.filePath;
            const dir = session.filePath.split(/[\\/]/).slice(-2, -1)[0] ?? '';
            const { added, removed } = computeLineCounts(session);

            return (
              <button
                key={session.id}
                onClick={() => handleOpenFile(session.filePath)}
                className={cn(
                  'flex items-center gap-2 rounded-md border border-border/10 bg-surface-raised/[0.04] px-3 py-[4px] text-left hover:bg-white/[0.02] transition-colors group',
                )}
              >
                <FileCode2 className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span className="truncate font-mono text-[11px] text-muted-foreground/70">{fileName}</span>
                {dir && (
                  <span className="truncate text-[10px] text-muted-foreground/40">{dir}</span>
                )}
                <span className="shrink-0 ml-auto flex items-center gap-1 text-[10px] tabular-nums">
                  {added > 0 && <span className="text-green-400">+{added}</span>}
                  {removed > 0 && <span className="text-red-400">-{removed}</span>}
                  {added === 0 && removed === 0 && (
                    <span className="text-muted-foreground/30">~</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

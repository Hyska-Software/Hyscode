import { KanbanSquare, CircleStop, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { KanbanTask } from '@hyscode/agent-harness';
import { useKanbanStore } from '@/stores/kanban-store';
import { useLayoutStore } from '@/stores/layout-store';

function stateLabel(state: NonNullable<KanbanTask['activeRun']>['state']): string {
  return state.replace('_', ' ').replace(/^\w/, (value) => value.toUpperCase());
}

export function AgentTaskContextCard({ task }: { task: KanbanTask }) {
  const run = task.activeRun;
  const cancelTask = useKanbanStore((state) => state.cancelTask);
  const delegateTask = useKanbanStore((state) => state.delegateTask);
  const setKanbanOpen = useLayoutStore((state) => state.setKanbanOpen);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const displayRun = run ?? task.latestRun;
  if (!displayRun) return null;

  const retry = async (): Promise<void> => {
    setIsRetrying(true);
    setRetryError(null);
    try {
      await delegateTask({
        taskId: task.id,
        mode: displayRun.mode,
        instructions: displayRun.instructions || task.description || task.title,
      });
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-primary/20 bg-primary/5 px-3 py-1.5">
      <KanbanSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-foreground">
          <span className="truncate font-semibold">{task.title}</span>
          <span className="shrink-0 text-primary">· {stateLabel(displayRun.state)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[9px] text-muted-foreground">
          <span>{displayRun.mode === 'dedicated_session' ? 'Dedicated VORTEX session' : 'Current chat'}</span>
          {displayRun.providerId && <span>· {displayRun.providerId}</span>}
          {displayRun.modelId && <span>· {displayRun.modelId}</span>}
          {displayRun.summary && <span className="truncate">· {displayRun.summary}</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setKanbanOpen(true)}
        className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[9px] text-primary hover:bg-primary/10"
        title="Open Kanban"
      >
        <ExternalLink className="h-3 w-3" />
        Board
      </button>
      {run ? (
        <button
          type="button"
          onClick={() => void cancelTask(run.id)}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[9px] text-destructive hover:bg-destructive/10"
          title="Stop task"
        >
          <CircleStop className="h-3 w-3" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void retry()}
          disabled={isRetrying}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[9px] text-primary hover:bg-primary/10 disabled:opacity-50"
          title="Retry task"
        >
          Retry
        </button>
      )}
      {retryError && <span className="max-w-40 truncate text-[9px] text-destructive">{retryError}</span>}
    </div>
  );
}

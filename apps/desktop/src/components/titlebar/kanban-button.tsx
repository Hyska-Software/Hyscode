import { KanbanSquare } from 'lucide-react';
import { useLayoutStore } from '../../stores/layout-store';
import { useProjectStore } from '../../stores/project-store';

export function KanbanButton() {
  const projectOpen = useProjectStore((state) => Boolean(state.rootPath && !state.isLoading));
  const open = useLayoutStore((state) => state.kanbanOpen);
  const toggleKanban = useLayoutStore((state) => state.toggleKanban);

  return (
    <button
      type="button"
      onClick={toggleKanban}
      disabled={!projectOpen}
      aria-label="Toggle Kanban"
      aria-pressed={open}
      title={projectOpen ? 'Open Kanban' : 'Open a project to use Kanban'}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary/15 aria-pressed:text-primary"
    >
      <KanbanSquare className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Kanban</span>
    </button>
  );
}

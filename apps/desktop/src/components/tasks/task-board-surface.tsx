import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { KanbanSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KanbanBoard } from './task-board';

export function TaskBoardSurface({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onMouseDown={onClose}
        aria-hidden="true"
      />
      <section className="relative flex h-[min(900px,calc(100vh-2rem))] w-[min(1500px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-card/90 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <KanbanSquare className="size-4" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground">Project Kanban</p>
              <p className="text-[10px] text-muted-foreground">Desktop workspace</p>
            </div>
          </div>
          <Button
            type="button"
            onClick={onClose}
            variant="ghost"
            size="icon-sm"
            aria-label="Close Kanban"
            title="Close Kanban"
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <KanbanBoard />
        </div>
      </section>
    </div>,
    document.body,
  );
}

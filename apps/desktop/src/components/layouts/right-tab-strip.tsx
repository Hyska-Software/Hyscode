import { PanelRightClose, Plus, X } from 'lucide-react';
import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { RightTab } from '@/stores/layout-store';
import { cn } from '@/lib/utils';
import { TabBadge } from '../ui/tab-badge';
import { RIGHT_TAB_DESCRIPTORS } from './right-tab-model';

interface RightTabStripProps {
  visibleTabs: RightTab[];
  activeTab: RightTab | null;
  pendingCount: number;
  terminalActive: boolean;
  menuOpen: boolean;
  onSelect: (tab: RightTab) => void;
  onClose: (tab: RightTab) => void;
  onCollapse: () => void;
  onOpenMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onReorder: (from: RightTab, to: RightTab) => void;
}

export function RightTabStrip({
  visibleTabs,
  activeTab,
  pendingCount,
  terminalActive,
  menuOpen,
  onSelect,
  onClose,
  onCollapse,
  onOpenMenu,
  onContextMenu,
  onReorder,
}: RightTabStripProps) {
  const [draggedTab, setDraggedTab] = useState<RightTab | null>(null);
  const [dragOverTab, setDragOverTab] = useState<RightTab | null>(null);
  const dragCounterRef = useRef(0);

  const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>, tab: RightTab) => {
    setDraggedTab(tab);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tab);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedTab(null);
    setDragOverTab(null);
    dragCounterRef.current = 0;
  }, []);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>, tab: RightTab) => {
    event.preventDefault();
    dragCounterRef.current += 1;
    setDragOverTab(tab);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setDragOverTab(null);
      dragCounterRef.current = 0;
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, targetTab: RightTab) => {
      event.preventDefault();
      const sourceTab = draggedTab;
      handleDragEnd();
      if (sourceTab && sourceTab !== targetTab) onReorder(sourceTab, targetTab);
    },
    [draggedTab, handleDragEnd, onReorder],
  );

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, tab: RightTab) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(tab);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onClose(tab);
      }
    },
    [onClose, onSelect],
  );

  return (
    <div
      onContextMenu={onContextMenu}
      role="toolbar"
      aria-label="Right panel surfaces"
      className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border/30 bg-surface px-2"
    >
      <button
        type="button"
        onClick={onCollapse}
        title="Collapse panel"
        aria-label="Collapse panel"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PanelRightClose className="h-3.5 w-3.5" />
      </button>

      <div
        role="tablist"
        aria-label="Right panel surfaces"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-hide"
      >
        {visibleTabs.map((id) => {
          const descriptor = RIGHT_TAB_DESCRIPTORS[id];
          const Icon = descriptor.icon;
          const isActive = activeTab === id;
          const isDraggedOver = dragOverTab === id && draggedTab !== id;

          return (
            <div
              key={id}
              draggable
              role="tab"
              aria-selected={isActive}
              aria-label={descriptor.label}
              tabIndex={isActive ? 0 : -1}
              onDragStart={(event) => handleDragStart(event, id)}
              onDragEnd={handleDragEnd}
              onDragEnter={(event) => handleDragEnter(event, id)}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={(event) => handleDrop(event, id)}
              onClick={() => onSelect(id)}
              onKeyDown={(event) => handleTabKeyDown(event, id)}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(id);
                }
              }}
              className={cn(
                'group flex shrink-0 cursor-grab select-none items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground',
                draggedTab === id && 'opacity-50',
                isDraggedOver && 'border-l-2 border-primary',
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span className="max-w-[120px] truncate">{descriptor.label}</span>
              {id === 'changes' && <TabBadge count={pendingCount} />}
              {id === 'terminal' && terminalActive && (
                <span className="relative flex h-2 w-2" aria-label="Terminal is active">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(id);
                }}
                tabIndex={-1}
                aria-label={`Close ${descriptor.label} tab`}
                title={`Close ${descriptor.label}`}
                className="-ml-1.5 flex h-4 w-0 shrink-0 items-center justify-center overflow-hidden rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:ml-0 group-hover:w-4 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOpenMenu}
        title="Open a surface"
        aria-label="Open a surface"
        aria-expanded={menuOpen}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          menuOpen && 'bg-muted text-foreground',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

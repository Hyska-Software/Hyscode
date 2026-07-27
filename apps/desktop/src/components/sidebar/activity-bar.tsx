import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Blocks,
  Bot,
  BrainCircuit,
  CheckSquare,
  Container,
  Files,
  FolderKanban,
  GitBranch,
  LayoutList,
  Puzzle,
  Search,
  Settings,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { useSettingsStore } from '../../stores';
import { useAgentStore } from '../../stores/agent-store';
import { useDockerStore } from '../../stores/docker-store';
import { useExtensionStore } from '../../stores/extension-store';
import { useGitStore } from '../../stores/git-store';
import type { SidebarViewId } from '../../stores/layout-store';
import { useViewRegistryStore } from '../../stores/view-registry-store';
import { cn } from '../../lib/utils';
import { ActivityBarContextMenu, type ActivityBarMenuItem } from './activity-bar-context-menu';
import {
  arraysEqual,
  createSidebarViewDescriptors,
  getSidebarDropPosition,
  isSidebarViewVisible,
  moveSidebarView,
  normalizeSidebarViewOrder,
  orderSidebarViewDescriptors,
  type SidebarDropPosition,
} from '../../lib/activity-bar-model';
import type { SidebarView } from './sidebar';

const ACTIVITY_BAR_DRAG_TYPE = 'application/x-hyscode-sidebar-view';

const EXTENSION_ICON_MAP: Record<string, LucideIcon> = {
  '$(checklist)': CheckSquare,
  '$(folder-library)': FolderKanban,
  '$(list-tree)': LayoutList,
};

const BUILTIN_ICON_MAP: Record<SidebarViewId, LucideIcon> = {
  files: Files,
  search: Search,
  git: GitBranch,
  skills: Puzzle,
  extensions: Blocks,
  agent: Bot,
  memories: BrainCircuit,
  devices: Smartphone,
  docker: Container,
};

type ActivityBarProps = {
  orientation: 'vertical' | 'horizontal';
  active: SidebarView;
  onSelect: (view: SidebarView) => void;
};

type DropTarget = {
  id: string;
  position: SidebarDropPosition;
};

function ActivityBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function ActivityBar({ orientation, active, onSelect }: ActivityBarProps) {
  const openSettings = useSettingsStore((state) => state.openSettings);
  const sidebarViewOrder = useSettingsStore((state) => state.sidebarViewOrder);
  const visibleSidebarTabs = useSettingsStore((state) => state.visibleSidebarTabs);
  const visibleExtensionViews = useSettingsStore((state) => state.visibleExtensionViews);
  const setSidebarViewOrder = useSettingsStore((state) => state.setSidebarViewOrder);
  const extensionViews = useExtensionStore((state) => state.contributions.views);
  const viewBadges = useViewRegistryStore((state) => state.badges);

  const gitCount = useGitStore(
    (state) =>
      state.staged.length + state.unstaged.length + state.untracked.length + state.conflicts.length,
  );
  const runningContainers = useDockerStore(
    (state) =>
      state.containers.filter((container) => container.state.toLowerCase() === 'running').length,
  );
  const pendingAgentSessions = useAgentStore(
    (state) =>
      state.agentEditSessions.filter(
        (session) => session.phase === 'streaming' || session.phase === 'pending_review',
      ).length,
  );
  const disabledExtensions = useExtensionStore(
    (state) => state.extensions.filter((extension) => !extension.enabled).length,
  );

  const descriptors = useMemo(() => createSidebarViewDescriptors(extensionViews), [extensionViews]);
  const availableIds = useMemo(() => descriptors.map((descriptor) => descriptor.id), [descriptors]);
  const normalizedOrder = useMemo(
    () => normalizeSidebarViewOrder(sidebarViewOrder, availableIds),
    [sidebarViewOrder, availableIds],
  );
  const orderedDescriptors = useMemo(
    () => orderSidebarViewDescriptors(descriptors, normalizedOrder),
    [descriptors, normalizedOrder],
  );
  const extensionIconById = useMemo(
    () =>
      new Map(
        extensionViews.map((view) => [
          view.id,
          (view.icon && EXTENSION_ICON_MAP[view.icon]) || LayoutList,
        ]),
      ),
    [extensionViews],
  );
  const orderedItems = useMemo<ActivityBarMenuItem[]>(
    () =>
      orderedDescriptors.map((descriptor) => ({
        id: descriptor.id,
        label: descriptor.label,
        icon:
          descriptor.kind === 'builtin'
            ? BUILTIN_ICON_MAP[descriptor.id as SidebarViewId]
            : (extensionIconById.get(descriptor.id) ?? LayoutList),
      })),
    [extensionIconById, orderedDescriptors],
  );
  const visibility = useMemo(
    () => ({ builtin: visibleSidebarTabs, extension: visibleExtensionViews }),
    [visibleExtensionViews, visibleSidebarTabs],
  );
  const visibleItems = useMemo(
    () => orderedItems.filter((item) => isSidebarViewVisible(item.id, visibility)),
    [orderedItems, visibility],
  );

  useEffect(() => {
    if (!arraysEqual(sidebarViewOrder, normalizedOrder)) setSidebarViewOrder(normalizedOrder);
  }, [normalizedOrder, setSidebarViewOrder, sidebarViewOrder]);

  const badges: Partial<Record<string, number>> = {
    git: gitCount,
    docker: runningContainers,
    agent: pendingAgentSessions,
    extensions: disabledExtensions,
  };

  const isVertical = orientation === 'vertical';
  const buttonSize = isVertical ? 'h-9 w-9' : 'h-7 w-7';
  const iconSize = isVertical ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5';
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (isVertical || !scrollRef.current) return;
      event.preventDefault();
      scrollRef.current.scrollBy({
        left: event.deltaY || event.deltaX,
        behavior: 'smooth',
      });
    },
    [isVertical],
  );

  const handleDragStart = useCallback((event: React.DragEvent, id: string) => {
    setContextMenu(null);
    setDraggedId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(ACTIVITY_BAR_DRAG_TYPE, id);
  }, []);

  const clearDragState = useCallback(() => {
    setDraggedId(null);
    setDropTarget(null);
  }, []);

  const handleDragOverItem = useCallback(
    (event: React.DragEvent, id: string) => {
      if (!draggedId) return;
      if (draggedId === id) {
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      const rect = event.currentTarget.getBoundingClientRect();
      const position = getSidebarDropPosition(
        isVertical ? event.clientY : event.clientX,
        isVertical ? rect.top : rect.left,
        isVertical ? rect.height : rect.width,
      );
      setDropTarget({ id, position });
    },
    [draggedId, isVertical],
  );

  const commitDrop = useCallback(
    (event: React.DragEvent, target: DropTarget | null) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = draggedId ?? event.dataTransfer.getData(ACTIVITY_BAR_DRAG_TYPE);
      if (sourceId && target) {
        setSidebarViewOrder(
          moveSidebarView(normalizedOrder, sourceId, target.id, target.position, availableIds),
        );
      }
      clearDragState();
    },
    [availableIds, clearDragState, draggedId, normalizedOrder, setSidebarViewOrder],
  );

  const handleDropOnItem = useCallback(
    (event: React.DragEvent, id: string) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const position = getSidebarDropPosition(
        isVertical ? event.clientY : event.clientX,
        isVertical ? rect.top : rect.left,
        isVertical ? rect.height : rect.width,
      );
      commitDrop(event, { id, position });
    },
    [commitDrop, isVertical],
  );

  const handleContainerDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!draggedId || event.target !== event.currentTarget) return;
      const elements = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>('[data-activity-bar-item]'),
      ).filter((element) => element.dataset.activityBarItem !== draggedId);
      if (elements.length === 0) return;

      const pointerCoordinate = isVertical ? event.clientY : event.clientX;
      const nextElement = elements.find((element) => {
        const rect = element.getBoundingClientRect();
        const midpoint = isVertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
        return pointerCoordinate < midpoint;
      });
      const targetElement = nextElement ?? elements.at(-1);
      const targetId = targetElement?.dataset.activityBarItem;
      if (!targetId) return;

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget({
        id: targetId,
        position: nextElement ? 'before' : 'after',
      });
    },
    [draggedId, isVertical],
  );

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const settingsButton = (
    <button
      onClick={openSettings}
      aria-label="Settings"
      className={`flex ${buttonSize} shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-raised/50 hover:text-foreground`}
      title="Settings"
    >
      <Settings className={iconSize} />
    </button>
  );

  const items = visibleItems.map((item) => {
    const Icon = item.icon;
    const isActive = active === item.id;
    const itemBadge = viewBadges[item.id];
    const badge = badges[item.id] ?? itemBadge?.count;
    const isDragged = draggedId === item.id;
    const targetPosition = dropTarget?.id === item.id ? dropTarget.position : null;

    return (
      <button
        key={item.id}
        data-activity-bar-item={item.id}
        draggable
        onDragStart={(event) => handleDragStart(event, item.id)}
        onDragEnd={clearDragState}
        onDragOver={(event) => handleDragOverItem(event, item.id)}
        onDrop={(event) => handleDropOnItem(event, item.id)}
        onClick={() => onSelect(item.id)}
        aria-label={item.label}
        aria-pressed={isActive}
        className={cn(
          `relative flex ${buttonSize} shrink-0 cursor-grab select-none items-center justify-center rounded-md transition-colors active:cursor-grabbing`,
          isActive
            ? 'bg-surface-raised text-foreground'
            : 'text-muted-foreground hover:bg-surface-raised/50 hover:text-foreground',
          isDragged && 'opacity-50',
          isVertical && targetPosition === 'before' && 'border-t-2 border-primary',
          isVertical && targetPosition === 'after' && 'border-b-2 border-primary',
          !isVertical && targetPosition === 'before' && 'border-l-2 border-primary',
          !isVertical && targetPosition === 'after' && 'border-r-2 border-primary',
        )}
        title={itemBadge?.tooltip || item.label}
      >
        <Icon className={iconSize} />
        {badge !== undefined && badge > 0 && <ActivityBadge count={badge} />}
      </button>
    );
  });

  return (
    <>
      <div
        onContextMenu={handleContextMenu}
        className={
          isVertical
            ? 'flex w-11 flex-col items-center gap-1 bg-sidebar py-2'
            : 'flex h-10 flex-row items-center gap-1 bg-sidebar px-2'
        }
      >
        <div
          ref={scrollRef}
          onWheel={handleWheel}
          onDragOver={handleContainerDragOver}
          onDrop={(event) => commitDrop(event, dropTarget)}
          className={
            isVertical
              ? 'flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-hide'
              : 'flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-smooth scrollbar-hide'
          }
        >
          {items}
        </div>
        <div className={isVertical ? 'mt-auto' : undefined}>{settingsButton}</div>
      </div>

      {contextMenu && (
        <ActivityBarContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={orderedItems}
          availableIds={availableIds}
          order={normalizedOrder}
          visibility={visibility}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

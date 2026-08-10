import { useEffect, useRef } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSettingsStore } from '../../stores';
import {
  canHideSidebarView,
  isSidebarViewVisible,
  type SidebarViewVisibility,
} from '../../lib/activity-bar-model';

export type ActivityBarMenuItem = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type ActivityBarContextMenuProps = {
  x: number;
  y: number;
  items: ActivityBarMenuItem[];
  availableIds: string[];
  order: string[];
  visibility: SidebarViewVisibility;
  onClose: () => void;
};

export function ActivityBarContextMenu({
  x,
  y,
  items,
  availableIds,
  order,
  visibility,
  onClose,
}: ActivityBarContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const setSidebarViewVisible = useSettingsStore((state) => state.setSidebarViewVisible);
  const resetSidebarViews = useSettingsStore((state) => state.resetSidebarViews);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const handleScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Activity bar items"
      aria-orientation="vertical"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 9999,
        maxHeight: 'min(28rem, calc(100vh - 8px))',
      }}
      className="animate-in fade-in-0 zoom-in-95 flex min-w-[220px] flex-col overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none"
    >
      <div className="shrink-0 px-1.5 py-1 text-xs font-medium text-muted-foreground">
        Sidebar views
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {items.map((item) => {
          const visible = isSidebarViewVisible(item.id, visibility);
          const hideAllowed = canHideSidebarView(item.id, order, availableIds, visibility);
          const disabled = visible && !hideAllowed;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              role="menuitemcheckbox"
              aria-checked={visible}
              disabled={disabled}
              onClick={() => setSidebarViewVisible(item.id, !visible, availableIds)}
              className="relative flex w-full cursor-default select-none items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden transition-colors hover:bg-muted focus:bg-muted focus:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
              {visible && (
                <span className="pointer-events-none absolute right-2 flex items-center justify-center">
                  <Check className="size-4" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="-mx-1 my-1 h-px shrink-0 bg-border" />

      <button
        role="menuitem"
        onClick={() => {
          resetSidebarViews(availableIds);
          onClose();
        }}
        className="flex w-full shrink-0 cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden transition-colors hover:bg-muted focus:bg-muted focus:text-foreground"
      >
        <RotateCcw className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left">Restore default</span>
      </button>
    </div>
  );
}

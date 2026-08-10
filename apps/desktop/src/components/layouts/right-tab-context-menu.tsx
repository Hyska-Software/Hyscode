import { useEffect, useRef } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { useLayoutStore, type RightTab } from '../../stores/layout-store';
import { RIGHT_TAB_DESCRIPTORS } from './right-tab-model';

interface RightTabContextMenuProps {
  x: number;
  y: number;
  order: RightTab[];
  visible: Record<RightTab, boolean>;
  onClose: () => void;
}

function Separator() {
  return <div className="my-1 h-px bg-border" />;
}

export function RightTabContextMenu({
  x,
  y,
  order,
  visible,
  onClose,
}: RightTabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const openAgentRightTab = useLayoutStore((s) => s.openAgentRightTab);
  const closeAgentRightTab = useLayoutStore((s) => s.closeAgentRightTab);
  const resetAgentRightTabs = useLayoutStore((s) => s.resetAgentRightTabs);

  // Close menu on outside click, scroll, or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
  };

  // Keep menu within the viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) {
      menuRef.current.style.left = `${vw - rect.width - 4}px`;
    }
    if (rect.bottom > vh) {
      menuRef.current.style.top = `${vh - rect.height - 4}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      style={style}
      className="min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-lg"
    >
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Surfaces
      </div>
      {order.map((id) => {
        const meta = RIGHT_TAB_DESCRIPTORS[id];
        const isVisible = visible[id];
        const Icon = meta.icon;
        return (
          <button
            key={id}
            onClick={() => {
              if (isVisible) closeAgentRightTab(id);
              else openAgentRightTab(id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {isVisible && <Check className="h-3.5 w-3.5" />}
            </span>
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">{meta.label}</span>
          </button>
        );
      })}

      <Separator />

      <button
        onClick={() => {
          resetAgentRightTabs();
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">Restore defaults</span>
      </button>
    </div>
  );
}

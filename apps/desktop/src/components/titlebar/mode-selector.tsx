import { useLayoutEffect, useRef, useState } from 'react';
import { Code2, Bot } from 'lucide-react';
import { useLayoutStore } from '../../stores/layout-store';
import { useSettingsStore } from '../../stores';
import type { WorkspaceMode } from '../../stores/layout-store';

const MODE_LABELS: Record<WorkspaceMode, string> = {
  editor: 'Editor',
  agent: 'Vortex',
};

const MODE_ICONS: Record<WorkspaceMode, typeof Code2> = {
  editor: Code2,
  agent: Bot,
};

export function ModeSelector() {
  const mode = useLayoutStore((s) => s.workspaceMode);
  const setMode = useLayoutStore((s) => s.setWorkspaceMode);
  const showAgentTab = useSettingsStore((s) => s.showAgentTab);

  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState({ left: 3, width: 0 });

  const visibleModes = (['editor', 'agent'] as const).filter((m) => {
    if (m === 'agent') return showAgentTab;
    return true;
  });

  useLayoutEffect(() => {
    const activeIndex = visibleModes.indexOf(mode);
    let left = 3;
    let width = 0;
    for (let i = 0; i < visibleModes.length; i++) {
      const el = buttonRefs.current[i];
      const w = el?.offsetWidth ?? 0;
      if (i === activeIndex) {
        width = w;
        break;
      }
      left += w;
    }
    setIndicator({ left, width });
  }, [mode, visibleModes.length]);

  if (visibleModes.length <= 1) return null;

  return (
    <div className="relative inline-flex items-center rounded-pill bg-surface-raised p-[3px]">
      {/* Sliding active indicator */}
      <span
        className="absolute inset-y-[3px] rounded-pill bg-muted transition-all duration-200 ease-out"
        style={{
          left: indicator.left,
          width: indicator.width,
        }}
        aria-hidden
      />
      {visibleModes.map((m, index) => {
        const Icon = MODE_ICONS[m];
        const isActive = mode === m;
        return (
          <button
            key={m}
            ref={(el) => { buttonRefs.current[index] = el; }}
            onClick={() => setMode(m)}
            title={MODE_LABELS[m]}
            aria-label={MODE_LABELS[m]}
            className={`relative z-10 flex items-center justify-center px-2.5 py-[3px] transition-colors duration-200 ${
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {isActive ? (
              <span className="flex items-center gap-1">
                <Icon className="h-3 w-3" />
                <span className="text-[10px] font-medium uppercase tracking-wider">
                  {MODE_LABELS[m]}
                </span>
              </span>
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
          </button>
        );
      })}
    </div>
  );
}

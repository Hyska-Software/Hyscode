import { useLayoutStore } from '../../stores/layout-store';
import { useSettingsStore } from '../../stores';
import type { WorkspaceMode } from '../../stores/layout-store';

const MODE_LABELS: Record<WorkspaceMode, string> = {
  editor: 'editor',
  agent: 'agent',
};

export function ModeSelector() {
  const mode = useLayoutStore((s) => s.workspaceMode);
  const setMode = useLayoutStore((s) => s.setWorkspaceMode);
  const showAgentTab = useSettingsStore((s) => s.showAgentTab);

  const visibleModes = (['editor', 'agent'] as const).filter((m) => {
    if (m === 'agent') return showAgentTab;
    return true;
  });

  if (visibleModes.length <= 1) return null;

  const activeIndex = visibleModes.indexOf(mode);

  return (
    <div className="relative flex items-center rounded-pill bg-surface-raised p-[3px]">
      {/* Sliding active indicator */}
      <span
        className="absolute inset-y-[3px] left-[3px] rounded-pill bg-muted transition-transform duration-200 ease-out"
        style={{
          width: `calc((100% - 6px) / ${visibleModes.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
        aria-hidden
      />
      {visibleModes.map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`relative z-10 flex-1 px-4 py-[3px] text-[10px] font-medium uppercase tracking-wider transition-colors duration-200 ${
            mode === m
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

import { Check, List, ListTree } from 'lucide-react';
import type { GitChangesView } from '../../stores/settings-store';

interface GitViewModeMenuProps {
  value: GitChangesView;
  onChange: (value: GitChangesView) => void;
}

export function GitViewModeMenu({ value, onChange }: GitViewModeMenuProps) {
  return (
    <div>
      <div className="px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        View
      </div>
      <ViewModeButton
        icon={ListTree}
        label="Tree View"
        selected={value === 'tree'}
        onClick={() => onChange('tree')}
      />
      <ViewModeButton
        icon={List}
        label="List View"
        selected={value === 'list'}
        onClick={() => onChange('list')}
      />
    </div>
  );
}

function ViewModeButton({
  icon: Icon,
  label,
  selected,
  onClick,
}: {
  icon: typeof List;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-foreground transition-colors hover:bg-surface-raised"
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="flex-1 text-left">{label}</span>
      {selected && <Check className="h-3 w-3 text-primary" />}
    </button>
  );
}

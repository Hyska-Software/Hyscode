import type { RightTab } from '@/stores/layout-store';
import { cn } from '@/lib/utils';
import { RIGHT_TAB_DESCRIPTORS } from './right-tab-model';

interface OpenSurfaceGridProps {
  tabs: RightTab[];
  onOpen: (tab: RightTab) => void;
}

export function OpenSurfaceGrid({ tabs, onOpen }: OpenSurfaceGridProps) {
  return (
    <div className="h-full overflow-auto bg-surface px-4 py-6">
      <div className="mx-auto flex w-full max-w-[520px] flex-col">
        <div className="mb-5 text-center">
          <h2 className="text-[14px] font-semibold text-foreground">Open a surface</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Choose what to show in the right panel.
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
          {tabs.map((id) => {
            const descriptor = RIGHT_TAB_DESCRIPTORS[id];
            const Icon = descriptor.icon;

            return (
              <button
                key={id}
                type="button"
                onClick={() => onOpen(id)}
                className={cn(
                  'group flex min-h-[116px] min-w-0 flex-col items-start rounded-lg border border-border bg-surface-raised p-3 text-left transition-colors',
                  'hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="truncate text-[12px] font-semibold text-foreground">
                  {descriptor.label}
                </span>
                <span className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                  {descriptor.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

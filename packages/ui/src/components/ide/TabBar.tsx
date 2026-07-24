import { type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export interface EditorTab {
  id: string;
  title: string;
  icon?: ReactNode;
  /** Shows an unsaved-changes dot instead of the close icon until hovered. */
  dirty?: boolean;
}

export interface TabBarProps {
  tabs: EditorTab[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  className?: string;
}

/** VS Code-style editor tab strip with dirty indicators and close buttons. */
export function TabBar({ tabs, activeId, onSelect, onClose, className }: TabBarProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-stretch overflow-x-auto   bg-muted/40",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={cn(
              "group flex min-w-0 shrink-0 items-center gap-2   px-3 py-2 text-sm transition-colors",
              active
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect?.(tab.id)}
              className="flex min-w-0 items-center gap-2 [&_svg]:size-4"
            >
              {tab.icon}
              <span className="truncate">{tab.title}</span>
            </button>
            {onClose && (
              <button
                type="button"
                onClick={() => onClose(tab.id)}
                aria-label={`Close ${tab.title}`}
                className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {tab.dirty ? (
                  <>
                    <span className="size-2 rounded-full bg-current group-hover:hidden" />
                    <X className="hidden size-3.5 group-hover:block" />
                  </>
                ) : (
                  <X className="size-3.5" />
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

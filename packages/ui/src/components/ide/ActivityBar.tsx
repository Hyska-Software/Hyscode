import { type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Tooltip } from "../primitives/Tooltip";

export interface ActivityBarItem {
  id: string;
  icon: ReactNode;
  label: string;
  badge?: number;
}

export interface ActivityBarProps {
  items: ActivityBarItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  /** Items pinned to the bottom (e.g. settings, account). */
  footerItems?: ActivityBarItem[];
  className?: string;
}

function ActivityButton({
  item,
  active,
  onSelect,
}: {
  item: ActivityBarItem;
  active: boolean;
  onSelect?: (id: string) => void;
}) {
  return (
    <Tooltip content={item.label} side="right">
      <button
        type="button"
        aria-label={item.label}
        aria-current={active}
        onClick={() => onSelect?.(item.id)}
        className={cn(
          "relative flex size-12 items-center justify-center text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-6",
          active &&
            "text-foreground before:absolute before:left-0 before:h-6 before:w-0.5 before:rounded-r before:bg-primary",
        )}
      >
        {item.icon}
        {item.badge != null && item.badge > 0 && (
          <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] font-medium text-primary-foreground">
            {item.badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

/** VS Code-style vertical icon rail. */
export function ActivityBar({ items, activeId, onSelect, footerItems, className }: ActivityBarProps) {
  return (
    <div
      className={cn(
        "flex w-12 shrink-0 flex-col justify-between   bg-muted/40",
        className,
      )}
    >
      <div className="flex flex-col">
        {items.map((item) => (
          <ActivityButton key={item.id} item={item} active={item.id === activeId} onSelect={onSelect} />
        ))}
      </div>
      {footerItems && footerItems.length > 0 && (
        <div className="flex flex-col">
          {footerItems.map((item) => (
            <ActivityButton key={item.id} item={item} active={item.id === activeId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

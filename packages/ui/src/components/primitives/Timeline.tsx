import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface TimelineItem {
  title: ReactNode;
  description?: ReactNode;
  time?: ReactNode;
  icon?: ReactNode;
  /** Accent the marker (e.g. current/active event). */
  active?: boolean;
}

export interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

export function Timeline({ items, className }: TimelineProps) {
  return (
    <ol className={cn("relative", className)}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
            {!last && <span className="absolute left-[11px] top-6 h-full w-px bg-border" aria-hidden />}
            <span
              className={cn(
                "z-10 flex size-6 shrink-0 items-center justify-center rounded-full  text-xs [&_svg]:size-3",
                item.active
                  ? " bg-primary text-primary-foreground"
                  : " bg-card text-muted-foreground",
              )}
            >
              {item.icon ?? <span className="size-1.5 rounded-full bg-current" />}
            </span>
            <div className="-mt-0.5 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                {item.time && <span className="text-xs text-muted-foreground">{item.time}</span>}
              </div>
              {item.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface ListboxItem {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  keywords?: string;
  group?: string;
}

export interface ListboxMenuProps {
  items: ListboxItem[];
  /** Query used to filter items by label/keywords. */
  query?: string;
  onSelect: (item: ListboxItem) => void;
  emptyMessage?: ReactNode;
  header?: ReactNode;
  className?: string;
}

/** Keyboard-navigable floating list used by slash-command and mention menus.
 *  Listens on document for ArrowUp/Down/Enter while mounted. */
export function ListboxMenu({
  items,
  query = "",
  onSelect,
  emptyMessage = "No results",
  header,
  className,
}: ListboxMenuProps) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      `${typeof it.label === "string" ? it.label : ""} ${it.keywords ?? ""} ${it.group ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onSelect(filtered[active]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filtered, active, onSelect]);

  return (
    <div
      role="listbox"
      className={cn(
        "w-72 overflow-hidden rounded-lg   bg-popover p-1 text-popover-foreground shadow-lg animate-scale-in",
        className,
      )}
    >
      {header}
      {filtered.length === 0 ? (
        <p className="px-2 py-3 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => onSelect(item)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors [&_svg]:size-4 [&_svg]:text-muted-foreground",
                i === active && "bg-muted",
              )}
            >
              {item.icon}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{item.label}</span>
                {item.description && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </span>
              {item.hint && <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

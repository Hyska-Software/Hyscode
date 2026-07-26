import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "../../lib/cn";
import { Dialog, DialogPortal, DialogOverlay } from "../primitives/Dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Kbd } from "../primitives/Typography";

export interface Command {
  id: string;
  label: string;
  /** Words used for fuzzy matching in addition to the label. */
  keywords?: string;
  icon?: ReactNode;
  shortcut?: string;
  group?: string;
  onRun: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
  placeholder?: string;
  emptyMessage?: string;
}

/** ⌘K-style command palette. Control `open` yourself, or use `useCommandPalette`. */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
  placeholder = "Type a command or search…",
  emptyMessage = "No results found.",
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.keywords ?? ""} ${c.group ?? ""}`.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const run = (cmd: Command) => {
    cmd.onRun();
    onOpenChange(false);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of filtered) {
      const key = c.group ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-xl   bg-popover shadow-2xl animate-scale-in"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && filtered[active]) {
              e.preventDefault();
              run(filtered[active]);
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="flex items-center gap-2   px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
              grouped.map(([group, cmds]) => (
                <div key={group} className="mb-1">
                  {group && (
                    <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{group}</p>
                  )}
                  {cmds.map((cmd) => {
                    const idx = filtered.indexOf(cmd);
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => run(cmd)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors [&_svg]:size-4 [&_svg]:text-muted-foreground",
                          idx === active && "bg-muted",
                        )}
                      >
                        {cmd.icon}
                        <span className="flex-1 truncate">{cmd.label}</span>
                        {cmd.shortcut && <Kbd>{cmd.shortcut}</Kbd>}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

/** Wires ⌘K / Ctrl+K to toggle a boolean open state. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

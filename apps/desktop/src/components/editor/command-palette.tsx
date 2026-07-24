/**
 * Command Palette
 *
 * A searchable overlay (Ctrl+Shift+P) that lists all registered commands
 * from built-in and extension sources. Supports keyboard navigation,
 * filtering, and keybinding hints.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import { useCommandStore, type RegisteredCommand } from '../../stores/command-store';
import { useKeybindingStore } from '../../stores/keybinding-store';

// ── Command Palette Store (simple open/close state) ──────────────────────────

let _open = false;
let _listeners: Array<() => void> = [];

function notifyPaletteListeners() {
  for (const l of _listeners) l();
}

export function openCommandPalette() {
  _open = true;
  notifyPaletteListeners();
}

export function closeCommandPalette() {
  _open = false;
  notifyPaletteListeners();
}

export function toggleCommandPalette() {
  _open = !_open;
  notifyPaletteListeners();
}

function useCommandPaletteOpen(): boolean {
  const [open, setOpen] = useState(_open);
  useEffect(() => {
    const listener = () => setOpen(_open);
    _listeners.push(listener);
    return () => {
      _listeners = _listeners.filter((l) => l !== listener);
    };
  }, []);
  return open;
}

// ── Component ────────────────────────────────────────────────────────────────

export function CommandPalette() {
  const open = useCommandPaletteOpen();
  const commands = useCommandStore((s) => s.commands);
  const executeCommand = useCommandStore((s) => s.executeCommand);
  const getLabelForCommand = useKeybindingStore((s) => s.getLabelForCommand);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Build sorted, filtered command list
  const filteredCommands = useMemo(() => {
    const all = Object.values(commands) as RegisteredCommand[];

    // Sort: category alphabetical, then title
    const sorted = all.sort((a, b) => {
      const catA = a.category ?? '';
      const catB = b.category ?? '';
      if (catA !== catB) return catA.localeCompare(catB);
      return a.title.localeCompare(b.title);
    });

    if (!query.trim()) return sorted;

    const q = query.toLowerCase();
    return sorted.filter((cmd) => {
      const searchable = `${cmd.category ?? ''} ${cmd.title} ${cmd.id}`.toLowerCase();
      // Match all query words (space-separated)
      return q.split(/\s+/).every((word) => searchable.includes(word));
    });
  }, [commands, query]);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-palette-item]');
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    async (cmd: RegisteredCommand) => {
      closeCommandPalette();
      try {
        await executeCommand(cmd.id);
      } catch (err) {
        console.error(`[CommandPalette] Failed to execute "${cmd.id}":`, err);
      }
    },
    [executeCommand],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            handleSelect(filteredCommands[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          closeCommandPalette();
          break;
      }
    },
    [filteredCommands, selectedIndex, handleSelect],
  );

  // Reset selected index when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100001] flex items-start justify-center pt-[12vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => closeCommandPalette()}
      />

      {/* Palette container */}
      <div
        className="relative w-[520px] animate-in fade-in slide-in-from-top-2 duration-150 rounded-xl border border-border/60 bg-surface/95 backdrop-blur-xl shadow-2xl shadow-black/30 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
          <span className="text-muted-foreground/60 text-[11px] font-medium select-none">&gt;</span>
          <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground/60">
            ESC
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto p-1">
          {filteredCommands.map((cmd, index) => {
            const keybinding = getLabelForCommand(cmd.id);
            const isSelected = index === selectedIndex;

            return (
              <button
                key={cmd.id}
                data-palette-item
                onClick={() => handleSelect(cmd)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? 'bg-primary/15 text-foreground'
                    : 'text-foreground/80 hover:bg-surface-raised'
                }`}
              >
                {/* Category + Title */}
                <div className="flex flex-1 items-center gap-1.5 min-w-0">
                  {cmd.category && (
                    <>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {cmd.category}
                      </span>
                      <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                    </>
                  )}
                  <span className="text-[12px] font-medium truncate">{cmd.title}</span>
                </div>

                {/* Extension badge */}
                {cmd.extensionName && (
                  <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[8px] font-mono text-muted-foreground/50">
                    {cmd.extensionName}
                  </span>
                )}

                {/* Keybinding */}
                {keybinding && (
                  <kbd className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/70">
                    {keybinding}
                  </kbd>
                )}
              </button>
            );
          })}

          {/* Empty state */}
          {filteredCommands.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-muted-foreground/60">
              No commands matching "{query}"
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/20 px-4 py-1.5">
          <span className="text-[9px] text-muted-foreground/40">
            {filteredCommands.length} command{filteredCommands.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2 text-[9px] text-muted-foreground/40">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </div>
        </div>
      </div>
    </div>
  );
}

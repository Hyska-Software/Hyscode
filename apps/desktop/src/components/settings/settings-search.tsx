/**
 * Settings sidebar search input
 *
 * Sticky search bar at the top of the settings sidebar. Performs case-insensitive
 * AND-token substring matching against the tree (handled by the parent). Debounces
 * input changes so we don't re-render the tree on every keystroke.
 *
 * Keyboard:
 *   - Esc: clear query (parent decides what second Esc does)
 *   - Enter: focus the first matching leaf in the tree
 *   - ArrowDown: focus the first matching leaf in the tree
 */

import { forwardRef, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';

export interface SettingsSearchProps {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  onArrowDown?: () => void;
  placeholder?: string;
  resultCount?: number;
}

export const SettingsSearch = forwardRef<HTMLInputElement, SettingsSearchProps>(function SettingsSearch(
  { value, onChange, onEnter, onArrowDown, placeholder = 'Type to search settings…', resultCount },
  ref,
) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep local value in sync if the parent resets the query externally (e.g., Esc in modal).
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Cleanup pending debounce on unmount.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const commit = (next: string) => {
    setLocalValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange(next);
    }, 120);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    commit(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter?.();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onArrowDown?.();
      return;
    }
    if (e.key === 'Escape') {
      if (value) {
        e.preventDefault();
        e.stopPropagation();
        commit('');
      }
    }
  };

  const handleClear = () => {
    commit('');
    inputRef.current?.focus();
  };

  const setRef = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
  };

  return (
    <div className="flex flex-col gap-1 border-b border-border/50 px-2 pb-2 pt-2">
      <div className="group relative flex h-7 items-center rounded-md bg-surface-raised/60 px-2 transition-colors focus-within:bg-surface-raised focus-within:ring-1 focus-within:ring-ring/50">
        <Search
          className="mr-1.5 h-3 w-3 shrink-0 text-muted-foreground/70 group-focus-within:text-foreground"
          aria-hidden
        />
        <input
          ref={setRef}
          type="text"
          value={localValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="searchbox"
          aria-label="Search settings"
          aria-controls="settings-tree"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50"
        />
        {value.length > 0 ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
            className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        ) : (
          <kbd className="hidden shrink-0 rounded bg-muted/60 px-1 py-0.5 text-[9px] font-mono text-muted-foreground/60 sm:inline-flex">
            Ctrl F
          </kbd>
        )}
      </div>
      {value.trim() && typeof resultCount === 'number' && (
        <div className="px-1 text-[9px] font-medium text-muted-foreground/60" aria-live="polite">
          {resultCount === 0
            ? 'No matches'
            : `${resultCount} match${resultCount === 1 ? '' : 'es'}`}
        </div>
      )}
    </div>
  );
});

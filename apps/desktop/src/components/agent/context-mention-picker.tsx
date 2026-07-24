import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { File, Folder, ChevronRight, ArrowLeft, Search, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFileStore } from '@/stores/file-store';
import { useExtensionStore } from '@/stores/extension-store';
import { tauriFs, type FileEntry } from '@/lib/tauri-fs';
import { getFileIcon, getFolderIcon } from '../sidebar/views/file-icons';

// ─── Types ─────────────────────────────────────────────────────────────────

type PickerView = 'categories' | 'files' | 'directories';

interface CategoryItem {
  id: string;
  icon: typeof File;
  label: string;
  description?: string;
  browsable?: boolean; // opens a sub-view
}

const CATEGORIES: CategoryItem[] = [
  {
    id: 'files',
    icon: File,
    label: 'Files',
    description: 'Browse workspace files',
    browsable: true,
  },
  {
    id: 'directories',
    icon: Folder,
    label: 'Directories',
    description: 'Attach a directory for context',
    browsable: true,
  },
  {
    id: 'terminal',
    icon: Terminal,
    label: 'Terminal',
    description: 'Attach the active terminal output',
  },
];

// ─── File Browser Sub-view ─────────────────────────────────────────────────

interface FileBrowserProps {
  mode: 'files' | 'directories';
  rootPath: string;
  onSelect: (path: string) => void;
  onBack: () => void;
  searchQuery: string;
}

function FileBrowser({ mode, rootPath, onSelect, onBack, searchQuery }: FileBrowserProps) {
  const [currentDir, setCurrentDir] = useState(rootPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Load directory entries
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    tauriFs
      .listDir(currentDir, false)
      .then((result) => {
        if (cancelled) return;
        setEntries(result);
        setLoading(false);
        setSelectedIdx(0);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentDir]);

  // Filter entries based on mode and search
  const filtered = useMemo(() => {
    let items = entries;
    // In files mode show all; in directories mode show only dirs
    if (mode === 'directories') {
      items = items.filter((e) => e.is_dir);
    }
    // Apply search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((e) => e.name.toLowerCase().includes(q));
    }
    return items;
  }, [entries, mode, searchQuery]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const handleSelect = useCallback(
    (entry: FileEntry) => {
      if (entry.is_dir) {
        if (mode === 'directories') {
          // In directory mode, clicking a dir can either navigate into it or attach it
          // We navigate in; user uses the explicit "attach" action or presses Enter
          setCurrentDir(entry.path);
        } else {
          // In file mode, navigate into directory
          setCurrentDir(entry.path);
        }
      } else {
        // Select the file
        onSelect(entry.path);
      }
    },
    [mode, onSelect],
  );

  const handleAttachDir = useCallback(() => {
    onSelect(currentDir);
  }, [currentDir, onSelect]);

  const navigateUp = useCallback(() => {
    if (currentDir === rootPath) {
      onBack();
      return;
    }
    const sep = currentDir.includes('/') ? '/' : '\\';
    const parts = currentDir.split(sep);
    parts.pop();
    const parent = parts.join(sep);
    if (parent && parent.length >= rootPath.length) {
      setCurrentDir(parent);
    } else {
      onBack();
    }
  }, [currentDir, rootPath, onBack]);

  // Relative path display
  const relativeCurrent = useMemo(() => {
    const norm = currentDir.replace(/\\/g, '/');
    const normRoot = rootPath.replace(/\\/g, '/');
    if (norm === normRoot) return '/';
    return norm.slice(normRoot.length);
  }, [currentDir, rootPath]);

  return (
    <div className="flex flex-col">
      {/* Breadcrumb / back bar */}
      <div className="flex items-center gap-1.5 border-b border-border/30 px-2 py-1.5">
        <button
          onClick={navigateUp}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
          <ArrowLeft className="h-3 w-3" />
        </button>
        <span className="truncate text-[10px] text-muted-foreground font-mono">
          {relativeCurrent}
        </span>
        {mode === 'directories' && currentDir !== rootPath && (
          <button
            onClick={handleAttachDir}
            className="ml-auto shrink-0 rounded bg-primary/20 px-2 py-0.5 text-[9px] font-medium text-primary hover:bg-primary/30"
          >
            Attach this dir
          </button>
        )}
      </div>

      {/* Entry list */}
      <div ref={listRef} className="max-h-[240px] overflow-y-auto py-0.5">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <span className="text-[10px] text-muted-foreground">Loading...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <span className="text-[10px] text-muted-foreground">
              {searchQuery ? 'No matches' : 'Empty directory'}
            </span>
          </div>
        ) : (
          filtered.map((entry, idx) => {
            const Icon = entry.is_dir ? getFolderIcon(entry.name, false) : getFileIcon(entry.name);

            return (
              <button
                key={entry.path}
                onClick={() => handleSelect(entry)}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                  idx === selectedIdx
                    ? 'bg-primary/10 text-foreground'
                    : 'text-foreground/80 hover:bg-muted/50',
                )}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate text-[11px]">{entry.name}</span>
                {entry.is_dir && (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Main Picker ───────────────────────────────────────────────────────────

interface ContextMentionPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function ContextMentionPicker({ open, onClose, onSelect }: ContextMentionPickerProps) {
  const rootPath = useFileStore((s) => s.rootPath);
  // Re-render when extension icon themes change
  useExtensionStore((s) => s.extensionIconThemesVersion);
  const [view, setView] = useState<PickerView>('categories');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setView('categories');
      setSearchQuery('');
      setSelectedIdx(0);
      // Focus the search input after a tick
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return CATEGORIES;
    const q = searchQuery.toLowerCase();
    return CATEGORIES.filter((c) => c.label.toLowerCase().includes(q));
  }, [searchQuery]);

  const handleCategoryClick = useCallback(
    (cat: CategoryItem) => {
      if (cat.browsable && (cat.id === 'files' || cat.id === 'directories')) {
        setView(cat.id as PickerView);
        setSearchQuery('');
        setSelectedIdx(0);
      } else if (cat.id === 'terminal') {
        // Attach terminal output as context
        onSelect('__terminal__');
      } else if (cat.id === 'conversation') {
        onSelect('__conversation__');
      }
      // Other categories are not yet implemented
    },
    [onSelect],
  );

  const handleFileSelect = useCallback(
    (path: string) => {
      onSelect(path);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view !== 'categories') {
          setView('categories');
          setSearchQuery('');
          setSelectedIdx(0);
        } else {
          onClose();
        }
        e.preventDefault();
        return;
      }

      if (view === 'categories') {
        const items = filteredCategories;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const sel = items[selectedIdx];
          if (sel) handleCategoryClick(sel);
        }
      }
      // In file/dir browser, keyboard navigation is handled within the browser
    },
    [view, filteredCategories, selectedIdx, handleCategoryClick, onClose],
  );

  if (!open) return null;

  return (
    <div
      ref={pickerRef}
      className="absolute bottom-full left-0 z-50 mb-1 w-[280px] overflow-hidden rounded-lg border border-border/40 bg-popover shadow-lg shadow-black/30 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
    >
      {/* Search input */}
      <div className="flex items-center gap-1.5 border-b border-border/30 px-2.5 py-1.5">
        <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSelectedIdx(0);
          }}
          placeholder={
            view === 'categories'
              ? 'Search context items...'
              : view === 'files'
                ? 'Filter files...'
                : 'Filter directories...'
          }
          className="flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
          onKeyDown={(e) => {
            // Bubble up arrow/enter/escape to parent handler
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
              // Don't prevent default here; let parent handleKeyDown process
            }
          }}
        />
        {view !== 'categories' && (
          <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            Esc to go back
          </span>
        )}
      </div>

      {/* Content */}
      {view === 'categories' ? (
        <div className="max-h-[300px] overflow-y-auto py-0.5">
          {filteredCategories.map((cat, idx) => {
            const CatIcon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => handleCategoryClick(cat)}
                onMouseEnter={() => setSelectedIdx(idx)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors',
                  idx === selectedIdx
                    ? 'bg-primary/10 text-foreground'
                    : 'text-foreground/80 hover:bg-muted/50',
                )}
              >
                <CatIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-[11px]">{cat.label}</span>
                {cat.browsable && (
                  <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50" />
                )}
              </button>
            );
          })}
        </div>
      ) : rootPath ? (
        <FileBrowser
          mode={view}
          rootPath={rootPath}
          onSelect={handleFileSelect}
          onBack={() => {
            setView('categories');
            setSearchQuery('');
            setSelectedIdx(0);
          }}
          searchQuery={searchQuery}
        />
      ) : (
        <div className="flex items-center justify-center py-6">
          <span className="text-[10px] text-muted-foreground">No folder open</span>
        </div>
      )}
    </div>
  );
}

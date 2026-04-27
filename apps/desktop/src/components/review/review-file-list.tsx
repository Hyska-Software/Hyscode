import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  FileCode2,
  Pencil,
  Plus,
  Minus,
  FileText,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  Loader2,
  GitBranch,
  FolderGit2,
  Search,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useReviewStore } from '@/stores/review-store';
import { useGitStore } from '@/stores/git-store';
import { useProjectStore } from '@/stores/project-store';
import { cn } from '@/lib/utils';
import type { ReviewFileEntry } from '@/stores/review-store';

// ─── Status icon/color helpers ──────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  M: { icon: Pencil, color: 'text-yellow-400', label: 'Modified' },
  A: { icon: Plus, color: 'text-green-400', label: 'Added' },
  D: { icon: Minus, color: 'text-red-400', label: 'Deleted' },
  R: { icon: FileText, color: 'text-blue-400', label: 'Renamed' },
  C: { icon: FileText, color: 'text-blue-400', label: 'Copied' },
  T: { icon: FileText, color: 'text-purple-400', label: 'Type changed' },
  U: { icon: AlertTriangle, color: 'text-orange-400', label: 'Conflicted' },
  '?': { icon: Plus, color: 'text-zinc-400', label: 'Untracked' },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { icon: FileCode2, color: 'text-muted-foreground', label: status };
}

// ─── Source Toggle ──────────────────────────────────────────────────────────

function SourceToggle() {
  const source = useReviewStore((s) => s.source);
  const setSource = useReviewStore((s) => s.setSource);

  return (
    <div className="flex items-center gap-0.5 rounded-md bg-surface-raised p-0.5">
      <button
        onClick={() => setSource('working')}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors',
          source === 'working'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <FolderGit2 className="h-3 w-3" />
        Working
      </button>
      <button
        onClick={() => setSource('branch')}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors',
          source === 'branch'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <GitBranch className="h-3 w-3" />
        Branch
      </button>
    </div>
  );
}

// ─── File Item ──────────────────────────────────────────────────────────────

function ReviewFileItem({
  file,
  isSelected,
  onClick,
}: {
  file: ReviewFileEntry;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { icon: StatusIcon, color } = getStatusConfig(file.status);
  const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
  const dir = file.path.includes('/')
    ? file.path.substring(0, file.path.lastIndexOf('/'))
    : '';

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors group',
        isSelected
          ? 'bg-accent/10 text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', color)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] font-medium leading-tight">{fileName}</span>
        {dir && (
          <span className="truncate text-[9px] text-muted-foreground/60 leading-tight">{dir}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {(file.additions > 0 || file.deletions > 0) && (
          <span className="hidden lg:flex items-center gap-1 text-[9px] tabular-nums">
            {file.additions > 0 && <span className="text-green-400">+{file.additions}</span>}
            {file.deletions > 0 && <span className="text-red-400">-{file.deletions}</span>}
          </span>
        )}
        {file.commentCount > 0 && (
          <span className="flex items-center gap-0.5 text-[9px] tabular-nums text-purple-400">
            <MessageSquare className="h-2.5 w-2.5" />
            {file.commentCount}
          </span>
        )}
        {file.reviewed && (
          <CheckCircle2 className="h-3 w-3 text-green-400" />
        )}
      </div>
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ReviewFileList() {
  const files = useReviewStore((s) => s.files);
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const setSelectedFile = useReviewStore((s) => s.setSelectedFile);
  const loadFiles = useReviewStore((s) => s.loadFiles);
  const status = useReviewStore((s) => s.status);
  const source = useReviewStore((s) => s.source);
  const currentBranch = useGitStore((s) => s.currentBranch);
  const isGitRepo = useGitStore((s) => s.isGitRepo);
  const projectRootPath = useProjectStore((s) => s.rootPath);

  const [search, setSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load files on mount, when source changes, or when the project switches
  useEffect(() => {
    loadFiles();
  }, [source, projectRootPath, loadFiles]);

  // Filter files by search
  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, search]);

  // Separate by status groups
  const { modified, added, deleted, other } = useMemo(() => {
    const groups = { modified: [] as ReviewFileEntry[], added: [] as ReviewFileEntry[], deleted: [] as ReviewFileEntry[], other: [] as ReviewFileEntry[] };
    for (const f of filteredFiles) {
      if (f.status === 'M') groups.modified.push(f);
      else if (f.status === 'A' || f.status === '?') groups.added.push(f);
      else if (f.status === 'D') groups.deleted.push(f);
      else groups.other.push(f);
    }
    return groups;
  }, [filteredFiles]);

  const reviewedCount = files.filter((f) => f.reviewed).length;

  // Keyboard navigation
  const flatFiles = useMemo(() => {
    const result: ReviewFileEntry[] = [];
    if (!collapsedGroups.has('modified')) result.push(...modified);
    if (!collapsedGroups.has('added')) result.push(...added);
    if (!collapsedGroups.has('deleted')) result.push(...deleted);
    if (!collapsedGroups.has('other')) result.push(...other);
    return result;
  }, [modified, added, deleted, other, collapsedGroups]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Focus search on /
    if (e.key === '/' && document.activeElement !== searchRef.current) {
      e.preventDefault();
      searchRef.current?.focus();
      return;
    }
    // Escape clears search
    if (e.key === 'Escape' && document.activeElement === searchRef.current) {
      setSearch('');
      searchRef.current?.blur();
      return;
    }
    // Arrow navigation when not in search
    if (document.activeElement === searchRef.current) return;

    const currentIdx = flatFiles.findIndex((f) => f.path === selectedFile);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = flatFiles[currentIdx + 1];
      if (next) setSelectedFile(next.path);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = flatFiles[currentIdx - 1];
      if (prev) setSelectedFile(prev.path);
    } else if (e.key === 'Enter' && selectedFile) {
      e.preventDefault();
      // Scroll selected into view
      const el = listRef.current?.querySelector(`[data-file-path="${CSS.escape(selectedFile)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [flatFiles, selectedFile, setSelectedFile]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  if (!isGitRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <GitBranch className="mb-3 h-8 w-8 opacity-20" />
        <span className="text-[11px]">Not a git repository</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface rounded-lg">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border/30 px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Files to Review
            </span>
          </div>
          <button
            onClick={() => loadFiles()}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Refresh"
          >
            {status === 'loading' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
        </div>
        <SourceToggle />
      </div>

      {/* Branch info */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/20 px-3 py-1.5">
        <GitBranch className="h-3 w-3 text-accent" />
        <span className="text-[10px] text-foreground">{currentBranch || 'HEAD'}</span>
        {files.length > 0 && (
          <span className="ml-auto text-[9px] text-muted-foreground tabular-nums">
            {reviewedCount}/{files.length} reviewed
          </span>
        )}
      </div>

      {/* Search */}
      {files.length > 5 && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/20 px-3 py-1.5">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files..."
            className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* File list */}
      <div ref={listRef} className="flex-1 overflow-auto">
        {status === 'loading' && files.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="mb-3 h-8 w-8 text-green-400/30" />
            <span className="text-[11px] text-muted-foreground">No changes to review</span>
            <span className="mt-1 text-[10px] text-muted-foreground/60">
              Working directory is clean
            </span>
          </div>
        ) : (
          <div className="flex flex-col">
            {modified.length > 0 && (
              <FileGroup
                title="Modified"
                count={modified.length}
                collapsed={collapsedGroups.has('modified')}
                onToggle={() => toggleGroup('modified')}
              >
                {modified.map((f) => (
                  <ReviewFileItem
                    key={f.path}
                    file={f}
                    isSelected={f.path === selectedFile}
                    onClick={() => setSelectedFile(f.path)}
                  />
                ))}
              </FileGroup>
            )}
            {added.length > 0 && (
              <FileGroup
                title="Added"
                count={added.length}
                collapsed={collapsedGroups.has('added')}
                onToggle={() => toggleGroup('added')}
              >
                {added.map((f) => (
                  <ReviewFileItem
                    key={f.path}
                    file={f}
                    isSelected={f.path === selectedFile}
                    onClick={() => setSelectedFile(f.path)}
                  />
                ))}
              </FileGroup>
            )}
            {deleted.length > 0 && (
              <FileGroup
                title="Deleted"
                count={deleted.length}
                collapsed={collapsedGroups.has('deleted')}
                onToggle={() => toggleGroup('deleted')}
              >
                {deleted.map((f) => (
                  <ReviewFileItem
                    key={f.path}
                    file={f}
                    isSelected={f.path === selectedFile}
                    onClick={() => setSelectedFile(f.path)}
                  />
                ))}
              </FileGroup>
            )}
            {other.length > 0 && (
              <FileGroup
                title="Other"
                count={other.length}
                collapsed={collapsedGroups.has('other')}
                onToggle={() => toggleGroup('other')}
              >
                {other.map((f) => (
                  <ReviewFileItem
                    key={f.path}
                    file={f}
                    isSelected={f.path === selectedFile}
                    onClick={() => setSelectedFile(f.path)}
                  />
                ))}
              </FileGroup>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── File Group ─────────────────────────────────────────────────────────────

function FileGroup({
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        {title}
        <span className="text-[9px] font-normal tabular-nums">{count}</span>
      </button>
      {!collapsed && children}
    </div>
  );
}

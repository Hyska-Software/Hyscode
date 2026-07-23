import { Suspense, lazy, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Terminal,
  GitCompare,
  GitBranch,
  Eye,
  FileCode2,
  Check,
  Undo2,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  PanelRightClose,
  Folder,
} from 'lucide-react';
import { MarkdownViewer } from '../editor/viewers/markdown-viewer';
import { TerminalPanel } from '../terminal';
import { GitView } from '../sidebar/views/git-view-new';
import { FileExplorerView } from '../sidebar/views/file-explorer-view';
import { useAgentStore } from '@/stores/agent-store';
import { useGitStore } from '@/stores/git-store';
import {
  useLayoutStore,
  normalizeAgentRightTabPrefs,
  agentRightTabProjectKey,
  type RightTab,
} from '@/stores/layout-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useFileStore } from '@/stores/file-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { tauriFs } from '@/lib/tauri-fs';
import { defineAllMonacoThemes, getMonacoThemeName } from '@/lib/monaco-themes';
import { cn } from '@/lib/utils';
import { TabBadge } from '../ui/tab-badge';
import { RightTabContextMenu } from './right-tab-context-menu';
import {
  buildSessionChanges,
  loadGitChangeCount,
  buildAgentDiffContent,
  buildGitDiffContent,
  filterLabel,
  kindLabel,
  gitStatusLabel,
  type SessionChangeEntry,
  type DiffContent,
  type ChangeFilter,
} from '@/lib/session-changes';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));
import { DiffViewer } from '@/components/diff-viewer';

// ─── Language detection ─────────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  rs: 'rust',
  py: 'python',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  sh: 'shell',
};

function detectLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] || 'plaintext';
}

// ─── Changes Tab (with Agent + Git sub-tabs) ───────────────────────────────

type ChangesSubTab = 'agent' | 'git';

function ChangesTab() {
  const [subTab, setSubTab] = useState<ChangesSubTab>('agent');
  const filter = useLayoutStore((s) => s.agentChangesFilter);

  const agentEditSessions = useAgentStore((s) => s.agentEditSessions);
  const messages = useAgentStore((s) => s.messages);
  const getLastTurnId = useAgentStore((s) => s.getLastTurnId);
  const lastTurnId = useMemo(() => getLastTurnId(), [getLastTurnId, messages, agentEditSessions]);

  const gitStaged = useGitStore((s) => s.staged);
  const gitUnstaged = useGitStore((s) => s.unstaged);
  const gitUntracked = useGitStore((s) => s.untracked);
  const gitConflicts = useGitStore((s) => s.conflicts);
  const gitBranchChanges = useGitStore((s) => s.branchChanges);
  const rootPath = useFileStore((s) => s.rootPath);

  const agentCount = useMemo(
    () =>
      buildSessionChanges({
        filter,
        agentEditSessions,
        lastTurnId,
        git: {
          staged: gitStaged,
          unstaged: gitUnstaged,
          untracked: gitUntracked,
          conflicts: gitConflicts,
          branchChanges: gitBranchChanges,
        },
        rootPath,
      }).length,
    [
      filter,
      agentEditSessions,
      lastTurnId,
      gitStaged,
      gitUnstaged,
      gitUntracked,
      gitConflicts,
      gitBranchChanges,
      rootPath,
    ],
  );

  const gitChangesCount = useGitStore(
    (s) => s.staged.length + s.unstaged.length + s.untracked.length + s.conflicts.length,
  );

  return (
    <div className="flex h-full flex-col">
      {/* Sub-tab bar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border/30 px-2 py-1">
        <button
          onClick={() => setSubTab('agent')}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
            subTab === 'agent'
              ? 'bg-accent/10 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
        >
          <GitCompare className="h-3 w-3" />
          Agent
          <TabBadge count={agentCount} />
        </button>
        <button
          onClick={() => setSubTab('git')}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
            subTab === 'git'
              ? 'bg-accent/10 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
        >
          <GitBranch className="h-3 w-3" />
          Git
          <TabBadge count={gitChangesCount} />
        </button>
      </div>

      {/* Agent changes toolbar */}
      {subTab === 'agent' && <AgentChangesToolbar />}

      {/* Sub-tab content */}
      <div className="relative flex-1 overflow-hidden">
        <div className={cn('absolute inset-0', subTab === 'agent' ? 'z-10' : 'z-0 invisible')}>
          <AgentChangesContent />
        </div>
        <div className={cn('absolute inset-0', subTab === 'git' ? 'z-10' : 'z-0 invisible')}>
          <GitView />
        </div>
      </div>
    </div>
  );
}

// ─── Agent Changes Content ──────────────────────────────────────────────────

const FILTER_OPTIONS: ChangeFilter[] = ['session', 'last-turn', 'staged', 'working', 'branch'];

function useGitChangeCounts(
  entries: SessionChangeEntry[],
  rootPath: string | null,
  filter: ChangeFilter,
) {
  const [counts, setCounts] = useState<Map<string, { added: number; removed: number }>>(new Map());
  const fetchedRef = useRef<Set<string>>(new Set());
  const prevFilterRef = useRef<ChangeFilter>(filter);
  const prevRootPathRef = useRef<string | null>(rootPath);

  useEffect(() => {
    if (!rootPath) return;

    // Branch changes are diffed against the merge base, not the working tree,
    // so the working-tree hunk count helper does not apply here.
    if (filter === 'branch') {
      setCounts(new Map());
      return;
    }

    // Reset cache when switching projects or filters so counts stay fresh.
    if (prevFilterRef.current !== filter || prevRootPathRef.current !== rootPath) {
      fetchedRef.current.clear();
      prevFilterRef.current = filter;
      prevRootPathRef.current = rootPath;
      setCounts(new Map());
    }

    const targets = entries.filter(
      (e) => (e.source === 'git' || e.source === 'both') && !fetchedRef.current.has(e.key),
    );
    if (targets.length === 0) return;

    let cancelled = false;

    void Promise.all(
      targets.map(async (entry) => {
        const count = await loadGitChangeCount(entry.relPath, rootPath, entry.staged ?? false);
        if (!cancelled) {
          setCounts((prev) => {
            const next = new Map(prev);
            next.set(entry.key, count);
            return next;
          });
          fetchedRef.current.add(entry.key);
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [entries, rootPath, filter]);

  return counts;
}

function useDiffContent(
  entry: SessionChangeEntry | null,
  rootPath: string | null,
  filter: ChangeFilter,
) {
  const [content, setContent] = useState<DiffContent | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entry) {
      setContent(null);
      return;
    }

    if (entry.agentSession) {
      setContent(buildAgentDiffContent(entry.agentSession));
      return;
    }

    if (!rootPath) {
      setContent(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const opts =
      filter === 'branch' ? { originalRef: 'merge-base', modifiedRef: 'HEAD' } : undefined;

    buildGitDiffContent(entry.relPath, rootPath, entry.kind, opts)
      .then((c) => {
        if (!cancelled) setContent(c);
      })
      .catch(() => {
        if (!cancelled)
          setContent({ original: '', modified: '', language: detectLang(entry.filePath) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entry, rootPath, filter]);

  return { content, loading };
}

function statusLetter(entry: SessionChangeEntry): string {
  if (entry.gitFile) return entry.gitFile.status;
  if (entry.kind === 'added') return 'A';
  if (entry.kind === 'deleted') return 'D';
  if (entry.kind === 'renamed') return 'R';
  return 'M';
}

function statusClasses(letter: string): string {
  switch (letter) {
    case 'A':
    case 'C':
      return 'bg-green-500/15 text-green-400';
    case 'D':
      return 'bg-red-500/15 text-red-400';
    case 'R':
      return 'bg-blue-500/15 text-blue-400';
    case '?':
      return 'bg-muted text-muted-foreground';
    case 'U':
      return 'bg-orange-500/15 text-orange-400';
    case 'T':
      return 'bg-purple-500/15 text-purple-400';
    case 'M':
    default:
      return 'bg-yellow-500/15 text-yellow-400';
  }
}

function StatusBadge({ entry }: { entry: SessionChangeEntry }) {
  const letter = statusLetter(entry);
  return (
    <span
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold',
        statusClasses(letter),
      )}
      title={entry.gitFile ? gitStatusLabel(entry.gitFile.status) : kindLabel(entry.kind)}
    >
      {letter}
    </span>
  );
}

function FilePath({ relPath }: { relPath: string }) {
  const lastSlash = relPath.lastIndexOf('/');
  if (lastSlash === -1) {
    return <span className="truncate text-[11px] text-foreground">{relPath}</span>;
  }
  const dir = relPath.slice(0, lastSlash + 1);
  const name = relPath.slice(lastSlash + 1);
  return (
    <span className="min-w-0 truncate text-[11px]">
      <span className="text-muted-foreground">{dir}</span>
      <span className="text-foreground">{name}</span>
    </span>
  );
}

function CountBadge({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 text-[10px] tabular-nums">
      {added > 0 && <span className="text-green-400">+{added}</span>}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && <span className="text-red-400">-{removed}</span>}
    </span>
  );
}

function AgentChangesContent() {
  const filter = useLayoutStore((s) => s.agentChangesFilter);

  const agentEditSessions = useAgentStore((s) => s.agentEditSessions);
  const messages = useAgentStore((s) => s.messages);
  const getLastTurnId = useAgentStore((s) => s.getLastTurnId);
  const lastTurnId = useMemo(() => getLastTurnId(), [getLastTurnId, messages, agentEditSessions]);

  const gitStaged = useGitStore((s) => s.staged);
  const gitUnstaged = useGitStore((s) => s.unstaged);
  const gitUntracked = useGitStore((s) => s.untracked);
  const gitConflicts = useGitStore((s) => s.conflicts);
  const gitBranchChanges = useGitStore((s) => s.branchChanges);
  const fetchBranchChanges = useGitStore((s) => s.fetchBranchChanges);

  const rootPath = useFileStore((s) => s.rootPath);

  const entries = useMemo(
    () =>
      buildSessionChanges({
        filter,
        agentEditSessions,
        lastTurnId,
        git: {
          staged: gitStaged,
          unstaged: gitUnstaged,
          untracked: gitUntracked,
          conflicts: gitConflicts,
          branchChanges: gitBranchChanges,
        },
        rootPath,
      }),
    [
      filter,
      agentEditSessions,
      lastTurnId,
      gitStaged,
      gitUnstaged,
      gitUntracked,
      gitConflicts,
      gitBranchChanges,
      rootPath,
    ],
  );

  // Ensure branch changes are loaded when the branch filter is active.
  useEffect(() => {
    if (filter !== 'branch') return;
    void fetchBranchChanges();
  }, [filter, fetchBranchChanges, rootPath]);

  const gitCounts = useGitChangeCounts(entries, rootPath, filter);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  // Expand the first entry by default when the list becomes non-empty.
  useEffect(() => {
    setExpandedKeys((prev) => {
      if (prev.size > 0 || entries.length === 0) return prev;
      return new Set([entries[0].key]);
    });
  }, [entries]);

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleAcceptOne = (id: string) => {
    HarnessBridge.get().resolveEditSession(id, true);
  };

  const handleRejectOne = (id: string) => {
    HarnessBridge.get().resolveEditSession(id, false);
  };

  return (
    <div className="flex h-full flex-col">
      {entries.length === 0 ? (
        <EmptyChangesState filter={filter} />
      ) : (
        <div className="flex-1 overflow-auto">
          {entries.map((entry) => {
            const gitCount = gitCounts.get(entry.key);
            const added = gitCount ? gitCount.added : entry.added;
            const removed = gitCount ? gitCount.removed : entry.removed;
            const isExpanded = expandedKeys.has(entry.key);
            const isPending =
              entry.agentSession?.phase === 'streaming' ||
              entry.agentSession?.phase === 'pending_review';

            return (
              <div key={entry.key} className="border-b border-border/30 last:border-b-0">
                <button
                  onClick={() => toggleExpanded(entry.key)}
                  className={cn(
                    'group flex w-full items-center gap-2 px-2 py-1 text-left transition-colors',
                    isExpanded
                      ? 'bg-accent/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <StatusBadge entry={entry} />
                  <FilePath relPath={entry.relPath} />
                  {entry.gitFile?.old_path && (
                    <span className="hidden shrink-0 truncate text-[9px] text-muted-foreground lg:block">
                      ← {entry.gitFile.old_path}
                    </span>
                  )}
                  <span className="ml-auto shrink-0">
                    <CountBadge added={added} removed={removed} />
                  </span>
                  {/* Per-file actions for pending agent edits */}
                  {entry.agentSession && isPending && (
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAcceptOne(entry.agentSession!.id);
                        }}
                        className="rounded p-0.5 hover:bg-green-500/15 text-green-400"
                        title="Keep"
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRejectOne(entry.agentSession!.id);
                        }}
                        className="rounded p-0.5 hover:bg-muted"
                        title="Undo"
                      >
                        <Undo2 className="h-3 w-3" />
                      </span>
                    </div>
                  )}
                </button>

                <div
                  className={cn(
                    'overflow-hidden transition-all duration-300 ease-out',
                    isExpanded ? 'max-h-[320px] opacity-100' : 'max-h-0 opacity-0',
                  )}
                >
                  {isExpanded && <ExpandedDiff entry={entry} rootPath={rootPath} filter={filter} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExpandedDiff({
  entry,
  rootPath,
  filter,
}: {
  entry: SessionChangeEntry;
  rootPath: string | null;
  filter: ChangeFilter;
}) {
  const { content, loading } = useDiffContent(entry, rootPath, filter);

  if (loading) {
    return (
      <div className="h-32">
        <LoadingSpinner />
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex h-32 items-center justify-center text-[10px] text-muted-foreground">
        Unable to load diff
      </div>
    );
  }

  return (
    <div className="max-h-[320px] overflow-auto bg-surface">
      <DiffViewer
        original={content.original}
        modified={content.modified}
        hunks={entry.agentSession?.hunks}
      />
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function FilterDropdown({
  value,
  onChange,
}: {
  value: ChangeFilter;
  onChange: (filter: ChangeFilter) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ChangeFilter)}
        className="h-6 appearance-none rounded-md border border-border/50 bg-surface-raised pl-2 pr-6 text-[11px] font-medium text-foreground outline-none transition-colors hover:border-border hover:bg-muted/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
      >
        {FILTER_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {filterLabel(f)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function AgentChangesToolbar() {
  const filter = useLayoutStore((s) => s.agentChangesFilter);
  const setFilter = useLayoutStore((s) => s.setAgentChangesFilter);

  const agentEditSessions = useAgentStore((s) => s.agentEditSessions);
  const messages = useAgentStore((s) => s.messages);
  const getLastTurnId = useAgentStore((s) => s.getLastTurnId);
  const lastTurnId = useMemo(() => getLastTurnId(), [getLastTurnId, messages, agentEditSessions]);

  const gitStaged = useGitStore((s) => s.staged);
  const gitUnstaged = useGitStore((s) => s.unstaged);
  const gitUntracked = useGitStore((s) => s.untracked);
  const gitConflicts = useGitStore((s) => s.conflicts);
  const gitBranchChanges = useGitStore((s) => s.branchChanges);
  const gitRefresh = useGitStore((s) => s.refresh);
  const fetchBranchChanges = useGitStore((s) => s.fetchBranchChanges);

  const rootPath = useFileStore((s) => s.rootPath);

  // Ensure branch changes are loaded when the toolbar is visible with the branch filter.
  useEffect(() => {
    if (filter !== 'branch') return;
    void fetchBranchChanges();
  }, [filter, fetchBranchChanges, rootPath]);

  const entries = useMemo(
    () =>
      buildSessionChanges({
        filter,
        agentEditSessions,
        lastTurnId,
        git: {
          staged: gitStaged,
          unstaged: gitUnstaged,
          untracked: gitUntracked,
          conflicts: gitConflicts,
          branchChanges: gitBranchChanges,
        },
        rootPath,
      }),
    [
      filter,
      agentEditSessions,
      lastTurnId,
      gitStaged,
      gitUnstaged,
      gitUntracked,
      gitConflicts,
      gitBranchChanges,
      rootPath,
    ],
  );

  const gitCounts = useGitChangeCounts(entries, rootPath, filter);

  const { totalAdded, totalRemoved } = useMemo(
    () =>
      entries.reduce(
        (acc, entry) => {
          const gitCount = gitCounts.get(entry.key);
          acc.totalAdded += gitCount ? gitCount.added : entry.added;
          acc.totalRemoved += gitCount ? gitCount.removed : entry.removed;
          return acc;
        },
        { totalAdded: 0, totalRemoved: 0 },
      ),
    [entries, gitCounts],
  );

  const hasPending = entries.some(
    (e) => e.agentSession?.phase === 'streaming' || e.agentSession?.phase === 'pending_review',
  );

  const handleAcceptAll = () => {
    if (filter === 'last-turn' && lastTurnId) {
      useAgentStore.getState().resolveTurnEditSessions(lastTurnId, true);
    } else {
      HarnessBridge.get().resolveAllEditSessions(true);
    }
  };

  const handleRejectAll = () => {
    if (filter === 'last-turn' && lastTurnId) {
      useAgentStore.getState().resolveTurnEditSessions(lastTurnId, false);
    } else {
      HarnessBridge.get().resolveAllEditSessions(false);
    }
  };

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <FilterDropdown value={filter} onChange={setFilter} />
        <CountBadge added={totalAdded} removed={totalRemoved} />
      </div>

      <div className="flex items-center gap-0.5">
        <IconButton onClick={() => void gitRefresh()} title="Refresh git status">
          <RefreshCw className="h-3 w-3" />
        </IconButton>
        {hasPending && (
          <>
            <IconButton onClick={handleAcceptAll} title="Keep all pending agent changes">
              <Check className="h-3 w-3 text-green-400" />
            </IconButton>
            <IconButton onClick={handleRejectAll} title="Undo all pending agent changes">
              <Undo2 className="h-3 w-3" />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyChangesState({ filter }: { filter: ChangeFilter }) {
  const messages: Record<ChangeFilter, { title: string; subtitle: string }> = {
    session: {
      title: 'No changes in this session',
      subtitle: 'Agent edits will appear here across all turns',
    },
    'last-turn': {
      title: 'No changes in the last turn',
      subtitle: 'The most recent agent turn did not modify files',
    },
    staged: {
      title: 'Nothing staged',
      subtitle: 'Stage files in the Git panel to see them here',
    },
    working: {
      title: 'No working tree changes',
      subtitle: 'Modified and untracked files will appear here',
    },
    branch: {
      title: 'No branch changes',
      subtitle: 'No files differ between this branch and its base',
    },
  };
  const { title, subtitle } = messages[filter];

  return (
    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
      <GitCompare className="mb-3 h-8 w-8 opacity-20" />
      <span className="text-[11px]">{title}</span>
      <span className="mt-1 text-center px-4 text-[10px] opacity-60">{subtitle}</span>
    </div>
  );
}

// ─── Preview Tab ────────────────────────────────────────────────────────────

function PreviewTab() {
  const previewFile = useLayoutStore((s) => s.agentPreviewFile);
  const themeId = useSettingsStore((s) => s.themeId);
  const monacoTheme = getMonacoThemeName(themeId);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mdMode, setMdMode] = useState<'preview' | 'code'>('preview');

  // Reset markdown mode when file changes
  useEffect(() => {
    setMdMode('preview');
  }, [previewFile]);

  useEffect(() => {
    if (!previewFile) {
      setContent(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Check file cache first
    const cached = useFileStore.getState().fileCache.get(previewFile);
    if (cached !== undefined) {
      setContent(cached);
      setLoading(false);
      return;
    }

    tauriFs
      .readFile(previewFile)
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) setContent('// Error reading file');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [previewFile]);

  if (!previewFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <Eye className="mb-3 h-8 w-8 opacity-20" />
        <span className="text-[11px]">No file selected</span>
        <span className="mt-1 text-[10px] opacity-60">Click a file in the explorer to preview</span>
      </div>
    );
  }

  if (loading) return <LoadingSpinner />;

  const fileName = previewFile.split(/[\\/]/).pop() ?? previewFile;
  const isMarkdown = /\.mdx?$/i.test(previewFile);

  if (isMarkdown) {
    return (
      <MarkdownViewer
        content={content ?? ''}
        mode={mdMode}
        onModeChange={setMdMode}
        language="markdown"
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* File name bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-1.5">
        <FileCode2 className="h-3 w-3 text-muted-foreground" />
        <span className="truncate text-[11px] text-foreground">{fileName}</span>
        <span className="text-[9px] text-muted-foreground uppercase">
          {detectLang(previewFile)}
        </span>
      </div>
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<LoadingSpinner />}>
          <MonacoEditor
            language={detectLang(previewFile)}
            value={content ?? ''}
            theme={monacoTheme}
            beforeMount={defineAllMonacoThemes}
            options={{
              fontFamily: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace",
              fontSize: 13,
              lineHeight: 1.6,
              readOnly: true,
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              minimap: { enabled: false },
              padding: { top: 8 },
              wordWrap: 'on',
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}

// ─── Loading Spinner ────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

const TAB_META: Record<RightTab, { label: string; icon: React.ElementType }> = {
  changes: { label: 'Changes', icon: GitCompare },
  files: { label: 'Files', icon: Folder },
  preview: { label: 'Preview', icon: Eye },
  terminal: { label: 'Terminal', icon: Terminal },
};

export function AgentRightPanel() {
  const activeTab = useLayoutStore((s) => s.agentRightTab);
  const setActiveTab = useLayoutStore((s) => s.setAgentRightTab);
  const setRightCollapsed = useLayoutStore((s) => s.setAgentRightCollapsed);
  const reorderAgentRightTabs = useLayoutStore((s) => s.reorderAgentRightTabs);
  const tabPrefsMap = useLayoutStore((s) => s.agentRightTabPrefs);
  const rootPath = useFileStore((s) => s.rootPath);

  // Per-project tab order + visibility
  const { order, visible } = useMemo(() => {
    const key = agentRightTabProjectKey(rootPath);
    return normalizeAgentRightTabPrefs(tabPrefsMap[key]);
  }, [tabPrefsMap, rootPath]);

  const visibleTabs = useMemo(() => order.filter((id) => visible[id]), [order, visible]);

  // Ensure the active tab is visible; otherwise fall back to the first visible tab
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0]);
    }
  }, [visibleTabs, activeTab, setActiveTab]);

  // ── Drag-and-drop reorder (native HTML5) ───────────────────────────────────
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounterRef = useRef(0);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragCounterRef.current = 0;
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragCounterRef.current++;
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      setDragOverIndex(null);
      dragCounterRef.current = 0;
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toVisibleIndex: number) => {
      e.preventDefault();
      const fromVisibleIndex = dragIndex;
      setDragIndex(null);
      setDragOverIndex(null);
      dragCounterRef.current = 0;
      if (fromVisibleIndex === null || fromVisibleIndex === toVisibleIndex) return;
      // Map visible indices back to indices within the full order array
      const fromId = visibleTabs[fromVisibleIndex];
      const toId = visibleTabs[toVisibleIndex];
      const fromIndex = order.indexOf(fromId);
      const toIndex = order.indexOf(toId);
      if (fromIndex !== -1 && toIndex !== -1) {
        reorderAgentRightTabs(fromIndex, toIndex);
      }
    },
    [dragIndex, visibleTabs, order, reorderAgentRightTabs],
  );

  // ── Context menu (right-click) ─────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Badge: count of pending changes
  const pendingCount = useAgentStore(
    (s) =>
      s.agentEditSessions.filter((es) => es.phase === 'streaming' || es.phase === 'pending_review')
        .length,
  );

  // Pulsing dot: agent is streaming and has an agent terminal active
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const hasAgentTerminal = useTerminalStore((s) => s.sessions.some((sess) => sess.isAgentSession));
  const terminalActive = isStreaming && hasAgentTerminal;

  return (
    <div className="flex h-full flex-col">
      {/* Header / tab bar */}
      <div
        onContextMenu={handleContextMenu}
        className="flex h-8 shrink-0 items-center gap-1 border-b border-border/30 bg-surface-raised px-2"
      >
        <button
          onClick={() => setRightCollapsed(true)}
          title="Collapse panel"
          aria-label="Collapse panel"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
        {visibleTabs.map((id, index) => {
          const { label, icon: Icon } = TAB_META[id];
          return (
            <button
              key={id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex h-8 items-center gap-1.5 px-3 text-[11px] font-medium transition-colors',
                activeTab === id
                  ? 'bg-surface text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                dragOverIndex === index && dragIndex !== index && 'border-l-2 border-accent',
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {label}
              {id === 'changes' && pendingCount > 0 && (
                <span className="rounded-full bg-accent/20 px-1.5 text-[9px] font-medium text-accent tabular-nums">
                  {pendingCount}
                </span>
              )}
              {id === 'terminal' && terminalActive && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {contextMenu && (
        <RightTabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          order={order}
          visible={visible}
          tabMeta={TAB_META}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Tab content */}
      <div className="relative flex-1 overflow-hidden">
        <div className={cn('absolute inset-0', activeTab === 'changes' ? 'z-10' : 'z-0 invisible')}>
          <ChangesTab />
        </div>
        <div className={cn('absolute inset-0', activeTab === 'files' ? 'z-10' : 'z-0 invisible')}>
          <div className="h-full overflow-auto px-2">
            <FileExplorerView />
          </div>
        </div>
        <div className={cn('absolute inset-0', activeTab === 'preview' ? 'z-10' : 'z-0 invisible')}>
          <PreviewTab />
        </div>
        <div
          className={cn('absolute inset-0', activeTab === 'terminal' ? 'z-10' : 'z-0 invisible')}
        >
          <TerminalPanel />
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  EyeOff,
  Folder,
  FolderOpen,
  Hammer,
  History,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  CheckCircle2,
  CircleAlert,
  CircleStop,
  Trash2,
  X,
} from 'lucide-react';
import { pickFolder } from '@/lib/tauri-dialog';
import {
  activateVortexSession,
  openProjectWorkspace,
} from '@/lib/project-persistence';
import {
  loadVortexProjectSessionIndex,
  mergeVortexRuntimeSessions,
  VORTEX_SESSION_INDEX_UPDATED_EVENT,
  type VortexProjectSummary,
  type VortexSessionSummary,
} from '@/lib/vortex-project-sessions';
import { tauriInvoke } from '@/lib/tauri-invoke';
import { useAgentStore, type AgentMode } from '@/stores/agent-store';
import { useProjectStore } from '@/stores/project-store';
import {
  getVortexRuntimeKey,
  useVortexRuntimeStore,
  vortexSessionRuntimeManager,
} from '@/lib/vortex-session-runtime';
import type { VortexRuntimeSnapshot } from '@/lib/vortex-runtime-types';
import { isVortexRuntimeActive } from '@/lib/vortex-runtime-types';
import { cn, writeClipboard } from '@/lib/utils';
import { promptConfirm, promptInput } from '@/components/ui/dialogs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { areSameProjectPath } from '@/lib/project-path';

const MODE_ICONS: Record<AgentMode, typeof MessageSquare> = {
  chat: MessageSquare,
  build: Hammer,
  review: Search,
  debug: Bug,
  plan: ClipboardList,
};

const RECENT_SESSION_LIMIT = 5;

function relativeTime(dateString: string): string {
  const timestamp = Date.parse(dateString);
  if (Number.isNaN(timestamp)) return 'unknown';
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function runtimeStatusLabel(status: VortexRuntimeSnapshot['status']): string | null {
  switch (status) {
    case 'starting':
      return 'Starting';
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'waiting':
      return 'Waiting';
    case 'cancelling':
      return 'Stopping';
    case 'completed':
      return 'Completed';
    case 'error':
      return 'Needs attention';
    case 'cancelled':
      return 'Cancelled';
    case 'idle':
      return null;
  }
}

async function startNewSession(): Promise<void> {
  const projectPath = useProjectStore.getState().rootPath;
  if (!projectPath) throw new Error('Open a project before starting a session.');
  await vortexSessionRuntimeManager.createAndFocus(projectPath);
  useAgentStore.getState().setHistoryOpen(false);
}

export function VortexProjectSessionNavigator() {
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const hiddenProjectPaths = useProjectStore((state) => state.vortexHiddenProjectPaths);
  const activeProjectPath = useProjectStore((state) => state.rootPath);
  const projectLoading = useProjectStore((state) => state.isLoading);
  const hideFromVortex = useProjectStore((state) => state.hideFromVortex);
  const currentConversationId = useAgentStore((state) => state.conversationId);
  const messageCount = useAgentStore((state) => state.messages.length);
  const runtimeSnapshots = useVortexRuntimeStore((state) => state.snapshots);
  const runtimeList = useMemo(() => Object.values(runtimeSnapshots), [runtimeSnapshots]);

  const [index, setIndex] = useState<{ projects: VortexProjectSummary[]; recentSessions: VortexSessionSummary[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const requestId = useRef(0);
  const hasLoadedIndex = useRef(false);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!hasLoadedIndex.current) setLoading(true);
    setError(null);
    try {
      const nextIndex = await loadVortexProjectSessionIndex(recentProjects, hiddenProjectPaths);
      if (currentRequest !== requestId.current) return;
      setIndex(nextIndex);
      hasLoadedIndex.current = true;
    } catch (cause) {
      if (currentRequest !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : 'Unable to load VORTEX projects.');
      setIndex(null);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [hiddenProjectPaths, recentProjects]);

  useEffect(() => {
    if (projectLoading) {
      hasLoadedIndex.current = false;
      return;
    }
    void refresh();
  }, [currentConversationId, messageCount, projectLoading, refresh]);

  useEffect(() => {
    if (projectLoading || !activeProjectPath || !currentConversationId) return;
    const focused = vortexSessionRuntimeManager.getFocusedSnapshot();
    if (focused?.key === getVortexRuntimeKey(activeProjectPath, currentConversationId)) return;
    void vortexSessionRuntimeManager
      .focusSession(activeProjectPath, currentConversationId, { allowMissing: true })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : 'Unable to prepare the VORTEX runtime.');
      });
  }, [activeProjectPath, currentConversationId, projectLoading]);

  useEffect(() => {
    const handleIndexUpdated = () => {
      if (!projectLoading) void refresh();
    };
    window.addEventListener(VORTEX_SESSION_INDEX_UPDATED_EVENT, handleIndexUpdated);
    return () => window.removeEventListener(VORTEX_SESSION_INDEX_UPDATED_EVENT, handleIndexUpdated);
  }, [projectLoading, refresh]);

  const normalizedQuery = query.trim().toLowerCase();
  const liveIndex = useMemo(
    () =>
      index
        ? mergeVortexRuntimeSessions(index, runtimeList, hiddenProjectPaths)
        : null,
    [hiddenProjectPaths, index, runtimeList],
  );

  const visibleProjects = useMemo(() => {
    if (!liveIndex) return [];
    return liveIndex.projects.filter((project) => {
      if (!normalizedQuery) return true;
      return (
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.path.toLowerCase().includes(normalizedQuery) ||
        project.sessions.some((session) => session.title.toLowerCase().includes(normalizedQuery))
      );
    });
  }, [liveIndex, normalizedQuery]);

  const visibleRecentSessions = useMemo(() => {
    if (!liveIndex) return [];
    const sessions = normalizedQuery
      ? liveIndex.recentSessions.filter(
          (session) =>
            session.title.toLowerCase().includes(normalizedQuery) ||
            session.projectName.toLowerCase().includes(normalizedQuery),
        )
      : liveIndex.recentSessions;
    return showAllRecent || normalizedQuery ? sessions : sessions.slice(0, RECENT_SESSION_LIMIT);
  }, [liveIndex, normalizedQuery, showAllRecent]);

  const runtimeByKey = useMemo(
    () => new Map(runtimeList.map((runtime) => [runtime.key, runtime])),
    [runtimeList],
  );

  const runAction = useCallback(async (actionId: string, action: () => Promise<void>) => {
    setPendingAction(actionId);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The VORTEX action failed.');
    } finally {
      setPendingAction(null);
    }
  }, []);

  const handleOpenProject = useCallback(async () => {
    const path = await pickFolder();
    if (!path) return;
    await runAction(`project:${path}`, async () => {
      await openProjectWorkspace(path, { workspaceMode: 'agent' });
    });
  }, [runAction]);

  const handleNewSession = useCallback(async () => {
    if (!activeProjectPath) {
      const path = await pickFolder();
      if (!path) return;
      await runAction(`project:${path}`, async () => {
        await openProjectWorkspace(path, { workspaceMode: 'agent' });
        await startNewSession();
      });
      return;
    }
    await startNewSession();
  }, [activeProjectPath, runAction]);

  const handleCopyProjectPath = useCallback(
    async (project: VortexProjectSummary) => {
      await runAction(`copy-path:${project.path}`, async () => {
        await writeClipboard(project.path);
      });
    },
    [runAction],
  );

  const handleRevealProject = useCallback(
    async (project: VortexProjectSummary) => {
      await runAction(`reveal:${project.path}`, async () => {
        await tauriInvoke('reveal_path', { path: project.path });
      });
    },
    [runAction],
  );

  const handleSessionClick = useCallback(
    async (session: VortexSessionSummary) => {
      if (session.id === currentConversationId && areSameProjectPath(session.projectPath, activeProjectPath)) {
        return;
      }
      await runAction(`session:${session.id}`, async () => {
        await activateVortexSession(session.projectPath, session.id);
      });
    },
    [activeProjectPath, currentConversationId, runAction],
  );

  const handleProjectNewSession = useCallback(
    async (project: VortexProjectSummary) => {
      if (areSameProjectPath(project.path, activeProjectPath)) {
        await startNewSession();
        return;
      }
      await runAction(`project:${project.path}`, async () => {
        await openProjectWorkspace(project.path, { workspaceMode: 'agent' });
        await startNewSession();
      });
    },
    [activeProjectPath, runAction],
  );

  const handleRenameSession = useCallback(
    async (session: VortexSessionSummary) => {
      const title = await promptInput({
        title: 'Rename session',
        placeholder: 'Session title',
        defaultValue: session.title,
      });
      if (!title || title === session.title) return;
      await runAction(`rename:${session.id}`, async () => {
        await tauriInvoke('db_update_conversation', { conversationId: session.id, title });
        vortexSessionRuntimeManager.updateSessionTitle(session.projectPath, session.id, title);
        if (session.id === currentConversationId) {
          useAgentStore.getState().updateTabTitle(useAgentStore.getState().activeTabId, title);
        }
        await refresh();
      });
    },
    [currentConversationId, refresh, runAction],
  );

  const handleDeleteSession = useCallback(
    async (session: VortexSessionSummary) => {
      const confirmed = await promptConfirm({
        title: 'Delete session?',
        description: `This permanently deletes “${session.title}” and its messages.`,
        confirmLabel: 'Delete session',
        danger: true,
      });
      if (!confirmed) return;
      await runAction(`delete:${session.id}`, async () => {
        const runtime = runtimeByKey.get(getVortexRuntimeKey(session.projectPath, session.id));
        if (runtime && isVortexRuntimeActive(runtime.status)) {
          throw new Error('Stop the running session before deleting it.');
        }
        await tauriInvoke('db_delete_conversation', { conversationId: session.id });
        vortexSessionRuntimeManager.forgetSession(session.projectPath, session.id);
        if (session.id === currentConversationId) {
          useAgentStore.getState().clearConversation();
        }
        useAgentStore.getState().deleteSession(session.id);
        await refresh();
      });
    },
    [currentConversationId, refresh, runAction, runtimeByKey],
  );

  const handleCancelSession = useCallback(
    (session: VortexSessionSummary) => {
      vortexSessionRuntimeManager.cancelSession(session.projectPath, session.id);
    },
    [],
  );

  const handleRetrySession = useCallback(
    async (session: VortexSessionSummary) => {
      await runAction(`retry:${session.id}`, async () => {
        await activateVortexSession(session.projectPath, session.id);
        await vortexSessionRuntimeManager.retrySession(session.projectPath, session.id);
      });
    },
    [runAction],
  );

  const handleHideProject = useCallback(
    (project: VortexProjectSummary) => {
      if (areSameProjectPath(project.path, activeProjectPath)) return;
      hideFromVortex(project.path);
    },
    [activeProjectPath, hideFromVortex],
  );

  const toggleProject = (path: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border/40 px-2.5 py-2">
        <button
          onClick={() => void handleNewSession()}
          disabled={pendingAction !== null}
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
          New session
        </button>
        <div className="mt-1.5 flex items-center gap-1">
          <button
            onClick={() => void handleOpenProject()}
            disabled={pendingAction !== null}
            title="Open or add project"
            aria-label="Open or add project"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border/50 bg-surface-raised px-2 py-1">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setShowAllRecent(false);
              }}
              placeholder="Search projects and sessions"
              aria-label="Search projects and sessions"
              className="min-w-0 flex-1 bg-transparent text-[10px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                title="Clear search"
                aria-label="Clear search"
                className="shrink-0 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1.5 py-2">
        {loading || projectLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading projects…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-[11px] text-muted-foreground">
            <History className="h-5 w-5 opacity-40" />
            <span>{error}</span>
            <button
              onClick={() => void refresh()}
              className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <section aria-labelledby="vortex-recent-heading">
              <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span id="vortex-recent-heading">Recent</span>
                <div className="flex items-center gap-0.5">
                  <span>{liveIndex?.recentSessions.length ?? 0}</span>
                  <button
                    type="button"
                    onClick={() => setRecentExpanded((current) => !current)}
                    aria-expanded={recentExpanded}
                    aria-controls="vortex-recent-content"
                    title={recentExpanded ? 'Hide recent sessions' : 'Show recent sessions'}
                    aria-label={recentExpanded ? 'Hide recent sessions' : 'Show recent sessions'}
                    className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {recentExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                </div>
              </div>
              {recentExpanded && (
                <div id="vortex-recent-content">
                  {visibleRecentSessions.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-muted-foreground">No recent sessions.</p>
                  ) : (
                    <div className="flex flex-col gap-px">
                      {visibleRecentSessions.map((session) => (
                        <VortexSessionRow
                          key={`recent:${session.id}`}
                          session={session}
                          isActive={session.id === currentConversationId && areSameProjectPath(session.projectPath, activeProjectPath)}
                          runtime={runtimeByKey.get(getVortexRuntimeKey(session.projectPath, session.id))}
                          showProjectName
                          busy={pendingAction !== null}
                          onOpen={() => void handleSessionClick(session)}
                          onRename={() => void handleRenameSession(session)}
                          onDelete={() => void handleDeleteSession(session)}
                          onCancel={() => handleCancelSession(session)}
                          onRetry={() => void handleRetrySession(session)}
                        />
                      ))}
                    </div>
                  )}
                  {!normalizedQuery && (liveIndex?.recentSessions.length ?? 0) > RECENT_SESSION_LIMIT && (
                    <button
                      onClick={() => setShowAllRecent((current) => !current)}
                      className="w-full px-2 py-1.5 text-left text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {showAllRecent ? 'Show fewer sessions' : 'Show more sessions'}
                    </button>
                  )}
                </div>
              )}
            </section>

            <div className="my-2 border-t border-border/30" />

            <section aria-labelledby="vortex-projects-heading">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span id="vortex-projects-heading">Projects</span>
              </div>
              {visibleProjects.length === 0 ? (
                <div className="px-2 py-6 text-[11px] text-muted-foreground">
                  {normalizedQuery ? 'No matching projects.' : 'Open a project to start managing sessions.'}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {visibleProjects.map((project) => (
                    <VortexProjectGroup
                      key={project.path}
                      project={project}
                      activeProjectPath={activeProjectPath}
                      currentConversationId={currentConversationId}
                      runtimes={runtimeList.filter((runtime) => areSameProjectPath(runtime.projectPath, project.path))}
                      collapsed={collapsedProjects.has(project.path)}
                      pendingAction={pendingAction}
                      onToggle={() => toggleProject(project.path)}
                      onNewSession={() => void handleProjectNewSession(project)}
                      onCopyPath={() => void handleCopyProjectPath(project)}
                      onReveal={() => void handleRevealProject(project)}
                      onOpen={(session) => void handleSessionClick(session)}
                      onRename={(session) => void handleRenameSession(session)}
                      onDelete={(session) => void handleDeleteSession(session)}
                      onCancel={(session) => handleCancelSession(session)}
                      onRetry={(session) => void handleRetrySession(session)}
                      onHide={() => handleHideProject(project)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

    </div>
  );
}

function VortexProjectGroup({
  project,
  activeProjectPath,
  currentConversationId,
  runtimes,
  collapsed,
  pendingAction,
  onToggle,
  onNewSession,
  onCopyPath,
  onReveal,
  onOpen,
  onRename,
  onDelete,
  onCancel,
  onRetry,
  onHide,
}: {
  project: VortexProjectSummary;
  activeProjectPath: string | null;
  currentConversationId: string | null;
  runtimes: VortexRuntimeSnapshot[];
  collapsed: boolean;
  pendingAction: string | null;
  onToggle: () => void;
  onNewSession: () => void;
  onCopyPath: () => void;
  onReveal: () => void;
  onOpen: (session: VortexSessionSummary) => void;
  onRename: (session: VortexSessionSummary) => void;
  onDelete: (session: VortexSessionSummary) => void;
  onCancel: (session: VortexSessionSummary) => void;
  onRetry: (session: VortexSessionSummary) => void;
  onHide: () => void;
}) {
  const isActiveProject = areSameProjectPath(project.path, activeProjectPath);
  const activeRuntimeCount = runtimes.filter((runtime) => isVortexRuntimeActive(runtime.status)).length;
  const runtimesByKey = new Map(runtimes.map((runtime) => [runtime.key, runtime]));
  return (
    <div className="rounded-md">
      <div className={cn('group flex items-center gap-1 rounded-md px-1 py-1', isActiveProject && 'bg-primary/10')}>
        <button
          onClick={onToggle}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${project.name}`}
          aria-expanded={!collapsed}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <button
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {isActiveProject ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate" title={project.path}>{project.name}</span>
          <span className="shrink-0 text-[9px] text-muted-foreground">{project.sessions.length}</span>
          {activeRuntimeCount > 0 && (
            <span className="shrink-0 text-[9px] text-primary" role="status">
              {activeRuntimeCount} active
            </span>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={pendingAction !== null}
            title="Project actions"
            aria-label={`Actions for ${project.name}`}
            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 disabled:opacity-30"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="right" className="w-52">
            <DropdownMenuItem onClick={onNewSession}>
              <Plus className="h-3.5 w-3.5" />
              New session
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCopyPath}>
              <Copy className="h-3.5 w-3.5" />
              Copy project path
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onReveal}>
              <FolderOpen className="h-3.5 w-3.5" />
              Reveal in File Explorer
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onHide} disabled={isActiveProject}>
              <EyeOff className="h-3.5 w-3.5" />
              Hide from Vortex
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onNewSession();
          }}
          disabled={pendingAction !== null}
          title={`New session in ${project.name}`}
          aria-label={`New session in ${project.name}`}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {!collapsed && (
        <div className="ml-3 flex flex-col gap-px border-l border-border/30 pl-1">
          {project.sessions.length === 0 ? (
            <p className="px-2 py-2 text-[10px] text-muted-foreground">No sessions in this workspace yet.</p>
          ) : (
            project.sessions.map((session) => (
              <VortexSessionRow
                key={session.id}
                session={session}
                isActive={session.id === currentConversationId && isActiveProject}
                runtime={runtimesByKey.get(getVortexRuntimeKey(session.projectPath, session.id))}
                busy={pendingAction !== null}
                onOpen={() => onOpen(session)}
                onRename={() => onRename(session)}
                onDelete={() => onDelete(session)}
                onCancel={() => onCancel(session)}
                onRetry={() => onRetry(session)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function VortexSessionRow({
  session,
  isActive,
  runtime,
  showProjectName = false,
  busy,
  onOpen,
  onRename,
  onDelete,
  onCancel,
  onRetry,
}: {
  session: VortexSessionSummary;
  isActive: boolean;
  runtime?: VortexRuntimeSnapshot;
  showProjectName?: boolean;
  busy: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const runtimeIsActive = runtime ? isVortexRuntimeActive(runtime.status) : false;
  const Icon = runtimeIsActive
    ? Loader2
    : runtime?.status === 'error'
      ? CircleAlert
      : runtime?.status === 'completed'
        ? CheckCircle2
        : runtime?.status === 'cancelled'
          ? CircleStop
          : MODE_ICONS[session.mode] ?? MessageSquare;
  const statusLabel = runtime ? runtimeStatusLabel(runtime.status) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={isActive ? 'page' : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        isActive ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground',
        busy && 'pointer-events-none opacity-60',
      )}
      title={statusLabel ? `${session.title} · ${statusLabel}` : session.title}
    >
      {runtimeIsActive ? (
        <Loader2
          className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary"
          role="status"
          aria-label={statusLabel ?? 'Agent working'}
        />
      ) : (
        <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', isActive && 'text-primary', runtime?.status === 'error' && 'text-destructive')} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[11px] font-medium">{session.title}</span>
          {isActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Active session" />}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[9px] text-muted-foreground">
          {showProjectName && <span className="max-w-[8rem] truncate">{session.projectName}</span>}
          {showProjectName && <span>·</span>}
          <span>{session.messageCount} msgs</span>
          <span>·</span>
          <span>{relativeTime(session.updatedAt)}</span>
          {statusLabel && (
            <>
              <span>·</span>
              <span className={cn(runtime?.status === 'error' ? 'text-destructive' : runtimeIsActive && 'text-primary')}>
                {statusLabel}
              </span>
            </>
          )}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={busy}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          title="Session actions"
          aria-label={`Actions for ${session.title}`}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="right" className="w-36">
          {runtimeIsActive && (
            <DropdownMenuItem onClick={onCancel}>
              <CircleStop className="h-3.5 w-3.5" />
              Stop session
            </DropdownMenuItem>
          )}
          {runtime?.status === 'error' && (
            <DropdownMenuItem onClick={onRetry}>
              <History className="h-3.5 w-3.5" />
              Retry session
            </DropdownMenuItem>
          )}
          {(runtimeIsActive || runtime?.status === 'error') && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} disabled={runtimeIsActive} variant="destructive">
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

import { Suspense, lazy, useState, useMemo, useEffect } from 'react';
import {
  Terminal,
  GitCompare,
  GitBranch,
  Eye,
  FileCode2,
  Check,
  Undo2,
  Loader2,
  PanelRightClose,
  Folder,
} from 'lucide-react';
import { MarkdownViewer } from '../editor/viewers/markdown-viewer';
import { TerminalPanel } from '../terminal';
import { GitView } from '../sidebar/views/git-view-new';
import { FileExplorerView } from '../sidebar/views/file-explorer-view';
import { useAgentStore } from '@/stores/agent-store';
import { useGitStore } from '@/stores/git-store';
import { useLayoutStore } from '@/stores/layout-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useFileStore } from '@/stores/file-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { tauriFs } from '@/lib/tauri-fs';
import { defineAllMonacoThemes, getMonacoThemeName } from '@/lib/monaco-themes';
import { cn } from '@/lib/utils';
import { TabBadge } from '../ui/tab-badge';
import type { AgentEditSession } from '@/stores/agent-store';
import { countDiffLines } from '@/lib/compute-diff';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));
const MonacoDiffEditor = lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.DiffEditor })),
);

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

// ─── Line count helpers ─────────────────────────────────────────────────────

function computeLineCounts(session: AgentEditSession) {
  return countDiffLines(session.hunks);
}

// ─── Changes Tab (with Agent + Git sub-tabs) ───────────────────────────────

type ChangesSubTab = 'agent' | 'git';

function ChangesTab() {
  const [subTab, setSubTab] = useState<ChangesSubTab>('agent');

  const pendingCount = useAgentStore(
    (s) =>
      s.agentEditSessions.filter((es) => es.phase === 'streaming' || es.phase === 'pending_review')
        .length,
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
          <TabBadge count={pendingCount} />
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

function AgentChangesContent() {
  const selectedFile = useLayoutStore((s) => s.agentSelectedChangeFile);
  const setSelectedFile = useLayoutStore((s) => s.setAgentSelectedChangeFile);
  const allSessions = useAgentStore((s) => s.agentEditSessions);
  const themeId = useSettingsStore((s) => s.themeId);
  const monacoTheme = getMonacoThemeName(themeId);

  const sessions = useMemo(
    () => allSessions.filter((es) => es.phase === 'streaming' || es.phase === 'pending_review'),
    [allSessions],
  );

  const selectedSession = useMemo(
    () => allSessions.find((s) => s.filePath === selectedFile) ?? null,
    [allSessions, selectedFile],
  );

  // Auto-select first file if current selection is no longer valid
  useEffect(() => {
    if (selectedFile && !sessions.find((s) => s.filePath === selectedFile)) {
      setSelectedFile(sessions[0]?.filePath ?? null);
    }
  }, [sessions, selectedFile]);

  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <GitCompare className="mb-3 h-8 w-8 opacity-20" />
        <span className="text-[11px]">No pending changes</span>
        <span className="mt-1 text-[10px] opacity-60">Agent edits will appear here</span>
      </div>
    );
  }

  const handleAcceptAll = () => {
    HarnessBridge.get().resolveAllEditSessions(true);
  };

  const handleRejectAll = () => {
    HarnessBridge.get().resolveAllEditSessions(false);
  };

  const handleAcceptOne = (id: string) => {
    HarnessBridge.get().resolveEditSession(id, true);
  };

  const handleRejectOne = (id: string) => {
    HarnessBridge.get().resolveEditSession(id, false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* File list header + actions */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-3 py-1.5">
        <span className="text-[10px] font-medium text-muted-foreground">
          {sessions.length} {sessions.length === 1 ? 'file' : 'files'} changed
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleAcceptAll}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-green-400 hover:bg-green-500/15 transition-colors"
          >
            <Check className="h-3 w-3" />
            Keep All
          </button>
          <button
            onClick={handleRejectAll}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Undo2 className="h-3 w-3" />
            Undo All
          </button>
        </div>
      </div>

      {/* File list */}
      <div className="flex shrink-0 flex-col border-b border-border/30">
        {sessions.map((session) => {
          const fileName = session.filePath.split(/[\\/]/).pop() ?? session.filePath;
          const dir = session.filePath.split(/[\\/]/).slice(-2, -1)[0] ?? '';
          const { added, removed } = computeLineCounts(session);
          const isSelected = session.filePath === selectedFile;

          return (
            <button
              key={session.id}
              onClick={() => setSelectedFile(session.filePath)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-left transition-colors group',
                isSelected
                  ? 'bg-accent/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span className="truncate text-[11px] font-medium">{fileName}</span>
                {dir && <span className="truncate text-[9px] opacity-60">{dir}</span>}
              </div>
              <span className="shrink-0 text-[10px] tabular-nums">
                {added > 0 && <span className="text-green-400">+{added}</span>}
                {added > 0 && removed > 0 && ' '}
                {removed > 0 && <span className="text-red-400">-{removed}</span>}
              </span>
              {/* Per-file actions */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAcceptOne(session.id);
                  }}
                  className="rounded p-0.5 hover:bg-green-500/15 text-green-400"
                  title="Accept"
                >
                  <Check className="h-3 w-3" />
                </span>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRejectOne(session.id);
                  }}
                  className="rounded p-0.5 hover:bg-muted"
                  title="Reject"
                >
                  <Undo2 className="h-3 w-3" />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Diff viewer */}
      <div className="flex-1 overflow-hidden">
        {selectedSession ? (
          <Suspense fallback={<LoadingSpinner />}>
            <MonacoDiffEditor
              original={selectedSession.originalContent ?? ''}
              modified={selectedSession.newContent}
              language={detectLang(selectedSession.filePath)}
              theme={monacoTheme}
              beforeMount={defineAllMonacoThemes}
              options={{
                fontFamily: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace",
                fontSize: 13,
                lineHeight: 1.6,
                readOnly: true,
                renderSideBySide: false,
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                minimap: { enabled: false },
                padding: { top: 8 },
                overviewRulerLanes: 0,
                overviewRulerBorder: false,
              }}
            />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
            Select a file to view changes
          </div>
        )}
      </div>
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

type RightTab = 'changes' | 'preview' | 'terminal' | 'files';

const TAB_CONFIG: Array<{ id: RightTab; label: string; icon: React.ElementType }> = [
  { id: 'changes', label: 'Changes', icon: GitCompare },
  { id: 'files', label: 'Files', icon: Folder },
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
];

export function AgentRightPanel() {
  const activeTab = useLayoutStore((s) => s.agentRightTab);
  const setActiveTab = useLayoutStore((s) => s.setAgentRightTab);
  const setRightCollapsed = useLayoutStore((s) => s.setAgentRightCollapsed);

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
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/30 bg-surface-raised px-2">
        <button
          onClick={() => setRightCollapsed(true)}
          title="Collapse panel"
          aria-label="Collapse panel"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
        {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex h-8 items-center gap-1.5 px-3 text-[11px] font-medium transition-colors',
              activeTab === id
                ? 'bg-surface text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
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
        ))}
      </div>

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

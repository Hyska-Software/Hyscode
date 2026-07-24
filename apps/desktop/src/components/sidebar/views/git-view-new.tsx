import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  GitBranch,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  MoreHorizontal,
  History,
  Archive,
  ArrowUp,
  ArrowDown,
  Download,
  GitMerge,
  Tag,
  Trash2,
  RotateCcw,
  GitFork,
  CheckCircle,
  XCircle,
  Sparkles,
  Settings2,
  GitPullRequest,
  GitFork as GraphIcon,
} from 'lucide-react';
import { useGitStore, useEditorStore } from '../../../stores';
import { useSettingsStore } from '../../../stores/settings-store';
import { getViewerType } from '../../../lib/utils';
import { detectLanguage } from '../../../lib/lsp-bridge';
import { GitFileItem } from '../../git/git-file-item';
import { GitLogView } from '../../git/git-log-view';
import { GitGraphView } from '../../git/git-graph-view';
import { PullRequestDialog } from '../../git/pull-request-dialog';
import { promptInput, promptConfirm } from '../../ui/dialogs';
import type { GitFile } from '../../../stores/git-store';
import { generateCommitMessage } from '../../../lib/commit-message-ai';
import { PROVIDERS, getAllEnabledModelsGrouped } from '../../../lib/provider-catalog';

type PanelMode = 'changes' | 'log' | 'graph';

export function GitView() {
  const isGitRepo = useGitStore((s) => s.isGitRepo);
  const currentBranch = useGitStore((s) => s.currentBranch);
  const staged = useGitStore((s) => s.staged);
  const unstaged = useGitStore((s) => s.unstaged);
  const untracked = useGitStore((s) => s.untracked);
  const conflicts = useGitStore((s) => s.conflicts);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);
  const commitMessage = useGitStore((s) => s.commitMessage);
  const isLoading = useGitStore((s) => s.isLoading);

  const refresh = useGitStore((s) => s.refresh);
  const stageFiles = useGitStore((s) => s.stageFiles);
  const stageAll = useGitStore((s) => s.stageAll);
  const unstageFiles = useGitStore((s) => s.unstageFiles);
  const unstageAll = useGitStore((s) => s.unstageAll);
  const discardFiles = useGitStore((s) => s.discardFiles);
  const discardAll = useGitStore((s) => s.discardAll);
  const commit = useGitStore((s) => s.commit);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const initRepo = useGitStore((s) => s.initRepo);
  const stashChanges = useGitStore((s) => s.stashChanges);
  const popStash = useGitStore((s) => s.popStash);
  const fetchStashes = useGitStore((s) => s.fetchStashes);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const fetchRemote = useGitStore((s) => s.fetch);
  const mergeBranch = useGitStore((s) => s.mergeBranch);
  const createTag = useGitStore((s) => s.createTag);
  const createBranch = useGitStore((s) => s.createBranch);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const deleteBranch = useGitStore((s) => s.deleteBranch);
  const fetchBranches = useGitStore((s) => s.fetchBranches);
  const getStagedDiff = useGitStore((s) => s.getStagedDiff);

  const commitAiProviderId = useSettingsStore((s) => s.commitAiProviderId);
  const commitAiModelId = useSettingsStore((s) => s.commitAiModelId);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const activeModelId = useSettingsStore((s) => s.activeModelId);
  const enabledModels = useSettingsStore((s) => s.enabledModels);
  const customModels = useSettingsStore((s) => s.customModels);
  const setSettings = useSettingsStore((s) => s.set);

  const openTab = useEditorStore((s) => s.openTab);

  const [panelMode, setPanelMode] = useState<PanelMode>('changes');
  const [showMenu, setShowMenu] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [opStatus, setOpStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [showPrDialog, setShowPrDialog] = useState(false);
  const generateAbortRef = useRef<AbortController | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const aiSettingsRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Merge untracked into changes (unstaged + untracked = "Changes")
  const changes = useMemo(() => [...unstaged, ...untracked], [unstaged, untracked]);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // Close AI settings popover on outside click
  useEffect(() => {
    if (!showAiSettings) return;
    const handler = (e: MouseEvent) => {
      if (aiSettingsRef.current && !aiSettingsRef.current.contains(e.target as Node)) {
        setShowAiSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAiSettings]);

  // Refresh on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-clear operation status after 3s
  useEffect(() => {
    if (!opStatus) return;
    const t = setTimeout(() => setOpStatus(null), 3000);
    return () => clearTimeout(t);
  }, [opStatus]);

  const handleGenerateMessage = useCallback(async () => {
    if (staged.length === 0) {
      setGenerateError('Stage some files first');
      return;
    }
    // Resolve which provider/model to use: commit-specific first, then active
    const resolvedProviderId = commitAiProviderId ?? activeProviderId;
    const resolvedModelId = commitAiModelId ?? activeModelId;
    if (!resolvedProviderId || !resolvedModelId) {
      setGenerateError('Configure an AI provider in Settings → AI');
      return;
    }

    setIsGenerating(true);
    setGenerateError(null);
    const abort = new AbortController();
    generateAbortRef.current = abort;

    try {
      const diff = await getStagedDiff();
      if (!diff.trim()) {
        setGenerateError('No staged diff available');
        return;
      }
      const message = await generateCommitMessage({
        providerId: resolvedProviderId,
        modelId: resolvedModelId,
        diff,
        signal: abort.signal,
      });
      if (!abort.signal.aborted && message) {
        setCommitMessage(message);
      }
    } catch (err: any) {
      if (!abort.signal.aborted) {
        setGenerateError(err.message ?? String(err));
      }
    } finally {
      setIsGenerating(false);
      generateAbortRef.current = null;
    }
  }, [staged.length, commitAiProviderId, commitAiModelId, activeProviderId, activeModelId, getStagedDiff, setCommitMessage]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || staged.length === 0) return;
    setIsCommitting(true);
    setCommitError(null);
    try {
      await commit();
      setOpStatus({ type: 'success', msg: 'Committed successfully' });
    } catch (err: any) {
      setCommitError(err.message ?? String(err));
    } finally {
      setIsCommitting(false);
    }
  }, [commitMessage, staged.length, commit]);

  const runOp = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setShowMenu(false);
    try {
      await fn();
      setOpStatus({ type: 'success', msg: `${label} completed` });
    } catch (err: any) {
      setOpStatus({ type: 'error', msg: `${label} failed: ${err.message ?? err}` });
    }
  }, []);

  // ── Dropdown operations ────────────────────────────────────────────────────

  const handlePush = useCallback(() => runOp('Push', () => push()), [runOp, push]);
  const handlePull = useCallback(() => runOp('Pull', () => pull()), [runOp, pull]);
  const handleFetch = useCallback(() => runOp('Fetch', () => fetchRemote()), [runOp, fetchRemote]);

  const handleStash = useCallback(async () => {
    setShowMenu(false);
    const msg = await promptInput({ title: 'Stash Changes (optional message)', placeholder: 'WIP' });
    if (msg === null) return; // cancelled
    await runOp('Stash', () => stashChanges(msg || undefined));
  }, [runOp, stashChanges]);

  const handlePopStash = useCallback(async () => {
    setShowMenu(false);
    await fetchStashes();
    const stashList = useGitStore.getState().stashes;
    if (stashList.length === 0) {
      setOpStatus({ type: 'error', msg: 'No stashes to pop' });
      return;
    }
    const pick = await promptInput({
      title: `Pop Stash (index 0-${stashList.length - 1})`,
      placeholder: '0',
      defaultValue: '0',
    });
    if (pick === null) return;
    const idx = parseInt(pick, 10);
    if (isNaN(idx) || idx < 0 || idx >= stashList.length) {
      setOpStatus({ type: 'error', msg: 'Invalid stash index' });
      return;
    }
    await runOp('Pop Stash', () => popStash(idx));
  }, [runOp, popStash, fetchStashes]);

  const handleCreateBranch = useCallback(async () => {
    setShowMenu(false);
    const name = await promptInput({ title: 'Create Branch', placeholder: 'feature/my-branch' });
    if (!name) return;
    await runOp('Create Branch', () => createBranch(name, true));
  }, [runOp, createBranch]);

  const handleCheckoutBranch = useCallback(async () => {
    setShowMenu(false);
    await fetchBranches();
    const branchList = useGitStore.getState().branches;
    const localBranches = branchList.filter((b) => !b.is_remote && !b.is_current);
    if (localBranches.length === 0) {
      setOpStatus({ type: 'error', msg: 'No other branches available' });
      return;
    }
    const name = await promptInput({
      title: `Checkout Branch (${localBranches.map((b) => b.name).join(', ')})`,
      placeholder: 'branch name',
    });
    if (!name) return;
    await runOp('Checkout', () => checkoutBranch(name));
  }, [runOp, checkoutBranch, fetchBranches]);

  const handleDeleteBranch = useCallback(async () => {
    setShowMenu(false);
    await fetchBranches();
    const branchList = useGitStore.getState().branches;
    const localBranches = branchList.filter((b) => !b.is_remote && !b.is_current);
    if (localBranches.length === 0) {
      setOpStatus({ type: 'error', msg: 'No branches to delete' });
      return;
    }
    const name = await promptInput({
      title: `Delete Branch (${localBranches.map((b) => b.name).join(', ')})`,
      placeholder: 'branch name',
    });
    if (!name) return;
    const confirmed = await promptConfirm({ title: 'Delete Branch', description: `Delete branch "${name}"? This cannot be undone.` });
    if (!confirmed) return;
    await runOp('Delete Branch', () => deleteBranch(name));
  }, [runOp, deleteBranch, fetchBranches]);

  const handleMerge = useCallback(async () => {
    setShowMenu(false);
    await fetchBranches();
    const branchList = useGitStore.getState().branches;
    const localBranches = branchList.filter((b) => !b.is_remote && !b.is_current);
    if (localBranches.length === 0) {
      setOpStatus({ type: 'error', msg: 'No branches to merge' });
      return;
    }
    const name = await promptInput({
      title: `Merge Branch (${localBranches.map((b) => b.name).join(', ')})`,
      placeholder: 'branch name to merge into current',
    });
    if (!name) return;
    await runOp('Merge', () => mergeBranch(name));
  }, [runOp, mergeBranch, fetchBranches]);

  const handleCreateTag = useCallback(async () => {
    setShowMenu(false);
    const name = await promptInput({ title: 'Create Tag', placeholder: 'v1.0.0' });
    if (!name) return;
    const msg = await promptInput({ title: 'Tag Message (optional)', placeholder: 'Release v1.0.0' });
    await runOp('Create Tag', () => createTag(name, msg || undefined));
  }, [runOp, createTag]);

  const handleDiscardAll = useCallback(async () => {
    setShowMenu(false);
    if (changes.length === 0) return;
    const confirmed = await promptConfirm({ title: 'Discard All Changes', description: `Discard all ${changes.length} changes? This cannot be undone.` });
    if (!confirmed) return;
    await runOp('Discard All', () => discardAll());
  }, [runOp, discardAll, changes.length]);

  const handleUnstageAll = useCallback(async () => {
    setShowMenu(false);
    await runOp('Unstage All', () => unstageAll());
  }, [runOp, unstageAll]);

  const openDiffTab = useCallback(
    (file: GitFile, isStaged: boolean) => {
      const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
      openTab({
        id: `diff:${isStaged ? 'staged' : 'unstaged'}:${file.path}`,
        filePath: file.path,
        fileName: `${fileName} (${isStaged ? 'Staged' : 'Working Tree'})`,
        language: detectLanguage(file.path),
        type: 'diff',
        diffProps: { filePath: file.path, staged: isStaged },
      });
    },
    [openTab],
  );

  const openFileTab = useCallback(
    (file: GitFile) => {
      const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
      openTab({
        id: file.path,
        filePath: file.path,
        fileName,
        language: detectLanguage(file.path),
        viewerType: getViewerType(fileName),
      });
    },
    [openTab],
  );

  // Not a git repo
  if (!isGitRepo) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <GitBranch className="mb-3 h-8 w-8 opacity-30" />
        <p className="text-xs">Not a Git repository</p>
        <button
          onClick={initRepo}
          className="mt-3 rounded-md bg-primary px-3 py-1.5 text-[11px] text-white hover:bg-primary/80 transition-colors"
        >
          Initialize Repository
        </button>
      </div>
    );
  }

  if (panelMode === 'log') {
    return <GitLogView onClose={() => setPanelMode('changes')} />;
  }

  if (panelMode === 'graph') {
    return <GitGraphView onClose={() => setPanelMode('changes')} />;
  }

  const totalChanges = staged.length + changes.length + conflicts.length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3 w-3 text-primary" />
          <span className="text-[11px] font-medium text-foreground">{currentBranch}</span>
          {ahead > 0 && <span className="text-[10px] text-success">↑{ahead}</span>}
          {behind > 0 && <span className="text-[10px] text-warning">↓{behind}</span>}
        </div>
        <div className="flex items-center gap-0.5">
          {/* History — directly accessible */}
          <button
            onClick={() => setPanelMode('log')}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="View Commit History"
          >
            <History className="h-3 w-3" />
          </button>
          {/* Git Graph — directly accessible */}
          <button
            onClick={() => setPanelMode('graph')}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Git Graph Visualization"
          >
            <GraphIcon className="h-3 w-3" />
          </button>
          {/* Create Pull Request — directly accessible */}
          <button
            onClick={() => setShowPrDialog(true)}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Create Pull Request"
          >
            <GitPullRequest className="h-3 w-3" />
          </button>
          <button
            onClick={refresh}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Refresh"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Git operations"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
            {showMenu && (
              <div
                ref={menuRef}
                className="absolute right-0 top-6 z-50 min-w-[180px] max-h-[400px] overflow-auto rounded-lg border border-border bg-background p-1 shadow-xl"
              >
                {/* Remote */}
                <MenuSection label="Remote">
                  <MenuBtn icon={ArrowUp} label="Push" onClick={handlePush} />
                  <MenuBtn icon={ArrowDown} label="Pull" onClick={handlePull} />
                  <MenuBtn icon={Download} label="Fetch" onClick={handleFetch} />
                </MenuSection>

                <MenuDivider />

                {/* Staging */}
                <MenuSection label="Changes">
                  <MenuBtn icon={Plus} label="Stage All" onClick={async () => { setShowMenu(false); await stageAll(); }} />
                  <MenuBtn icon={Minus} label="Unstage All" onClick={handleUnstageAll} />
                  <MenuBtn icon={RotateCcw} label="Discard All" onClick={handleDiscardAll} />
                </MenuSection>

                <MenuDivider />

                {/* Branch */}
                <MenuSection label="Branch">
                  <MenuBtn icon={GitFork} label="Create Branch" onClick={handleCreateBranch} />
                  <MenuBtn icon={GitBranch} label="Checkout Branch" onClick={handleCheckoutBranch} />
                  <MenuBtn icon={Trash2} label="Delete Branch" onClick={handleDeleteBranch} />
                  <MenuBtn icon={GitMerge} label="Merge Branch" onClick={handleMerge} />
                </MenuSection>

                <MenuDivider />

                {/* Misc */}
                <MenuSection label="Other">
                  <MenuBtn icon={Archive} label="Stash Changes" onClick={handleStash} />
                  <MenuBtn icon={Archive} label="Pop Stash" onClick={handlePopStash} />
                  <MenuBtn icon={Tag} label="Create Tag" onClick={handleCreateTag} />
                  <MenuBtn icon={History} label="View History" onClick={() => { setShowMenu(false); setPanelMode('log'); }} />
                </MenuSection>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Operation status toast */}
      {opStatus && (
        <div className={`flex items-center gap-1.5 px-2 py-1 text-[10px] border-b border-border ${
          opStatus.type === 'success' ? 'text-success bg-success/5' : 'text-destructive bg-destructive/5'
        }`}>
          {opStatus.type === 'success' ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          <span className="truncate">{opStatus.msg}</span>
        </div>
      )}

      {/* Commit Input */}
      <div className="border-b border-border px-2 py-1.5">
        {/* Textarea with AI generate button */}
        <div className="relative">
          <textarea
            ref={messageRef}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message..."
            rows={2}
            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 pr-16 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40 transition-colors"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                handleCommit();
              }
            }}
          />
          {/* AI generate + AI settings buttons (top-right of textarea) */}
          <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
            <button
              onClick={handleGenerateMessage}
              disabled={isGenerating || staged.length === 0}
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={isGenerating ? 'Generating…' : 'Generate commit message with AI'}
            >
              {isGenerating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
            </button>
            {/* AI model settings popover */}
            <div className="relative" ref={aiSettingsRef}>
              <button
                onClick={() => setShowAiSettings((v) => !v)}
                className={`flex h-5 w-5 items-center justify-center rounded-sm transition-colors ${
                  showAiSettings
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                title="AI commit model settings"
              >
                <Settings2 className="h-3 w-3" />
              </button>

              {showAiSettings && (
                <AiModelPopover
                  commitAiProviderId={commitAiProviderId}
                  commitAiModelId={commitAiModelId}
                  enabledModels={enabledModels}
                  customModels={customModels}
                  onProviderChange={(pid) => setSettings('commitAiProviderId', pid)}
                  onModelChange={(mid) => setSettings('commitAiModelId', mid)}
                  onClose={() => setShowAiSettings(false)}
                />
              )}
            </div>
          </div>
        </div>

        {(commitError || generateError) && (
          <p className="mt-0.5 text-[10px] text-destructive">{commitError ?? generateError}</p>
        )}
        <button
          onClick={handleCommit}
          disabled={!commitMessage.trim() || staged.length === 0 || isCommitting}
          className="mt-1 w-full rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-white hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isCommitting ? (
            <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
          ) : (
            `Commit${staged.length > 0 ? ` (${staged.length})` : ''}`
          )}
        </button>
      </div>

      {/* File Lists */}
      <div className="flex-1 overflow-auto">
        {totalChanges === 0 && !isLoading && (
          <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">
            No changes detected
          </div>
        )}

        {conflicts.length > 0 && (
          <FileSection title="Merge Conflicts" count={conflicts.length} defaultOpen>
            {conflicts.map((f) => (
              <GitFileItem
                key={`conflict:${f.path}`}
                file={f}
                mode="conflict"
                onOpenDiff={() => openDiffTab(f, false)}
                onOpenFile={() => openFileTab(f)}
              />
            ))}
          </FileSection>
        )}

        {staged.length > 0 && (
          <FileSection
            title="Staged Changes"
            count={staged.length}
            defaultOpen
            action={
              <button
                onClick={() => unstageFiles(staged.map((f) => f.path))}
                className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                title="Unstage All"
              >
                <Minus className="h-3 w-3" />
              </button>
            }
          >
            {staged.map((f) => (
              <GitFileItem
                key={`staged:${f.path}`}
                file={f}
                mode="staged"
                onUnstage={() => unstageFiles([f.path])}
                onOpenDiff={() => openDiffTab(f, true)}
                onOpenFile={() => openFileTab(f)}
              />
            ))}
          </FileSection>
        )}

        {changes.length > 0 && (
          <FileSection
            title="Changes"
            count={changes.length}
            defaultOpen
            action={
              <button
                onClick={() => stageFiles(changes.map((f) => f.path))}
                className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                title="Stage All"
              >
                <Plus className="h-3 w-3" />
              </button>
            }
          >
            {changes.map((f) => (
              <GitFileItem
                key={`change:${f.path}`}
                file={f}
                mode={f.status === '?' ? 'untracked' : 'unstaged'}
                onStage={() => stageFiles([f.path])}
                onDiscard={() => discardFiles([f.path])}
                onOpenDiff={f.status !== '?' ? () => openDiffTab(f, false) : undefined}
                onOpenFile={() => openFileTab(f)}
              />
            ))}
          </FileSection>
        )}
      </div>

      {/* Pull Request Dialog */}
      <PullRequestDialog open={showPrDialog} onClose={() => setShowPrDialog(false)} />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface AiModelPopoverProps {
  commitAiProviderId: string | null;
  commitAiModelId: string | null;
  enabledModels: Record<string, string[]>;
  customModels: Array<{ providerId: string; modelId: string; name: string }>;
  onProviderChange: (pid: string | null) => void;
  onModelChange: (mid: string | null) => void;
  onClose: () => void;
}

function AiModelPopover({
  commitAiProviderId,
  commitAiModelId,
  enabledModels,
  customModels,
  onProviderChange,
  onModelChange,
}: AiModelPopoverProps) {
  const grouped = getAllEnabledModelsGrouped(enabledModels, customModels);
  const hasModels = grouped.some((g) => g.models.length > 0);

  const currentValue =
    commitAiProviderId && commitAiModelId
      ? `${commitAiProviderId}::${commitAiModelId}`
      : '';

  const handleChange = (value: string) => {
    if (!value) {
      onProviderChange(null);
      onModelChange(null);
      return;
    }
    const sep = value.indexOf('::');
    if (sep === -1) return;
    const pid = value.slice(0, sep);
    const mid = value.slice(sep + 2);
    onProviderChange(pid);
    onModelChange(mid);
  };

  return (
    <div className="absolute right-0 top-6 z-50 w-64 rounded-lg border border-border bg-background p-3 shadow-xl">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        AI Commit Model
      </div>
      <p className="mb-2 text-[10px] text-muted-foreground leading-relaxed">
        Model used to generate commit messages. Leave empty to use the active agent model.
      </p>
      {!hasModels ? (
        <p className="text-[10px] text-warning">
          No enabled models found. Configure providers in Settings → AI.
        </p>
      ) : (
        <select
          value={currentValue}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full rounded-md bg-muted px-2 py-1 text-[11px] text-foreground outline-none"
        >
          <option value="">Use active agent model</option>
          {grouped.map(({ provider, models }) => (
            <optgroup key={provider.id} label={provider.name}>
              {models.map((m) => (
                <option key={m.id} value={`${provider.id}::${m.id}`}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}

      {commitAiProviderId && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="truncate">
            {PROVIDERS.find((p) => p.id === commitAiProviderId)?.name ?? commitAiProviderId}
          </span>
          <ChevronRight className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate text-foreground">{commitAiModelId}</span>
        </div>
      )}
    </div>
  );
}

function FileSection({
  title,
  count,
  children,
  defaultOpen = true,
  action,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <div className="flex w-full items-center">
        <button
          onClick={() => setOpen(!open)}
          className="flex flex-1 items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span>{title}</span>
          <span className="font-normal">{count}</span>
        </button>
        {action && <span className="ml-auto pr-2">{action}</span>}
      </div>
      {open && children}
    </div>
  );
}

function MenuSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {label}
      </div>
      {children}
    </div>
  );
}

function MenuDivider() {
  return <div className="my-1 h-px bg-border" />;
}

function MenuBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof History;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-foreground hover:bg-surface-raised transition-colors"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Language detection delegated to detectLanguage() from @hyscode/lsp-client

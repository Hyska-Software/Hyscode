import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ModelSelector,
  type ModelOption,
} from '@hyscode/ui';
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
  Check,
  Github,
  PlusCircle,
  Link2,
} from 'lucide-react';
import { useGitStore, useEditorStore } from '../../../stores';
import { useGithubStore } from '../../../stores/github-store';
import { useSettingsStore } from '../../../stores/settings-store';
import { getViewerType } from '../../../lib/utils';
import { detectLanguage } from '../../../lib/lsp-bridge';
import { GitFileItem } from '../../git/git-file-item';
import { GitLogView } from '../../git/git-log-view';
import { GitGraphView } from '../../git/git-graph-view';
import { PullRequestDialog } from '../../git/pull-request-dialog';
import { promptInput, promptConfirm } from '../../ui/dialogs';
import type { GitFile } from '../../../stores/git-store';
import { useCommitMessageGeneration } from '../../../hooks/use-commit-message-generation';
import {
  listCommitMessageTargets,
  type CommitMessageTarget,
} from '../../../lib/commit-message-provider';
import {
  getCommitRemoteActions,
  isRepositoryOperationInProgress,
  shouldConfirmGitDiscard,
} from '../../../lib/git-workflow';

type PanelMode = 'changes' | 'log' | 'graph';
type CommitAction = 'commit' | 'amend' | 'push' | 'sync';

export function GitView() {
  const isGitRepo = useGitStore((s) => s.isGitRepo);
  const repositoryState = useGitStore((s) => s.repositoryState);
  const repositoryError = useGitStore((s) => s.repositoryError);
  const repositoryRoot = useGitStore((s) => s.repositoryRoot);
  const repositoryOperation = useGitStore((s) => s.repositoryOperation);
  const activeOperation = useGitStore((s) => s.activeOperation);
  const currentBranch = useGitStore((s) => s.currentBranch);
  const upstream = useGitStore((s) => s.upstream);
  const headState = useGitStore((s) => s.headState);
  const remotes = useGitStore((s) => s.remotes);
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
  const amendCommit = useGitStore((s) => s.amendCommit);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const initRepo = useGitStore((s) => s.initRepo);
  const addRemote = useGitStore((s) => s.addRemote);
  const removeRemote = useGitStore((s) => s.removeRemote);
  const openCloneDialog = useGithubStore((s) => s.openCloneDialog);
  const openPublishDialog = useGithubStore((s) => s.openPublishDialog);
  const stashChanges = useGitStore((s) => s.stashChanges);
  const popStash = useGitStore((s) => s.popStash);
  const applyStash = useGitStore((s) => s.applyStash);
  const fetchStashes = useGitStore((s) => s.fetchStashes);
  const push = useGitStore((s) => s.push);
  const publishBranch = useGitStore((s) => s.publishBranch);
  const pull = useGitStore((s) => s.pull);
  const fetchRemote = useGitStore((s) => s.fetch);
  const fetchAll = useGitStore((s) => s.fetchAll);
  const mergeBranch = useGitStore((s) => s.mergeBranch);
  const createTag = useGitStore((s) => s.createTag);
  const createBranch = useGitStore((s) => s.createBranch);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const deleteBranch = useGitStore((s) => s.deleteBranch);
  const fetchBranches = useGitStore((s) => s.fetchBranches);
  const getCommitContext = useGitStore((s) => s.getCommitContext);
  const getStagedFingerprint = useGitStore((s) => s.getStagedFingerprint);
  const confirmDiscard = useSettingsStore((s) => s.gitConfirmDiscard);

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
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [showPrDialog, setShowPrDialog] = useState(false);
  const [showCommitMenu, setShowCommitMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const commitMenuRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Merge untracked into changes (unstaged + untracked = "Changes")
  const changes = useMemo(() => [...unstaged, ...untracked], [unstaged, untracked]);
  const stagedSignature = useMemo(
    () =>
      staged
        .map((file) => `${file.status}:${file.old_path ?? ''}:${file.path}`)
        .sort()
        .join('\u0000'),
    [staged],
  );
  const openAiSettings = useCallback(() => setShowAiSettings(true), []);
  const commitMessageGeneration = useCommitMessageGeneration({
    repositoryRoot,
    stagedSignature,
    hasStagedChanges: staged.length > 0,
    commitMessage,
    commitProviderId: commitAiProviderId,
    commitModelId: commitAiModelId,
    activeProviderId,
    activeModelId,
    enabledModels,
    customModels,
    getCommitContext,
    getStagedFingerprint,
    setCommitMessage,
    openModelSelector: openAiSettings,
  });
  const repositoryBusy = isRepositoryOperationInProgress(repositoryOperation);
  const commitRemoteActions = getCommitRemoteActions({
    headState,
    hasUpstream: upstream !== null,
    hasRemotes: remotes.length > 0,
  });

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // Keep the operations menu fully inside the viewport: flip vertically when it
  // would overflow below the trigger, and clamp horizontally/vertically so the
  // whole menu is always 100% visible regardless of element size.
  useLayoutEffect(() => {
    if (!showMenu) {
      setMenuPosition(null);
      return;
    }
    const computePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const anchor = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const margin = 8;
      const gap = 4;
      let top = anchor.bottom + gap;
      if (
        anchor.bottom + gap + menuRect.height > viewportH - margin &&
        anchor.top - gap - menuRect.height >= margin
      ) {
        top = anchor.top - gap - menuRect.height;
      }
      const left = anchor.right - menuRect.width;
      const clampedTop = Math.max(margin, Math.min(top, viewportH - margin - menuRect.height));
      const clampedLeft = Math.max(margin, Math.min(left, viewportW - margin - menuRect.width));
      setMenuPosition({ top: clampedTop, left: clampedLeft });
    };
    computePosition();
    const observer = new ResizeObserver(computePosition);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener('resize', computePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', computePosition);
    };
  }, [showMenu, remotes]);

  useEffect(() => {
    if (!showCommitMenu) return;
    const handler = (event: MouseEvent) => {
      if (commitMenuRef.current && !commitMenuRef.current.contains(event.target as Node)) {
        setShowCommitMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCommitMenu]);

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

  const chooseRemote = useCallback(
    async (requireExplicitChoice = false): Promise<string | null> => {
      if (!requireExplicitChoice && upstream?.remote) return upstream.remote;
      if (remotes.length === 0) {
        setOpStatus({ type: 'error', msg: 'No Git remote is configured' });
        return null;
      }
      if (remotes.length === 1) return remotes[0].name;
      const selected = await promptInput({
        title: `Select Remote (${remotes.map((remote) => remote.name).join(', ')})`,
        placeholder: remotes[0].name,
        defaultValue: remotes[0].name,
      });
      if (!selected) return null;
      if (!remotes.some((remote) => remote.name === selected)) {
        setOpStatus({ type: 'error', msg: `Remote "${selected}" does not exist` });
        return null;
      }
      return selected;
    },
    [remotes, upstream],
  );

  const handlePush = useCallback(async () => {
    if (upstream) {
      await runOp('Push', () => push());
      return;
    }
    if (remotes.length === 0) {
      setShowMenu(false);
      openPublishDialog();
      return;
    }
    const remote = await chooseRemote();
    if (remote) await runOp('Publish Branch', () => publishBranch(remote));
  }, [chooseRemote, openPublishDialog, publishBranch, push, remotes.length, runOp, upstream]);
  const handlePull = useCallback(() => runOp('Pull', () => pull()), [runOp, pull]);
  const handleFetch = useCallback(() => runOp('Fetch', () => fetchRemote()), [runOp, fetchRemote]);
  const handlePushTo = useCallback(async () => {
    const remote = await chooseRemote(true);
    if (remote) await runOp(`Push To ${remote}`, () => push(remote, currentBranch));
  }, [chooseRemote, currentBranch, push, runOp]);
  const handlePullFrom = useCallback(async () => {
    const remote = await chooseRemote(true);
    if (remote) await runOp(`Pull From ${remote}`, () => pull(remote));
  }, [chooseRemote, pull, runOp]);
  const handleFetchAll = useCallback(
    () => runOp('Fetch All', () => fetchAll(false)),
    [fetchAll, runOp],
  );
  const handleFetchPrune = useCallback(
    () => runOp('Fetch & Prune', () => fetchAll(true)),
    [fetchAll, runOp],
  );

  const handleAddRemote = useCallback(async () => {
    setShowMenu(false);
    const defaultName = remotes.some((remote) => remote.name === 'origin') ? '' : 'origin';
    const name = await promptInput({
      title: 'Add Remote',
      placeholder: defaultName || 'remote name',
      defaultValue: defaultName,
    });
    if (!name) return;
    const url = await promptInput({
      title: `Remote URL for "${name}"`,
      placeholder: 'https://github.com/owner/repo.git',
    });
    if (!url) return;
    await runOp('Add Remote', () => addRemote(name, url));
  }, [addRemote, remotes, runOp]);

  const handleRemoveRemote = useCallback(
    async (name: string) => {
      setShowMenu(false);
      const confirmed = await promptConfirm({
        title: `Remove remote "${name}"?`,
        description: 'The remote will be removed from this repository. This does not delete the remote repository.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!confirmed) return;
      await runOp('Remove Remote', () => removeRemote(name));
    },
    [removeRemote, runOp],
  );

  const handleCommit = useCallback(
    async (action: CommitAction = 'commit') => {
      if (
        !commitMessage.trim() ||
        (action !== 'amend' && staged.length === 0) ||
        (action === 'amend' && headState === 'unborn')
      ) {
        return;
      }
      setShowCommitMenu(false);
      setIsCommitting(true);
      setCommitError(null);
      let committedLocally = false;
      try {
        if (action === 'amend') {
          await amendCommit();
        } else {
          await commit();
        }
        committedLocally = true;

        if (action === 'push') {
          if (upstream) {
            await push();
          } else {
            const remote = await chooseRemote();
            if (!remote) {
              setOpStatus({
                type: 'success',
                msg: 'Committed locally; publish was cancelled',
              });
              return;
            }
            await publishBranch(remote);
          }
        } else if (action === 'sync') {
          await pull();
          await push();
        }

        setOpStatus({
          type: 'success',
          msg:
            action === 'commit'
              ? 'Committed successfully'
              : action === 'amend'
                ? 'Commit amended successfully'
                : action === 'push'
                  ? upstream
                    ? 'Committed and pushed successfully'
                    : 'Committed and published successfully'
                  : 'Committed and synchronized successfully',
        });
      } catch (err: any) {
        const message = err.message ?? String(err);
        setCommitError(
          committedLocally && action !== 'commit'
            ? `Committed locally, but the remote operation failed: ${message}`
            : message,
        );
      } finally {
        setIsCommitting(false);
      }
    },
    [
      amendCommit,
      chooseRemote,
      commit,
      commitMessage,
      publishBranch,
      pull,
      push,
      staged.length,
      upstream,
    ],
  );

  const handleStash = useCallback(async () => {
    setShowMenu(false);
    const msg = await promptInput({
      title: 'Stash Changes (optional message)',
      placeholder: 'WIP',
    });
    if (msg === null) return; // cancelled
    await runOp('Stash', () => stashChanges(msg || undefined));
  }, [runOp, stashChanges]);

  const handleStashIncludingUntracked = useCallback(async () => {
    setShowMenu(false);
    const msg = await promptInput({
      title: 'Stash Changes Including Untracked Files',
      placeholder: 'WIP',
    });
    if (msg === null) return;
    await runOp('Stash', () => stashChanges(msg || undefined, true));
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

  const handleApplyStash = useCallback(async () => {
    setShowMenu(false);
    await fetchStashes();
    const stashList = useGitStore.getState().stashes;
    if (stashList.length === 0) {
      setOpStatus({ type: 'error', msg: 'No stashes to apply' });
      return;
    }
    const pick = await promptInput({
      title: `Apply Stash (index 0-${stashList.length - 1})`,
      placeholder: '0',
      defaultValue: '0',
    });
    if (pick === null) return;
    const index = Number.parseInt(pick, 10);
    if (Number.isNaN(index) || index < 0 || index >= stashList.length) {
      setOpStatus({ type: 'error', msg: 'Invalid stash index' });
      return;
    }
    await runOp('Apply Stash', () => applyStash(index));
  }, [applyStash, fetchStashes, runOp]);

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
    const confirmed = await promptConfirm({
      title: 'Delete Branch',
      description: `Delete branch "${name}"? This cannot be undone.`,
    });
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
    const msg = await promptInput({
      title: 'Tag Message (optional)',
      placeholder: 'Release v1.0.0',
    });
    await runOp('Create Tag', () => createTag(name, msg || undefined));
  }, [runOp, createTag]);

  const handleDiscardAll = useCallback(async () => {
    setShowMenu(false);
    if (changes.length === 0) return;
    const untrackedCount = untracked.length;
    const confirmed = await promptConfirm({
      title: 'Discard All Changes',
      description:
        untrackedCount > 0
          ? `Restore tracked changes and permanently delete ${untrackedCount} untracked file${untrackedCount === 1 ? '' : 's'}? This cannot be undone.`
          : `Discard all ${changes.length} tracked changes? This cannot be undone.`,
    });
    if (!confirmed) return;
    await runOp('Discard All', () => discardAll());
  }, [runOp, discardAll, changes.length, untracked.length]);

  const handleDiscardFiles = useCallback(
    async (files: GitFile[]) => {
      const untrackedFiles = files.filter((file) => file.status === '?');
      const mustConfirm = shouldConfirmGitDiscard(files, confirmDiscard);
      if (mustConfirm) {
        const description =
          untrackedFiles.length > 0
            ? `Permanently delete ${untrackedFiles.map((file) => file.path).join(', ')}? This cannot be undone.`
            : `Discard changes in ${files.map((file) => file.path).join(', ')}? This cannot be undone.`;
        const confirmed = await promptConfirm({ title: 'Discard Changes', description });
        if (!confirmed) return;
      }
      await runOp('Discard', () => discardFiles(files.map((file) => file.path)));
    },
    [confirmDiscard, discardFiles, runOp],
  );

  const handleUnstageAll = useCallback(async () => {
    setShowMenu(false);
    await runOp('Unstage All', () => unstageAll());
  }, [runOp, unstageAll]);

  const openDiffTab = useCallback(
    (file: GitFile, mode: 'staged' | 'unstaged' | 'conflict') => {
      const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
      openTab({
        id: `diff:${mode}:${file.path}`,
        filePath: file.path,
        fileName: `${fileName} (${mode === 'staged' ? 'Staged' : mode === 'conflict' ? 'Conflict' : 'Working Tree'})`,
        language: detectLanguage(file.path),
        type: 'diff',
        diffProps: { filePath: file.path, staged: mode === 'staged', mode },
      });
    },
    [openTab],
  );

  const openFileTab = useCallback(
    (file: GitFile) => {
      const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
      openTab({
        id: file.absolute_path,
        filePath: file.absolute_path,
        fileName,
        language: detectLanguage(file.absolute_path),
        viewerType: getViewerType(fileName),
      });
    },
    [openTab],
  );

  if (repositoryState === 'no-workspace') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <GitBranch className="mb-3 h-8 w-8 opacity-30" />
        <p className="text-xs">Open a folder to view source control</p>
        <button
          onClick={openCloneDialog}
          className="mt-3 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] text-white hover:bg-primary/80 transition-colors"
        >
          <GitBranch className="h-3 w-3" />
          Clone Repository
        </button>
      </div>
    );
  }

  if (repositoryState === 'checking') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <Loader2 className="mb-3 h-6 w-6 animate-spin opacity-60" />
        <p className="text-xs">Checking repository…</p>
      </div>
    );
  }

  if (repositoryState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center text-muted-foreground">
        <XCircle className="mb-3 h-8 w-8 text-destructive opacity-70" />
        <p className="text-xs text-destructive">Git repository error</p>
        <p className="mt-1 text-[10px]">{repositoryError}</p>
        <button
          onClick={() => void refresh()}
          className="mt-3 rounded-md bg-muted px-3 py-1.5 text-[11px] text-foreground"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (repositoryState === 'not-repository' || !isGitRepo) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <GitBranch className="mb-3 h-8 w-8 opacity-30" />
        <p className="text-xs">Not a Git repository</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => void runOp('Initialize Repository', initRepo)}
            className="rounded-md bg-primary px-3 py-1.5 text-[11px] text-white hover:bg-primary/80 transition-colors"
          >
            Initialize Repository
          </button>
          <button
            onClick={openCloneDialog}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[11px] text-foreground hover:bg-muted transition-colors"
          >
            <GitBranch className="h-3 w-3" />
            Clone Repository
          </button>
        </div>
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
              ref={triggerRef}
              onClick={() => setShowMenu(!showMenu)}
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Git operations"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {(repositoryError || repositoryBusy || activeOperation) && (
        <div className="border-b border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
          {repositoryError ??
            (repositoryBusy
              ? `Repository operation in progress: ${repositoryOperation}`
              : `${activeOperation} in progress…`)}
        </div>
      )}

      {/* Operation status toast */}
      {opStatus && (
        <div
          className={`flex items-center gap-1.5 px-2 py-1 text-[10px] border-b border-border ${
            opStatus.type === 'success'
              ? 'text-success bg-success/5'
              : 'text-destructive bg-destructive/5'
          }`}
        >
          {opStatus.type === 'success' ? (
            <CheckCircle className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
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
              onClick={() => void commitMessageGeneration.generateOrCancel()}
              disabled={!commitMessageGeneration.isGenerating && staged.length === 0}
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={
                commitMessageGeneration.isGenerating
                  ? 'Cancel commit-message generation'
                  : 'Generate commit message with AI'
              }
            >
              {commitMessageGeneration.isGenerating ? (
                <XCircle className="h-3 w-3" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
            </button>
            <div>
              <button
                onClick={() => setShowAiSettings(true)}
                className={`flex h-5 w-5 items-center justify-center rounded-sm transition-colors ${
                  showAiSettings
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                title="AI commit model settings"
              >
                <Settings2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>

        {commitMessageGeneration.progressLabel && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {commitMessageGeneration.progressLabel}
          </p>
        )}
        {(commitError || commitMessageGeneration.error) && (
          <p className="mt-0.5 text-[10px] text-destructive">
            {commitError ?? commitMessageGeneration.error}
          </p>
        )}
        {commitMessageGeneration.suggestion && (
          <div className="mt-1 rounded-md border border-primary/20 bg-primary/5 p-2">
            <p className="whitespace-pre-wrap text-[10px] text-foreground">
              {commitMessageGeneration.suggestion}
            </p>
            <div className="mt-1.5 flex justify-end gap-1">
              <button
                type="button"
                onClick={commitMessageGeneration.dismissSuggestion}
                className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={commitMessageGeneration.applySuggestion}
                className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground"
              >
                Apply
              </button>
            </div>
          </div>
        )}
        <div ref={commitMenuRef} className="relative mt-1 flex w-full">
          <button
            onClick={() => void handleCommit()}
            disabled={
              !commitMessage.trim() ||
              staged.length === 0 ||
              isCommitting ||
              activeOperation !== null ||
              repositoryBusy
            }
            className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-l-md bg-primary px-3 py-1 text-[11px] font-medium text-white hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            {isCommitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Check className="h-3 w-3" />
                <span>{`Commit${staged.length > 0 ? ` (${staged.length})` : ''}`}</span>
              </>
            )}
          </button>
          <button
            onClick={() => setShowCommitMenu((open) => !open)}
            disabled={isCommitting || activeOperation !== null || repositoryBusy}
            className="flex w-7 shrink-0 items-center justify-center rounded-r-md border-l border-primary-foreground/25 bg-primary text-white hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            aria-label="More commit actions"
            aria-expanded={showCommitMenu}
            title="More commit actions"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          {showCommitMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[210px] overflow-hidden rounded-md border border-border bg-background py-1 shadow-xl">
              <CommitMenuButton
                label="Commit"
                disabled={!commitMessage.trim() || staged.length === 0}
                onClick={() => void handleCommit('commit')}
              />
              {headState !== 'unborn' && (
                <CommitMenuButton
                  label="Commit (Amend)"
                  disabled={!commitMessage.trim()}
                  onClick={() => void handleCommit('amend')}
                />
              )}
              {commitRemoteActions.map((action) => (
                <CommitMenuButton
                  key={action}
                  label={
                    action === 'publish'
                      ? 'Commit & Publish Branch'
                      : action === 'push'
                        ? 'Commit & Push'
                        : 'Commit & Sync'
                  }
                  disabled={!commitMessage.trim() || staged.length === 0}
                  onClick={() => void handleCommit(action === 'sync' ? 'sync' : 'push')}
                />
              ))}
              {commitRemoteActions.length === 0 && (
                <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
                  {remotes.length === 0
                    ? 'Commit remains local because no remote is configured.'
                    : 'Publishing requires a named local branch.'}
                </div>
              )}
            </div>
          )}
        </div>
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
                onStage={() => void runOp('Mark Conflict Resolved', () => stageFiles([f.path]))}
                onOpenDiff={() => openDiffTab(f, 'conflict')}
                onOpenFile={f.status === 'D' ? undefined : () => openFileTab(f)}
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
                onClick={() =>
                  void runOp('Unstage All', () => unstageFiles(staged.map((f) => f.path)))
                }
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
                onUnstage={() => void runOp('Unstage', () => unstageFiles([f.path]))}
                onOpenDiff={() => openDiffTab(f, 'staged')}
                onOpenFile={f.status === 'D' ? undefined : () => openFileTab(f)}
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
                onClick={() =>
                  void runOp('Stage All', () => stageFiles(changes.map((f) => f.path)))
                }
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
                onStage={() => void runOp('Stage', () => stageFiles([f.path]))}
                onDiscard={() => void handleDiscardFiles([f])}
                onOpenDiff={f.status !== '?' ? () => openDiffTab(f, 'unstaged') : undefined}
                onOpenFile={f.status === 'D' ? undefined : () => openFileTab(f)}
              />
            ))}
          </FileSection>
        )}
      </div>

      {/* Pull Request Dialog */}
      <PullRequestDialog open={showPrDialog} onClose={() => setShowPrDialog(false)} />
      {showMenu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9990] min-w-[180px] max-h-[calc(100vh-16px)] overflow-auto rounded-lg border border-border bg-background p-1 shadow-xl"
            style={
              menuPosition
                ? { top: menuPosition.top, left: menuPosition.left }
                : { top: 0, left: 0, visibility: 'hidden' }
            }
          >
            {/* Remote */}
            <MenuSection label="Remote">
              <MenuBtn
                icon={Github}
                label="Publish to GitHub…"
                onClick={() => {
                  setShowMenu(false);
                  openPublishDialog();
                }}
              />
              <MenuBtn
                icon={PlusCircle}
                label="Add Remote…"
                onClick={() => void handleAddRemote()}
              />
              {remotes.length > 0 && <MenuDivider />}
              {remotes.map((remote) => (
                <div
                  key={remote.name}
                  className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted transition-colors"
                >
                  <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-[11px] text-foreground">{remote.name}</p>
                    <p className="truncate text-[9px] text-muted-foreground">{remote.url}</p>
                  </div>
                  <button
                    onClick={() => void handleRemoveRemote(remote.name)}
                    title={`Remove remote ${remote.name}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <MenuBtn icon={ArrowUp} label="Push" onClick={handlePush} />
              <MenuBtn icon={ArrowUp} label="Push To…" onClick={handlePushTo} />
              <MenuBtn icon={ArrowDown} label="Pull" onClick={handlePull} />
              <MenuBtn icon={ArrowDown} label="Pull From…" onClick={handlePullFrom} />
              <MenuBtn icon={Download} label="Fetch" onClick={handleFetch} />
              <MenuBtn icon={Download} label="Fetch All" onClick={handleFetchAll} />
              <MenuBtn icon={Download} label="Fetch All & Prune" onClick={handleFetchPrune} />
            </MenuSection>

            <MenuDivider />

            {/* Staging */}
            <MenuSection label="Changes">
              <MenuBtn
                icon={Plus}
                label="Stage All"
                onClick={async () => {
                  await runOp('Stage All', stageAll);
                }}
              />
              <MenuBtn icon={Minus} label="Unstage All" onClick={handleUnstageAll} />
              <MenuBtn icon={RotateCcw} label="Discard All" onClick={handleDiscardAll} />
            </MenuSection>

            <MenuDivider />

            {/* Branch */}
            <MenuSection label="Branch">
              <MenuBtn icon={GitFork} label="Create Branch" onClick={handleCreateBranch} />
              <MenuBtn
                icon={GitBranch}
                label="Checkout Branch"
                onClick={handleCheckoutBranch}
              />
              <MenuBtn icon={Trash2} label="Delete Branch" onClick={handleDeleteBranch} />
              <MenuBtn icon={GitMerge} label="Merge Branch" onClick={handleMerge} />
            </MenuSection>

            <MenuDivider />

            {/* Misc */}
            <MenuSection label="Other">
              <MenuBtn icon={Archive} label="Stash Changes" onClick={handleStash} />
              <MenuBtn
                icon={Archive}
                label="Stash Including Untracked"
                onClick={handleStashIncludingUntracked}
              />
              <MenuBtn icon={Archive} label="Pop Stash" onClick={handlePopStash} />
              <MenuBtn icon={Archive} label="Apply Stash" onClick={handleApplyStash} />
              <MenuBtn icon={Tag} label="Create Tag" onClick={handleCreateTag} />
              <MenuBtn
                icon={History}
                label="View History"
                onClick={() => {
                  setShowMenu(false);
                  setPanelMode('log');
                }}
              />
            </MenuSection>
          </div>,
          document.body,
        )}
      {showAiSettings && (
        <AiCommitModelDialog
          commitAiProviderId={commitAiProviderId}
          commitAiModelId={commitAiModelId}
          enabledModels={enabledModels}
          customModels={customModels}
          onApply={(providerId, modelId) => {
            setSettings('commitAiProviderId', providerId);
            setSettings('commitAiModelId', modelId);
            setShowAiSettings(false);
          }}
          onClose={() => setShowAiSettings(false)}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface AiCommitModelDialogProps {
  commitAiProviderId: string | null;
  commitAiModelId: string | null;
  enabledModels: Record<string, string[]>;
  customModels: Array<{ providerId: string; modelId: string; name: string }>;
  onApply: (providerId: string | null, modelId: string | null) => void;
  onClose: () => void;
}

function AiCommitModelDialog({
  commitAiProviderId,
  commitAiModelId,
  enabledModels,
  customModels,
  onApply,
  onClose,
}: AiCommitModelDialogProps) {
  const [targets, setTargets] = useState<CommitMessageTarget[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingTargets, setIsLoadingTargets] = useState(true);
  const loadTargets = useCallback(async (): Promise<void> => {
    setIsLoadingTargets(true);
    setLoadError(null);
    try {
      setTargets(await listCommitMessageTargets(enabledModels, customModels));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load configured models.');
    } finally {
      setIsLoadingTargets(false);
    }
  }, [customModels, enabledModels]);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  const initialValue =
    commitAiProviderId && commitAiModelId ? `${commitAiProviderId}::${commitAiModelId}` : '';
  const selectedTargetExists = targets.some(
    (target) => `${target.providerId}::${target.modelId}` === initialValue,
  );
  const modelOptions: ModelOption[] = [
    {
      id: '',
      name: 'Use active agent model',
      description: 'Follow the model selected for the current agent session.',
      icon: <Sparkles className="text-primary" />,
    },
    ...(!selectedTargetExists && initialValue
      ? [
          {
            id: initialValue,
            name: commitAiModelId ?? 'Unavailable model',
            description: `${commitAiProviderId ?? 'Unknown provider'} · unavailable`,
            icon: <XCircle className="text-destructive" />,
          },
        ]
      : []),
    ...targets.map((target) => ({
      id: `${target.providerId}::${target.modelId}`,
      name: target.modelName,
      description: `${target.providerName} · ${target.modelId}`,
      icon: <Sparkles />,
    })),
  ];
  const [selectedValue, setSelectedValue] = useState(initialValue);

  const handleSelection = (value: string): void => {
    setSelectedValue(value);
    if (!value) {
      onApply(null, null);
      return;
    }
    const separator = value.indexOf('::');
    if (separator === -1) return;
    onApply(value.slice(0, separator), value.slice(separator + 2));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12 sm:px-5 sm:py-4">
          <DialogTitle className="text-base">AI Commit Message Model</DialogTitle>
          <DialogDescription className="text-xs">
            Choose the model used to generate commit messages.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
          <span className="block text-xs font-medium text-foreground">Model</span>
          <ModelSelector
            models={modelOptions}
            value={selectedValue}
            onValueChange={handleSelection}
            className="min-h-10 w-full min-w-0 justify-between border border-border bg-card px-3 text-left hover:bg-muted sm:min-h-11"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            This selection only affects automatic commit-message generation.
          </p>

          {isLoadingTargets && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading configured models…
            </p>
          )}
          {loadError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <p>{loadError}</p>
              <Button variant="ghost" size="sm" className="mt-1" onClick={() => void loadTargets()}>
                Retry
              </Button>
            </div>
          )}
          {!isLoadingTargets && !loadError && targets.length === 0 && (
            <p className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">
              No configured and enabled models found. Configure providers in Settings → AI.
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-muted/20 px-4 py-3 sm:px-5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function CommitMenuButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center px-3 py-1.5 text-left text-[11px] text-foreground hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
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

// ─── Clone Repository Dialog ─────────────────────────────────────────────────
// Browse GitHub repositories (own / orgs / public search) or paste any git URL,
// pick a destination and open the cloned workspace.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  GitBranch,
  Loader2,
  CheckCircle,
  AlertCircle,
  Search,
  Folder,
  Globe,
  Lock,
  ExternalLink,
} from 'lucide-react';
import { useGithubStore, type GitHubRepo } from '../../stores/github-store';
import { useGitStore } from '../../stores';
import { pickFolder } from '../../lib/tauri-dialog';
import { switchProject } from '../../lib/project-persistence';
import { useProjectStore } from '../../stores/project-store';
import { useFileStore } from '../../stores/file-store';
import { GithubAccountSection } from '../settings/tabs/github-account-section';

interface CloneRepositoryDialogProps {
  open: boolean;
  onClose: () => void;
}

function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\.git$/i, '');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] ?? '';
}

function sanitizeFolderName(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\.+$/g, '');
  return cleaned || 'repository';
}

export function CloneRepositoryDialog({ open, onClose }: CloneRepositoryDialogProps) {
  const authStatus = useGithubStore((s) => s.authStatus);
  const user = useGithubStore((s) => s.user);
  const repos = useGithubStore((s) => s.repos);
  const orgs = useGithubStore((s) => s.orgs);
  const reposLoading = useGithubStore((s) => s.reposLoading);
  const searchResults = useGithubStore((s) => s.searchResults);
  const searchLoading = useGithubStore((s) => s.searchLoading);
  const loadRepos = useGithubStore((s) => s.loadRepos);
  const loadOrgs = useGithubStore((s) => s.loadOrgs);
  const searchRepos = useGithubStore((s) => s.searchRepos);
  const checkAuth = useGithubStore((s) => s.checkAuth);

  const [tab, setTab] = useState<'github' | 'url'>('github');
  const [searchQuery, setSearchQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState('all');
  const [urlInput, setUrlInput] = useState('');
  const [branchInput, setBranchInput] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [parentDir, setParentDir] = useState('');
  const [folderName, setFolderName] = useState('');
  const [status, setStatus] = useState<{
    type: 'idle' | 'cloning' | 'success' | 'error';
    message?: string;
  }>({ type: 'idle' });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTab('github');
    setSearchQuery('');
    setOrgFilter('all');
    setUrlInput('');
    setBranchInput('');
    setSelectedRepo(null);
    setFolderName('');
    setStatus({ type: 'idle' });
    if (authStatus === 'unknown') {
      void checkAuth();
    } else if (authStatus === 'signed-in') {
      void loadRepos();
      void loadOrgs();
    }
    setTimeout(() => urlRef.current?.focus(), 60);
  }, [open, authStatus, checkAuth, loadRepos, loadOrgs]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) {
      void searchRepos('');
      return;
    }
    searchTimer.current = setTimeout(() => {
      void searchRepos(searchQuery);
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery, searchRepos]);

  const visibleRepos = useMemo(() => {
    const filtered =
      orgFilter === 'all'
        ? repos
        : repos.filter((repo) => repo.owner.login === orgFilter);
    return filtered.slice(0, 50);
  }, [repos, orgFilter]);

  const effectiveUrl = selectedRepo?.clone_url ?? urlInput.trim();
  const effectiveName =
    folderName.trim() ||
    (selectedRepo ? selectedRepo.name : repoNameFromUrl(effectiveUrl));

  const chooseRepo = (repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setUrlInput('');
    setFolderName(repo.name);
    setStatus({ type: 'idle' });
  };

  const chooseParent = async () => {
    const path = await pickFolder();
    if (path) setParentDir(path);
  };

  const handleClone = async () => {
    if (!effectiveUrl) return;
    if (!parentDir) {
      setStatus({ type: 'error', message: 'Choose a destination folder first.' });
      return;
    }
    const targetPath = `${parentDir.replace(/[\\/]+$/, '')}/${sanitizeFolderName(effectiveName)}`;
    setStatus({ type: 'cloning' });
    try {
      await useGitStore.getState().cloneRepository(
        effectiveUrl,
        targetPath,
        branchInput.trim() || null,
      );
      setStatus({ type: 'success', message: targetPath });
      await switchProject(null, targetPath);
      useProjectStore.getState().openProject(targetPath);
      await useFileStore.getState().openFolder(targetPath);
      setTimeout(onClose, 250);
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (!open) return null;

  const canClone =
    Boolean(effectiveUrl) &&
    Boolean(parentDir) &&
    status.type !== 'cloning';

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[8vh]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 flex max-h-[82vh] w-full max-w-xl flex-col rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <GitBranch className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] font-semibold text-foreground">Clone Repository</span>
              <span className="text-[10px] text-muted-foreground">
                Public and private repositories
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Tabs */}
          <div className="flex gap-1 rounded-lg border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setTab('github')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                tab === 'github'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Search className="h-3 w-3" />
              GitHub
            </button>
            <button
              type="button"
              onClick={() => setTab('url')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                tab === 'url'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Globe className="h-3 w-3" />
              URL
            </button>
          </div>

          {tab === 'github' ? (
            authStatus !== 'signed-in' ? (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
                <p className="text-[11px] text-muted-foreground">
                  Sign in with GitHub to browse your repositories, organizations and public
                  searches.
                </p>
                <GithubAccountSection />
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Search
                  </label>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setSelectedRepo(null);
                      }}
                      placeholder="Search GitHub repositories…"
                      className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Owner
                  </label>
                  <select
                    value={orgFilter}
                    onChange={(e) => setOrgFilter(e.target.value)}
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40"
                  >
                    <option value="all">{user?.login ?? 'All repositories'}</option>
                    {orgs.map((org) => (
                      <option key={org.login} value={org.login}>
                        {org.login}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Results list */}
                {searchQuery.trim() ? (
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-background">
                    {searchLoading ? (
                      <div className="flex items-center gap-2 p-3 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Searching…
                      </div>
                    ) : searchResults.length === 0 ? (
                      <p className="p-3 text-[11px] text-muted-foreground">No results found.</p>
                    ) : (
                      searchResults.map((repo) => <RepoRow key={repo.id} repo={repo} onPick={chooseRepo} />)
                    )}
                  </div>
                ) : (
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-background">
                    {reposLoading ? (
                      <div className="flex items-center gap-2 p-3 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading repositories…
                      </div>
                    ) : visibleRepos.length === 0 ? (
                      <p className="p-3 text-[11px] text-muted-foreground">
                        No repositories found. Try the search above.
                      </p>
                    ) : (
                      visibleRepos.map((repo) => <RepoRow key={repo.id} repo={repo} onPick={chooseRepo} />)
                    )}
                  </div>
                )}
              </>
            )
          ) : (
            <div className="flex flex-col gap-2">
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Repository URL
                </label>
                <input
                  ref={urlRef}
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    setSelectedRepo(null);
                  }}
                  placeholder="https://github.com/owner/repo.git"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Branch (optional)
                </label>
                <input
                  value={branchInput}
                  onChange={(e) => setBranchInput(e.target.value)}
                  placeholder="main"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
                />
              </div>
            </div>
          )}

          {/* Destination */}
          <div className="rounded-lg border border-border bg-background p-2.5">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Destination Folder
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  value={parentDir}
                  onChange={(e) => setParentDir(e.target.value)}
                  placeholder="Choose where to clone…"
                  className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
                />
                <button
                  type="button"
                  onClick={() => void chooseParent()}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <Folder className="h-3 w-3" />
                  Browse…
                </button>
              </div>
            </div>
            <div className="mt-2">
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Folder Name
              </label>
              <input
                value={effectiveName}
                onChange={(e) => setFolderName(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40"
              />
            </div>
            {parentDir && effectiveName && (
              <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
                Will clone to: {parentDir.replace(/[\\/]+$/, '')}/{sanitizeFolderName(effectiveName)}
              </p>
            )}
          </div>

          {status.type === 'error' && (
            <div className="flex items-start gap-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="break-all">{status.message}</span>
            </div>
          )}
          {status.type === 'success' && (
            <div className="flex items-start gap-1.5 rounded-md border border-success/20 bg-success/5 px-2 py-1.5 text-[11px] text-success">
              <CheckCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="break-all">Repository cloned to {status.message}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleClone()}
            disabled={!canClone}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {status.type === 'cloning' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="h-3.5 w-3.5" />
            )}
            {status.type === 'cloning' ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RepoRow({ repo, onPick }: { repo: GitHubRepo; onPick: (repo: GitHubRepo) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(repo)}
      className="flex w-full items-start gap-2 border-b border-border/50 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/50"
    >
      <div className="mt-0.5 flex flex-col items-center gap-1">
        {repo.private ? (
          <Lock className="h-3 w-3 shrink-0 text-warning" />
        ) : (
          <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-foreground">{repo.full_name}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {repo.description || repo.clone_url}
        </p>
      </div>
      <a
        href={repo.html_url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </button>
  );
}

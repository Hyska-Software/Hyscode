// ─── Publish to GitHub Dialog ────────────────────────────────────────────────
// Create a new GitHub repository (user or organization, public or private) or
// link an existing one, then publish the current branch with upstream.

import { useEffect, useMemo, useState } from 'react';
import {
  X,
  UploadCloud,
  Loader2,
  CheckCircle,
  AlertCircle,
  Lock,
  Globe,
  ExternalLink,
} from 'lucide-react';
import { useGithubStore, type GitHubRepo } from '../../stores/github-store';
import { useGitStore } from '../../stores';
import { useFileStore } from '../../stores/file-store';
import { GithubAccountSection } from '../settings/tabs/github-account-section';

interface PublishRepositoryDialogProps {
  open: boolean;
  onClose: () => void;
}

type PublishMode = 'create' | 'link';

export function PublishRepositoryDialog({ open, onClose }: PublishRepositoryDialogProps) {
  const authStatus = useGithubStore((s) => s.authStatus);
  const user = useGithubStore((s) => s.user);
  const repos = useGithubStore((s) => s.repos);
  const orgs = useGithubStore((s) => s.orgs);
  const reposLoading = useGithubStore((s) => s.reposLoading);
  const loadRepos = useGithubStore((s) => s.loadRepos);
  const loadOrgs = useGithubStore((s) => s.loadOrgs);
  const checkAuth = useGithubStore((s) => s.checkAuth);
  const publishRepository = useGithubStore((s) => s.publishRepository);
  const linkExistingRepository = useGithubStore((s) => s.linkExistingRepository);

  const rootPath = useFileStore((s) => s.rootPath);
  const headState = useGitStore((s) => s.headState);
  const remotes = useGitStore((s) => s.remotes);
  const hasCommits = headState === 'branch';

  const [mode, setMode] = useState<PublishMode>('create');
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [status, setStatus] = useState<{
    type: 'idle' | 'publishing' | 'success' | 'error';
    message?: string;
    url?: string;
  }>({ type: 'idle' });

  useEffect(() => {
    if (!open) return;
    const folderName = (rootPath ?? '').split(/[\\/]/).pop() ?? '';
    setMode('create');
    setOwner(user?.login ?? '');
    setName(folderName.replace(/[^a-zA-Z0-9._-]/g, '-'));
    setDescription('');
    setIsPrivate(true);
    setSelectedRepo(null);
    setStatus({ type: 'idle' });
    if (authStatus === 'unknown') {
      void checkAuth();
    } else if (authStatus === 'signed-in') {
      void loadRepos();
      void loadOrgs();
    }
  }, [open, authStatus, user, rootPath, checkAuth, loadRepos, loadOrgs]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const linkCandidates = useMemo(() => {
    if (!owner) return [];
    return repos.filter((repo) => repo.owner.login === owner);
  }, [repos, owner]);

  const handlePublish = async () => {
    if (!name.trim()) return;
    setStatus({ type: 'publishing' });
    try {
      if (mode === 'create') {
        const repo = await publishRepository({
          name: name.trim(),
          description: description.trim() || null,
          private: isPrivate,
          org: owner !== user?.login ? owner : null,
        });
        setStatus({
          type: 'success',
          message: `Repository ${repo.full_name} published`,
          url: repo.html_url,
        });
      } else {
        if (!selectedRepo) {
          setStatus({ type: 'error', message: 'Select a repository to link.' });
          return;
        }
        await linkExistingRepository(selectedRepo);
        setStatus({
          type: 'success',
          message: `Linked and published to ${selectedRepo.full_name}`,
          url: selectedRepo.html_url,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ type: 'error', message });
    }
  };

  if (!open) return null;

  const canPublish =
    authStatus === 'signed-in' &&
    Boolean(name.trim()) &&
    (mode === 'create' || Boolean(selectedRepo)) &&
    status.type !== 'publishing';

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 flex max-h-[82vh] w-full max-w-md flex-col rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <UploadCloud className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] font-semibold text-foreground">Publish to GitHub</span>
              <span className="text-[10px] text-muted-foreground">
                {rootPath ? rootPath.split(/[\\/]/).pop() : 'No workspace'}
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
          {authStatus !== 'signed-in' ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
              <p className="text-[11px] text-muted-foreground">
                Sign in with GitHub to publish repositories.
              </p>
              <GithubAccountSection />
            </div>
          ) : (
            <>
              {!hasCommits && (
                <div className="flex items-start gap-1.5 rounded-md border border-warning/20 bg-warning/5 px-2 py-1.5 text-[10px] text-warning">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    This repository has no commits yet. Create an initial commit before
                    publishing.
                  </span>
                </div>
              )}

              {/* Mode toggle */}
              <div className="flex gap-1 rounded-lg border border-border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => setMode('create')}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                    mode === 'create'
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Create new
                </button>
                <button
                  type="button"
                  onClick={() => setMode('link')}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                    mode === 'link'
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Link existing
                </button>
              </div>

              {mode === 'create' ? (
                <>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Owner
                    </label>
                    <select
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40"
                    >
                      {user && <option value={user.login}>{user.login}</option>}
                      {orgs.map((org) => (
                        <option key={org.login} value={org.login}>
                          {org.login}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Repository Name
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="my-repository"
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Description (optional)
                    </label>
                    <input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What does this project do?"
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsPrivate(true)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[11px] transition-colors ${
                        isPrivate
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Lock className="h-3 w-3" />
                      Private
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPrivate(false)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[11px] transition-colors ${
                        !isPrivate
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Globe className="h-3 w-3" />
                      Public
                    </button>
                  </div>
                </>
              ) : (
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Existing Repository
                  </label>
                  {reposLoading ? (
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading repositories…
                    </div>
                  ) : (
                    <select
                      value={selectedRepo?.full_name ?? ''}
                      onChange={(e) => {
                        const repo = repos.find((item) => item.full_name === e.target.value);
                        setSelectedRepo(repo ?? null);
                      }}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40"
                    >
                      <option value="">Select a repository…</option>
                      {linkCandidates.map((repo) => (
                        <option key={repo.id} value={repo.full_name}>
                          {repo.full_name}
                          {repo.private ? ' (private)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {selectedRepo && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      The current branch will be pushed to {selectedRepo.clone_url}
                    </p>
                  )}
                </div>
              )}

              {remotes.length > 0 && mode === 'create' && (
                <p className="text-[10px] text-muted-foreground">
                  The <code className="rounded bg-muted px-1 font-mono">origin</code> remote
                  currently points to {remotes.find((remote) => remote.name === 'origin')?.url ?? remotes[0]?.url} and will be updated.
                </p>
              )}

              {status.type === 'error' && (
                <div className="flex items-start gap-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="break-all">{status.message}</span>
                </div>
              )}
              {status.type === 'success' && (
                <div className="flex items-start gap-1.5 rounded-md border border-success/20 bg-success/5 px-2 py-1.5 text-[11px] text-success">
                  <CheckCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="break-all">
                    {status.message}
                    {status.url && (
                      <a
                        href={status.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1 inline-flex items-center gap-0.5 underline underline-offset-2"
                      >
                        Open <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </span>
                </div>
              )}
            </>
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
            onClick={() => void handlePublish()}
            disabled={!canPublish}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {status.type === 'publishing' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UploadCloud className="h-3.5 w-3.5" />
            )}
            {status.type === 'publishing' ? 'Publishing…' : 'Publish Repository'}
          </button>
        </div>
      </div>
    </div>
  );
}

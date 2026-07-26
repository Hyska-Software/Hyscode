import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  GitPullRequest,
  Loader2,
  CheckCircle,
  AlertCircle,
  ArrowLeftRight,
  Eye,
} from 'lucide-react';
import { useGitStore } from '../../stores';

interface PullRequestDialogProps {
  open: boolean;
  onClose: () => void;
}

export function PullRequestDialog({ open, onClose }: PullRequestDialogProps) {
  const branches = useGitStore((s) => s.branches);
  const currentBranch = useGitStore((s) => s.currentBranch);
  const remotes = useGitStore((s) => s.remotes);
  const ahead = useGitStore((s) => s.ahead);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [headBranch, setHeadBranch] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Auto-populate default branches
  useEffect(() => {
    if (!open) return;
    // Default head = current branch
    setHeadBranch(currentBranch);
    // Default base = 'main' or 'master' or first local non-current branch
    const mainLike = branches.find((b) => !b.is_remote && (b.name === 'main' || b.name === 'master'));
    const firstOther = branches.find((b) => !b.is_remote && !b.is_current);
    setBaseBranch(mainLike?.name ?? firstOther?.name ?? '');
    // Auto-title from recent commit or empty
    setTitle('');
    setBody('');
    setResult(null);
    setIsDraft(false);
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [open, currentBranch, branches]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !baseBranch || !headBranch) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const url = await useGitStore.getState().createPullRequest({
        title: title.trim(),
        body: body.trim() || undefined,
        base: baseBranch,
        head: headBranch,
        draft: isDraft,
      });
      setResult({ type: 'success', msg: `Pull request created: ${url}` });
      setTimeout(() => {
        onClose();
        setResult(null);
      }, 2500);
    } catch (err: any) {
      setResult({ type: 'error', msg: err.message ?? String(err) });
    } finally {
      setIsSubmitting(false);
    }
  }, [title, body, baseBranch, headBranch, isDraft, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const localBranches = branches.filter((b) => !b.is_remote);
  const hasRemote = remotes.length > 0;
  const canSubmit = title.trim() && baseBranch && headBranch && hasRemote && !isSubmitting;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <GitPullRequest className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] font-semibold text-foreground">Create Pull Request</span>
              <span className="text-[10px] text-muted-foreground">
                {hasRemote ? `${remotes[0]?.name} → ${remotes[0]?.url}` : 'No remote configured'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Branch selector */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Base Branch
              </label>
              <select
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40"
              >
                <option value="">Select base…</option>
                {localBranches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Head Branch
              </label>
              <select
                value={headBranch}
                onChange={(e) => setHeadBranch(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40"
              >
                <option value="">Select head…</option>
                {localBranches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name} {b.is_current ? '(current)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Arrow indicator */}
          <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
            <span className="truncate max-w-[120px]">{headBranch || '…'}</span>
            <ArrowLeftRight className="h-3 w-3" />
            <span className="truncate max-w-[120px]">{baseBranch || '…'}</span>
          </div>

          {/* Title */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Title
            </label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="PR title…"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
            />
          </div>

          {/* Description */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Description
              </label>
              <button
                onClick={() => setShowPreview((v) => !v)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Eye className="h-2.5 w-2.5" />
                {showPreview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {showPreview ? (
              <div className="min-h-[80px] rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground whitespace-pre-wrap">
                {body || <span className="text-muted-foreground">No description</span>}
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe your changes…"
                rows={4}
                className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
              />
            )}
          </div>

          {/* Draft toggle */}
          <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors">
            <input
              type="checkbox"
              checked={isDraft}
              onChange={(e) => setIsDraft(e.target.checked)}
              className="h-3 w-3 rounded border-border primary-primary"
            />
            <span className="text-[11px] text-foreground">Create as draft</span>
          </label>

          {/* Ahead warning */}
          {ahead === 0 && headBranch === currentBranch && (
            <div className="flex items-center gap-1.5 rounded-md border border-warning/20 bg-warning/5 px-2 py-1.5 text-[10px] text-warning">
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span>Current branch has no commits ahead of base. Push your commits first.</span>
            </div>
          )}

          {/* Result */}
          {result && (
            <div
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] ${
                result.type === 'success'
                  ? 'border-success/20 bg-success/5 text-success'
                  : 'border-destructive/20 bg-destructive/5 text-destructive'
              }`}
            >
              {result.type === 'success' ? (
                <CheckCircle className="h-3 w-3 shrink-0" />
              ) : (
                <AlertCircle className="h-3 w-3 shrink-0" />
              )}
              <span className="break-all">{result.msg}</span>
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
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitPullRequest className="h-3.5 w-3.5" />
            )}
            {isSubmitting ? 'Creating…' : 'Create Pull Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useCallback } from 'react';
import {
  X,
  ArrowUpCircle,
  Download,
  RefreshCw,
  Loader2,
  ArrowRight,
  RotateCcw,
  CheckCircle,
  GitCommitVertical,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { useUpdateStore } from '../../stores/update-store';
import { useEditorStore } from '../../stores/editor-store';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function UpdateDialog() {
  const dialogOpen = useUpdateStore((s) => s.dialogOpen);
  const closeDialog = useUpdateStore((s) => s.closeDialog);
  const status = useUpdateStore((s) => s.status);
  const releaseInfo = useUpdateStore((s) => s.releaseInfo);
  const downloadProgress = useUpdateStore((s) => s.downloadProgress);
  const error = useUpdateStore((s) => s.error);
  const startDownload = useUpdateStore((s) => s.startDownload);
  const installUpdate = useUpdateStore((s) => s.installUpdate);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const openReleaseNotesTab = useEditorStore((s) => s.openReleaseNotesTab);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dialogOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dialogOpen, closeDialog]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) closeDialog();
    },
    [closeDialog],
  );

  if (!dialogOpen || !releaseInfo) return null;

  const hasCommits = releaseInfo.commits && releaseInfo.commits.length > 0;
  const hasBody = !!releaseInfo.body;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Card */}
      <div className="relative z-10 flex max-h-[65vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-card shadow-2xl animate-scale-in">
        {/* ─── Header ──────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface-raised px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <ArrowUpCircle className="h-[18px] w-[18px] text-primary" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
                Update Available
              </h2>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <code className="rounded bg-muted/60 px-1 py-px font-mono">
                  v{releaseInfo.currentVersion}
                </code>
                <ArrowRight className="h-2.5 w-2.5" />
                <code className="rounded bg-primary/10 px-1 py-px font-mono text-primary">
                  {releaseInfo.version}
                </code>
              </div>
            </div>
          </div>
          <button
            onClick={closeDialog}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ─── Body (scrollable) ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {/* Release notes */}
          {hasBody && (
            <div className="px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Release Notes
                </h4>
                <button
                  onClick={() => {
                    openReleaseNotesTab(releaseInfo.version, releaseInfo.body);
                    closeDialog();
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Open in editor"
                >
                  <FileText className="h-3 w-3" />
                  Open in Editor
                </button>
              </div>
              <div className="max-h-[160px] overflow-y-auto rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
                {releaseInfo.body}
              </div>
            </div>
          )}

          {/* Commit history */}
          {hasCommits && (
            <div className={`px-4 py-3 ${hasBody ? 'border-t border-border' : ''}`}>
              <h4 className="mb-2.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                <GitCommitVertical className="h-3 w-3" />
                Commits
                <span className="ml-0.5 rounded-full bg-muted px-1.5 py-px text-[9px] font-normal tracking-normal">
                  {releaseInfo.commits!.length}
                </span>
              </h4>
              <div className="max-h-[180px] overflow-y-auto rounded-md border border-border/60 bg-muted/30">
                {releaseInfo.commits!.map((commit, i) => (
                  <a
                    key={commit.sha}
                    href={commit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group flex items-start gap-2.5 px-3 py-2 transition-colors hover:bg-muted ${
                      i !== 0 ? 'border-t border-border/30' : ''
                    }`}
                  >
                    <code className="mt-0.5 shrink-0 rounded bg-primary/10 px-1 py-px font-mono text-[10px] text-primary">
                      {commit.sha}
                    </code>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-snug text-foreground group-hover:text-primary truncate transition-colors">
                        {commit.message}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {commit.author} &middot; {commit.date}
                      </p>
                    </div>
                    <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── Footer ──────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-border bg-surface-raised px-4 py-3">
          {/* Asset info */}
          <div className="mb-3 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="truncate max-w-[60%]">{releaseInfo.assetName}</span>
            <span className="tabular-nums shrink-0">{formatBytes(releaseInfo.assetSize)}</span>
          </div>

          {/* Progress bar */}
          {(status === 'downloading' || status === 'ready') && downloadProgress && (
            <div className="mb-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(downloadProgress.percent, 100)}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="tabular-nums">
                  {formatBytes(downloadProgress.downloaded)} / {formatBytes(downloadProgress.total)}
                </span>
                <span className="tabular-nums font-medium text-foreground">
                  {Math.round(downloadProgress.percent)}%
                </span>
              </div>
            </div>
          )}

          {/* Error */}
          {status === 'error' && error && (
            <div className="mb-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            {status === 'available' && (
              <button
                onClick={() => void startDownload()}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Download className="h-3.5 w-3.5" />
                Download &amp; Install
              </button>
            )}

            {status === 'downloading' && (
              <button
                disabled
                className="flex items-center gap-1.5 rounded-md bg-primary/60 px-4 py-1.5 text-[11px] font-medium text-primary-foreground cursor-not-allowed"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Downloading...
              </button>
            )}

            {status === 'ready' && (
              <>
                <button
                  onClick={() => void installUpdate()}
                  className="flex items-center gap-1.5 rounded-md bg-success px-4 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-success/90"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Restart &amp; Update
                </button>
                <span className="flex items-center gap-1 text-[10px] text-success">
                  <CheckCircle className="h-3 w-3" />
                  Download complete
                </span>
              </>
            )}

            {status === 'error' && (
              <button
                onClick={() => void checkForUpdates()}
                className="flex items-center gap-1.5 rounded-md bg-muted px-4 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/80"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </button>
            )}

            <button
              onClick={closeDialog}
              className="ml-auto rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {status === 'ready' ? 'Later' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

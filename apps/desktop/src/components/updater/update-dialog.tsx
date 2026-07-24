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
  GitCommit,
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

  // Close on Escape
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

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeDialog} />

      {/* Dialog */}
      <div className="relative z-10 flex max-h-[65vh] w-full max-w-md flex-col rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <ArrowUpCircle className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] font-semibold text-foreground">
                Update Available
              </span>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>v{releaseInfo.currentVersion}</span>
                <ArrowRight className="h-2.5 w-2.5" />
                <span className="text-primary font-medium">{releaseInfo.version}</span>
              </div>
            </div>
          </div>
          <button
            onClick={closeDialog}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Release notes */}
        {releaseInfo.body && (
          <div className="flex-1 overflow-y-auto border-b border-border px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Release Notes
              </h4>
              <button
                onClick={() => {
                  openReleaseNotesTab(releaseInfo.version, releaseInfo.body);
                  closeDialog();
                }}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Open in editor"
              >
                <FileText className="h-3 w-3" />
                Open in Editor
              </button>
            </div>
            <div className="prose-sm text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
              {releaseInfo.body}
            </div>
          </div>
        )}

        {/* Commit history */}
        {releaseInfo.commits && releaseInfo.commits.length > 0 && (
          <div className="flex-1 overflow-y-auto border-b border-border px-4 py-3 max-h-[200px]">
            <h4 className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <GitCommit className="h-3 w-3" />
              Commits ({releaseInfo.commits.length})
            </h4>
            <div className="flex flex-col gap-1.5">
              {releaseInfo.commits.map((commit) => (
                <a
                  key={commit.sha}
                  href={commit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted transition-colors"
                >
                  <span className="mt-0.5 font-mono text-[10px] text-primary shrink-0">
                    {commit.sha}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-foreground leading-snug truncate group-hover:text-primary transition-colors">
                      {commit.message}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {commit.author} · {commit.date}
                    </p>
                  </div>
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Download progress / Actions */}
        <div className="px-4 py-3">
          {/* Download info */}
          <div className="mb-3 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{releaseInfo.assetName}</span>
            <span>{formatBytes(releaseInfo.assetSize)}</span>
          </div>

          {/* Progress bar (visible during download and ready states) */}
          {(status === 'downloading' || status === 'ready') && downloadProgress && (
            <div className="mb-3">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.min(downloadProgress.percent, 100)}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {formatBytes(downloadProgress.downloaded)} / {formatBytes(downloadProgress.total)}
                </span>
                <span className="tabular-nums">{Math.round(downloadProgress.percent)}%</span>
              </div>
            </div>
          )}

          {/* Error message */}
          {status === 'error' && error && (
            <div className="mb-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {status === 'available' && (
              <button
                onClick={() => void startDownload()}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download & Install
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
              <button
                onClick={() => void installUpdate()}
                className="flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-1.5 text-[11px] font-medium text-white hover:bg-success transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Restart & Update
              </button>
            )}

            {status === 'error' && (
              <button
                onClick={() => void checkForUpdates()}
                className="flex items-center gap-1.5 rounded-md bg-muted px-4 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/80 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </button>
            )}

            {status === 'ready' && (
              <span className="flex items-center gap-1 text-[10px] text-success">
                <CheckCircle className="h-3 w-3" />
                Download complete
              </span>
            )}

            <button
              onClick={closeDialog}
              className="ml-auto rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              {status === 'ready' ? 'Later' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { Download, X, RefreshCw, Loader2, ArrowUpCircle, RotateCcw } from 'lucide-react';
import { useUpdateStore } from '../../stores/update-store';

export function UpdateBanner() {
  const status = useUpdateStore((s) => s.status);
  const releaseInfo = useUpdateStore((s) => s.releaseInfo);
  const downloadProgress = useUpdateStore((s) => s.downloadProgress);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const error = useUpdateStore((s) => s.error);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const openDialog = useUpdateStore((s) => s.openDialog);
  const startDownload = useUpdateStore((s) => s.startDownload);
  const installUpdate = useUpdateStore((s) => s.installUpdate);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);

  // Don't show banner in these states
  if (dismissed) return null;
  if (status === 'idle' || status === 'checking' || status === 'up-to-date') return null;

  return (
    <div className="relative flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
      {/* Update available */}
      {status === 'available' && releaseInfo && (
        <>
          <ArrowUpCircle className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] text-foreground">
            <span className="font-medium">HysCode {releaseInfo.version}</span> is available
          </span>
          <button
            onClick={() => {
              openDialog();
              void startDownload();
            }}
            className="ml-1 rounded-md bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Download className="mr-1 inline-block h-3 w-3" />
            Install
          </button>
          <button
            onClick={() => openDialog()}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Release notes
          </button>
        </>
      )}

      {/* Downloading */}
      {status === 'downloading' && downloadProgress && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-[11px] text-foreground">
            Downloading update...
          </span>
          <div className="flex items-center gap-2 ml-1">
            <div className="h-1.5 w-32 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.min(downloadProgress.percent, 100)}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {Math.round(downloadProgress.percent)}%
            </span>
          </div>
        </>
      )}

      {/* Ready to install */}
      {status === 'ready' && (
        <>
          <ArrowUpCircle className="h-3.5 w-3.5 text-success" />
          <span className="text-[11px] text-foreground">
            Update downloaded — restart to finish installing
          </span>
          <button
            onClick={() => void installUpdate()}
            className="ml-1 rounded-md bg-green-600 px-2.5 py-0.5 text-[10px] font-medium text-white hover:bg-success transition-colors"
          >
            <RefreshCw className="mr-1 inline-block h-3 w-3" />
            Restart Now
          </button>
        </>
      )}

      {/* Error */}
      {status === 'error' && (
        <>
          <X className="h-3.5 w-3.5 text-destructive" />
          <span className="text-[11px] text-destructive truncate max-w-xs">
            Update failed: {error}
          </span>
          <button
            onClick={() => void checkForUpdates()}
            className="ml-1 rounded-md bg-muted px-2.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted/80 transition-colors"
          >
            <RotateCcw className="mr-1 inline-block h-3 w-3" />
            Retry
          </button>
        </>
      )}

      {/* Dismiss button */}
      <button
        onClick={dismiss}
        className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

import { Download, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { useUpdateStore } from '../../stores/update-store';

export function UpdateIndicator() {
  const status = useUpdateStore((s) => s.status);
  const downloadProgress = useUpdateStore((s) => s.downloadProgress);
  const error = useUpdateStore((s) => s.error);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const openDialog = useUpdateStore((s) => s.openDialog);
  const startDownload = useUpdateStore((s) => s.startDownload);
  const installUpdate = useUpdateStore((s) => s.installUpdate);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);

  if (dismissed) return null;
  if (status === 'idle' || status === 'up-to-date') return null;

  const handleClick = () => {
    switch (status) {
      case 'checking':
        return;
      case 'available':
        openDialog();
        void startDownload();
        break;
      case 'downloading':
        openDialog();
        break;
      case 'ready':
        void installUpdate();
        break;
      case 'error':
        dismiss();
        void checkForUpdates();
        break;
    }
  };

  return (
    <button
      onClick={handleClick}
      title={
        status === 'checking'
          ? 'Checking for updates...'
          : status === 'available'
            ? 'Update available — click to download'
            : status === 'downloading'
              ? `Downloading — ${Math.round(downloadProgress?.percent ?? 0)}%`
              : status === 'ready'
                ? 'Downloaded — click to restart & install'
                : status === 'error'
                  ? `Update failed: ${error}`
                  : ''
      }
      className="relative flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/15"
    >
      {status === 'checking' && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}
      {status === 'available' && (
        <Download className="h-4 w-4 text-primary" />
      )}
      {status === 'downloading' && (
        <div className="relative flex h-4 w-4 items-center justify-center">
          <Loader2 className="absolute h-4 w-4 animate-spin text-primary opacity-70" />
          <span className="text-[9px] font-medium tabular-nums text-primary">
            {Math.round(downloadProgress?.percent ?? 0)}
          </span>
        </div>
      )}
      {status === 'ready' && (
        <RefreshCw className="h-4 w-4 text-success" />
      )}
      {status === 'error' && (
        <AlertTriangle className="h-4 w-4 text-amber-400" />
      )}
    </button>
  );
}

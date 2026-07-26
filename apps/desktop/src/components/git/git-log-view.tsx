import { useEffect, useState, useCallback } from 'react';
import { GitCommit, Clock, User, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useGitStore } from '../../stores';
import { CommitDetailModal } from './commit-detail-modal';

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

interface GitLogViewProps {
  onClose?: () => void;
}

export function GitLogView({ onClose }: GitLogViewProps) {
  const log = useGitStore((s) => s.log);
  const fetchLog = useGitStore((s) => s.fetchLog);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    fetchLog(limit)
      .catch((reason: unknown) => {
        setLoadError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setLoading(false));
  }, [fetchLog, limit]);

  const handleCloseModal = useCallback(() => setSelectedHash(null), []);
  const handleRetry = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetchLog(limit)
      .catch((reason: unknown) => {
        setLoadError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setLoading(false));
  }, [fetchLog, limit]);

  if (loading && log.length === 0) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center py-8 text-center text-muted-foreground">
        {onClose && (
          <button onClick={onClose} className="absolute right-2 top-2 text-[10px] hover:text-foreground">
            Close
          </button>
        )}
        <Loader2 className="mb-2 h-5 w-5 animate-spin opacity-60" />
        <p className="text-[11px]">Loading history…</p>
      </div>
    );
  }

  if (log.length === 0) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center px-4 py-8 text-center text-muted-foreground">
        {onClose && (
          <button onClick={onClose} className="absolute right-2 top-2 text-[10px] hover:text-foreground">
            Close
          </button>
        )}
        <GitCommit className="mb-2 h-6 w-6 opacity-30" />
        <p className={`text-[11px] ${loadError ? 'text-destructive' : ''}`}>
          {loadError ?? 'No commits yet'}
        </p>
        {loadError && (
          <button
            onClick={handleRetry}
            className="mt-2 flex items-center gap-1 rounded bg-muted px-2 py-1 text-[10px] text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            Try Again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[11px] font-medium text-foreground">Commit History</span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Close
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {loadError && (
          <div className="flex items-center justify-between border-b border-border bg-destructive/5 px-2 py-1 text-[10px] text-destructive">
            <span className="truncate">{loadError}</span>
            <button onClick={handleRetry} className="ml-2 shrink-0 underline">
              Retry
            </button>
          </div>
        )}
        {log.map((commit) => (
          <button
            key={commit.hash}
            onClick={() => setSelectedHash(commit.hash)}
            className="w-full border-b border-border/50 px-2 py-1.5 text-left hover:bg-surface-raised transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 font-mono text-[10px] text-primary">
                {commit.short_hash}
              </span>
              <span className="truncate text-[11px] text-foreground">
                {commit.message.split('\n')[0]}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <User className="h-2.5 w-2.5" />
                {commit.author}
              </span>
              <span className="flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {formatRelativeTime(commit.timestamp)}
              </span>
              <span className="flex items-center gap-0.5 ml-auto text-muted-foreground/70">
                <FileText className="h-2.5 w-2.5" />
                {commit.email}
              </span>
            </div>
          </button>
        ))}
        {log.length >= limit && (
          <div className="border-t border-border p-2 text-center">
            <button
              onClick={() => setLimit((current) => current + 100)}
              disabled={loading}
              className="rounded-md bg-muted px-3 py-1 text-[10px] text-foreground hover:bg-surface-raised disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Load More'}
            </button>
          </div>
        )}
      </div>

      {selectedHash && (
        <CommitDetailModal hash={selectedHash} onClose={handleCloseModal} />
      )}
    </div>
  );
}

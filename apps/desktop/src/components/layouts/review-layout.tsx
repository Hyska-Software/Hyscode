import { useEffect, useCallback } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import {
  CheckCheck,
  Download,
  RotateCcw,
  FileCheck2,
} from 'lucide-react';
import { ReviewFileList } from '../review/review-file-list';
import { ReviewDiffPanel } from '../review/review-diff-panel';
import { ReviewCommentsPanel } from '../review/review-comments-panel';
import { useReviewStore } from '@/stores/review-store';
import { cn } from '@/lib/utils';

function ReviewHeader() {
  const summary = useReviewStore((s) => s.summary);
  const files = useReviewStore((s) => s.files);
  const markAllReviewed = useReviewStore((s) => s.markAllReviewed);
  const reset = useReviewStore((s) => s.reset);
  const exportReview = useReviewStore((s) => s.exportReview);
  const loadFiles = useReviewStore((s) => s.loadFiles);

  const progress = summary.totalFiles > 0
    ? Math.round((summary.reviewedFiles / summary.totalFiles) * 100)
    : 0;

  const handleExport = useCallback(() => {
    const markdown = exportReview();
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'review-report.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [exportReview]);

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-surface px-3 py-1.5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <FileCheck2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold text-foreground">Review</span>
        </div>

        {/* Progress bar */}
        <div className="hidden sm:flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                progress === 100 ? 'bg-green-400' : 'bg-accent',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {summary.reviewedFiles}/{summary.totalFiles}
          </span>
        </div>

        {/* Diff stats */}
        {summary.totalAdditions + summary.totalDeletions > 0 && (
          <div className="hidden md:flex items-center gap-1.5 text-[10px]">
            <span className="text-green-400">+{summary.totalAdditions}</span>
            <span className="text-red-400">-{summary.totalDeletions}</span>
          </div>
        )}

        {/* Score */}
        {summary.score !== null && (
          <span
            className={cn(
              'text-[10px] font-bold tabular-nums',
              summary.score >= 80 ? 'text-green-400'
                : summary.score >= 50 ? 'text-amber-400'
                : 'text-red-400',
            )}
          >
            {summary.score}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => loadFiles()}
          className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Refresh files"
        >
          <RotateCcw className="h-3 w-3" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
        {files.length > 0 && (
          <button
            onClick={markAllReviewed}
            className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Mark all reviewed"
          >
            <CheckCheck className="h-3 w-3" />
            <span className="hidden sm:inline">Mark all</span>
          </button>
        )}
        <button
          onClick={handleExport}
          className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Export review report"
        >
          <Download className="h-3 w-3" />
          <span className="hidden sm:inline">Export</span>
        </button>
        <button
          onClick={reset}
          className="flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Reset review"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function ReviewLayout() {
  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        useReviewStore.getState().loadFiles();
      }
      if (e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        const markdown = useReviewStore.getState().exportReview();
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'review-report.md';
        a.click();
        URL.revokeObjectURL(url);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <ReviewHeader />
      <PanelGroup direction="horizontal" className="flex-1 w-full">
        {/* Left: File list */}
        <Panel defaultSize={18} minSize={14} maxSize={30}>
          <div className="h-full overflow-hidden">
            <ReviewFileList />
          </div>
        </Panel>

        <PanelResizeHandle className="w-1.5 bg-border/20 hover:bg-accent/30 transition-colors" />

        {/* Center: Diff viewer */}
        <Panel defaultSize={54} minSize={35}>
          <div className="h-full overflow-hidden">
            <ReviewDiffPanel />
          </div>
        </Panel>

        <PanelResizeHandle className="w-1.5 bg-border/20 hover:bg-accent/30 transition-colors" />

        {/* Right: Score + Comments */}
        <Panel defaultSize={28} minSize={22} maxSize={40}>
          <div className="h-full overflow-hidden">
            <ReviewCommentsPanel />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

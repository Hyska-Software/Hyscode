// ─── Inline unified diff viewer ─────────────────────────────────────────────
// Renders a Git-style unified diff: hunks of added/removed lines separated by
// collapsed "N unmodified lines" headers. Uses the app design tokens so it
// adapts to the current theme.

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { computeDiffHunks } from '@/lib/compute-diff';
import type { DiffHunk } from '@/stores/agent-store';

interface DiffViewerProps {
  original: string;
  modified: string;
  hunks?: DiffHunk[];
  className?: string;
}

interface DiffRow {
  oldLine: number | null;
  newLine: number | null;
  text: string;
  type: 'deleted' | 'added' | 'context';
}

interface DiffHunkView {
  collapsedBefore: number;
  rows: DiffRow[];
}

function buildHunkViews(original: string, modified: string, hunks: DiffHunk[]): DiffHunkView[] {
  const oldLines = original.split('\n');
  const newLines = modified.split('\n');
  const views: DiffHunkView[] = [];

  let prevOldEnd = 0;

  for (const hunk of hunks) {
    const collapsedBefore = Math.max(0, hunk.oldStart - prevOldEnd - 1);
    const rows: DiffRow[] = [];

    if (hunk.type === 'add') {
      for (let i = 0; i < hunk.newLines; i++) {
        rows.push({
          oldLine: null,
          newLine: hunk.newStart + i,
          text: newLines[hunk.newStart + i - 1] ?? '',
          type: 'added',
        });
      }
    } else if (hunk.type === 'delete') {
      for (let i = 0; i < hunk.oldLines; i++) {
        rows.push({
          oldLine: hunk.oldStart + i,
          newLine: null,
          text: oldLines[hunk.oldStart + i - 1] ?? '',
          type: 'deleted',
        });
      }
    } else {
      // 'modify' — render removed old lines then added new lines. This matches
      // the block style shown in the reference image.
      for (let i = 0; i < hunk.oldLines; i++) {
        rows.push({
          oldLine: hunk.oldStart + i,
          newLine: null,
          text: oldLines[hunk.oldStart + i - 1] ?? '',
          type: 'deleted',
        });
      }
      for (let i = 0; i < hunk.newLines; i++) {
        rows.push({
          oldLine: null,
          newLine: hunk.newStart + i,
          text: newLines[hunk.newStart + i - 1] ?? '',
          type: 'added',
        });
      }
    }

    views.push({ collapsedBefore, rows });
    prevOldEnd = hunk.oldStart + hunk.oldLines - 1;
  }

  return views;
}

function LineNumber({ value }: { value: number | null }) {
  return (
    <span className="select-none px-2 py-0.5 text-right text-[10px] tabular-nums text-muted-foreground/60">
      {value ?? ''}
    </span>
  );
}

function DiffLine({ row }: { row: DiffRow }) {
  const bgClass =
    row.type === 'deleted'
      ? 'bg-red-500/10'
      : row.type === 'added'
        ? 'bg-green-500/10'
        : 'transparent';
  const marker = row.type === 'deleted' ? '-' : row.type === 'added' ? '+' : ' ';

  return (
    <div
      className={cn(
        'grid grid-cols-[2.5rem_2.5rem_1fr] items-start transition-colors duration-150 hover:bg-accent/5',
        bgClass,
      )}
    >
      <LineNumber value={row.oldLine} />
      <LineNumber value={row.newLine} />
      <span
        className={cn(
          'px-2 py-0.5 whitespace-pre',
          row.type === 'deleted'
            ? 'text-red-400'
            : row.type === 'added'
              ? 'text-green-400'
              : 'text-foreground',
        )}
      >
        <span className="select-none text-muted-foreground/40">{marker}</span>
        {row.text}
      </span>
    </div>
  );
}

export function DiffViewer({ original, modified, hunks, className }: DiffViewerProps) {
  const computedHunks = useMemo(
    () => hunks ?? computeDiffHunks(original, modified),
    [hunks, original, modified],
  );

  const views = useMemo(
    () => buildHunkViews(original, modified, computedHunks),
    [original, modified, computedHunks],
  );

  if (views.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center text-[10px] text-muted-foreground',
          className,
        )}
      >
        No changes
      </div>
    );
  }

  return (
    <div
      className={cn(
        'h-full overflow-auto bg-surface font-mono text-[12px] leading-relaxed animate-in fade-in slide-in-from-top-1 duration-300',
        className,
      )}
    >
      {views.map((view, index) => (
        <div key={index}>
          {view.collapsedBefore > 0 && (
            <div className="sticky top-0 z-10 border-y border-border/30 bg-surface-raised px-3 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/30">
              {view.collapsedBefore} unmodified {view.collapsedBefore === 1 ? 'line' : 'lines'}
            </div>
          )}
          {view.rows.map((row, rowIndex) => (
            <DiffLine key={`${index}-${rowIndex}`} row={row} />
          ))}
        </div>
      ))}
    </div>
  );
}

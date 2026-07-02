// ─── Lightweight text diff for agent edit sessions ──────────────────────────
// Computes hunks from originalContent → newContent without depending on Git.
// Uses a simple LCS-based line diff suitable for decoration rendering.

import type { DiffHunk } from '@/stores/agent-store';

interface DiffOp {
  type: 'equal' | 'insert' | 'delete';
  oldIdx: number;
  newIdx: number;
  count: number;
}

/**
 * Compute diff hunks between two texts (line-level).
 * Returns hunks suitable for Monaco gutter/minimap decorations.
 */
export function computeDiffHunks(original: string | null, modified: string): DiffHunk[] {
  // New file: entire content is an addition
  if (original === null || original === '') {
    const lines = modified.split('\n');
    if (lines.length === 0) return [];
    return [
      {
        type: 'add',
        newStart: 1,
        newLines: lines.length,
        oldStart: 0,
        oldLines: 0,
      },
    ];
  }

  const oldLines = original.split('\n');
  const newLines = modified.split('\n');

  const ops = computeLineOps(oldLines, newLines);
  return opsToHunks(ops);
}

export function countDiffLines(hunks: DiffHunk[]): { added: number; removed: number } {
  return hunks.reduce(
    (total, hunk) => ({
      added: total.added + hunk.newLines,
      removed: total.removed + hunk.oldLines,
    }),
    { added: 0, removed: 0 },
  );
}

/**
 * Myers-like diff producing a list of equal/insert/delete operations.
 * For files up to ~5000 lines this is fast enough on the UI thread.
 */
function computeLineOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const oldLen = oldLines.length;
  const newLen = newLines.length;

  // Optimisation: handle trivial cases
  if (oldLen === 0) {
    return newLen > 0 ? [{ type: 'insert', oldIdx: 0, newIdx: 0, count: newLen }] : [];
  }
  if (newLen === 0) {
    return [{ type: 'delete', oldIdx: 0, newIdx: 0, count: oldLen }];
  }

  // Build LCS table (space-optimised would be nicer, but correctness first)
  // For very large files, fall back to a simpler approach
  if (oldLen * newLen > 2_000_000) {
    return simpleDiff(oldLines, newLines);
  }

  // Standard LCS
  const dp: number[][] = Array.from({ length: oldLen + 1 }, () => new Array(newLen + 1).fill(0));

  for (let i = 1; i <= oldLen; i++) {
    for (let j = 1; j <= newLen; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce ops
  const ops: DiffOp[] = [];
  let i = oldLen;
  let j = newLen;

  // Collect raw actions in reverse
  const rawOps: Array<{ type: 'equal' | 'insert' | 'delete'; oldIdx: number; newIdx: number }> = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      rawOps.push({ type: 'equal', oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawOps.push({ type: 'insert', oldIdx: i, newIdx: j - 1 });
      j--;
    } else {
      rawOps.push({ type: 'delete', oldIdx: i - 1, newIdx: j });
      i--;
    }
  }

  rawOps.reverse();

  // Merge consecutive same-type ops
  for (const raw of rawOps) {
    const last = ops[ops.length - 1];
    if (last && last.type === raw.type) {
      last.count++;
    } else {
      ops.push({ type: raw.type, oldIdx: raw.oldIdx, newIdx: raw.newIdx, count: 1 });
    }
  }

  return ops;
}

/**
 * Simple fallback diff for very large files — compare line by line,
 * treating consecutive differences as a single modify block.
 */
function simpleDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  let i = 0;
  while (i < maxLen) {
    if (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) {
      const start = i;
      while (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) {
        i++;
      }
      ops.push({ type: 'equal', oldIdx: start, newIdx: start, count: i - start });
    } else {
      // Find the end of the differing block
      const startI = i;
      // Advance both until they re-sync (simple heuristic)
      let oldEnd = i;
      let newEnd = i;
      while (oldEnd < oldLines.length || newEnd < newLines.length) {
        if (
          oldEnd < oldLines.length &&
          newEnd < newLines.length &&
          oldLines[oldEnd] === newLines[newEnd]
        ) {
          break;
        }
        if (oldEnd < oldLines.length) oldEnd++;
        if (newEnd < newLines.length) newEnd++;
      }
      const deletedCount = oldEnd - startI;
      const insertedCount = newEnd - startI;
      if (deletedCount > 0) {
        ops.push({ type: 'delete', oldIdx: startI, newIdx: startI, count: deletedCount });
      }
      if (insertedCount > 0) {
        ops.push({ type: 'insert', oldIdx: oldEnd, newIdx: startI, count: insertedCount });
      }
      i = Math.max(oldEnd, newEnd);
    }
  }

  return ops;
}

/**
 * Convert DiffOps into DiffHunks suitable for decoration.
 */
function opsToHunks(ops: DiffOp[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let oldLine = 1; // 1-based
  let newLine = 1; // 1-based

  for (const op of ops) {
    switch (op.type) {
      case 'equal':
        oldLine += op.count;
        newLine += op.count;
        break;

      case 'delete':
        hunks.push({
          type: 'delete',
          oldStart: oldLine,
          oldLines: op.count,
          newStart: newLine,
          newLines: 0,
        });
        oldLine += op.count;
        break;

      case 'insert':
        hunks.push({
          type: 'add',
          oldStart: oldLine,
          oldLines: 0,
          newStart: newLine,
          newLines: op.count,
        });
        newLine += op.count;
        break;
    }
  }

  // Merge adjacent delete+insert into modify
  const merged: DiffHunk[] = [];
  for (let i = 0; i < hunks.length; i++) {
    const current = hunks[i];
    const next = hunks[i + 1];

    if (current.type === 'delete' && next?.type === 'add' && next.newStart === current.newStart) {
      merged.push({
        type: 'modify',
        oldStart: current.oldStart,
        oldLines: current.oldLines,
        newStart: next.newStart,
        newLines: next.newLines,
      });
      i++; // skip next
    } else {
      merged.push(current);
    }
  }

  return merged;
}

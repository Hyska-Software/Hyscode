import { resolveWorkspacePath } from './path-policy';
import type { MiddlewareContext, PostToolHook } from './middleware';
import type { ToolCallRecord } from './types';

const DEFAULT_DUPLICATE_READ_LIMIT = 3;

type ReadSpan = {
  start: number;
  end: number;
};

type ReadLoopEntry = {
  span: ReadSpan;
  count: number;
};

/**
 * Detects repeated or overlapping successful reads without treating separate
 * line ranges in a large file as a loop.
 */
export class ReadLoopMiddleware implements PostToolHook {
  readonly name = 'read_loop';
  private readonly workspacePath: string;
  private readonly duplicateReadLimit: number;
  private readonly entries = new Map<string, ReadLoopEntry[]>();
  private readonly warned = new Set<string>();

  constructor(workspacePath: string, duplicateReadLimit = DEFAULT_DUPLICATE_READ_LIMIT) {
    this.workspacePath = workspacePath;
    this.duplicateReadLimit = duplicateReadLimit;
  }

  reset(): void {
    this.entries.clear();
    this.warned.clear();
  }

  afterTool(toolName: string, record: ToolCallRecord, _ctx: MiddlewareContext): string | null {
    if (!record.output.success) return null;
    if (toolName === 'read_file') {
      return this.observePath(record.input);
    }
    if (toolName === 'read_multiple_files') {
      const successfulPaths = record.output.metadata?.successfulPaths;
      if (Array.isArray(successfulPaths)) {
        for (const path of successfulPaths) {
          const warning = this.observePath({ paths: [path] });
          if (warning) return warning;
        }
        return null;
      }
      const paths = Array.isArray(record.input.paths) ? record.input.paths : [];
      for (const path of new Set(paths.map((value) => String(value)))) {
        const warning = this.observePath({ paths: [path] });
        if (warning) return warning;
      }
    }
    return null;
  }

  private observePath(input: Record<string, unknown>): string | null {
    const rawPath = Array.isArray(input.paths) ? String(input.paths[0] ?? '') : String(input.path ?? '');
    if (!rawPath) return null;

    const path = this.canonicalize(rawPath);
    const span = this.readSpan(input);
    const entries = this.entries.get(path) ?? [];
    const existing = entries.find((entry) => rangesOverlap(entry.span, span));

    if (existing) {
      existing.count += 1;
      if (existing.count >= this.duplicateReadLimit && !this.warned.has(path)) {
        this.warned.add(path);
        return (
          `[Read-loop warning] You have repeatedly read the same or overlapping range of ` +
          `"${path}". Reuse the content already available in context, use gather_context ` +
          `if the full file must persist, or request a narrower missing range.`
        );
      }
      return null;
    }

    entries.push({ span, count: 1 });
    this.entries.set(path, entries);
    return null;
  }

  private canonicalize(path: string): string {
    try {
      return resolveWorkspacePath(path, this.workspacePath).replace(/\\/g, '/').toLowerCase();
    } catch {
      return path.replace(/\\/g, '/').toLowerCase();
    }
  }

  private readSpan(input: Record<string, unknown>): ReadSpan {
    const start = Math.max(1, Number(input.start_line) || 1);
    const endLine = Number(input.end_line);
    const limit = Number(input.limit);
    if (Number.isFinite(limit) && limit > 0) {
      return { start, end: start + limit - 1 };
    }
    if (Number.isFinite(endLine) && endLine >= start) {
      return { start, end: endLine };
    }
    return { start, end: Number.POSITIVE_INFINITY };
  }
}

function rangesOverlap(left: ReadSpan, right: ReadSpan): boolean {
  return left.start <= right.end && right.start <= left.end;
}

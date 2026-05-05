import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  User,
  Clock,
  FileText,
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
  GitCommit,
  Copy,
} from 'lucide-react';
import { useGitStore } from '../../stores';
import type { CommitDetail, CommitFileChange } from '../../stores/git-store';

// ── Diff line parser (shared logic) ─────────────────────────────────────────

interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk';
  content: string;
  oldNum?: number;
  newNum?: number;
}

function parseDiff(raw: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldNum = parseInt(match[1], 10);
        newNum = parseInt(match[2], 10);
      }
      lines.push({ type: 'hunk', content: line });
    } else if (line.startsWith('+')) {
      lines.push({ type: 'add', content: line.slice(1), newNum });
      newNum++;
    } else if (line.startsWith('-')) {
      lines.push({ type: 'del', content: line.slice(1), oldNum });
      oldNum++;
    } else if (line.startsWith(' ')) {
      lines.push({ type: 'ctx', content: line.slice(1), oldNum, newNum });
      oldNum++;
      newNum++;
    }
  }

  return lines;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  M: 'text-yellow-400',
  A: 'text-green-400',
  D: 'text-red-400',
  R: 'text-blue-400',
  C: 'text-blue-400',
  T: 'text-purple-400',
};

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

function formatFullDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

// ── CommitTab ─────────────────────────────────────────────────────────────────

interface CommitTabProps {
  hash: string;
}

export function CommitTab({ hash }: CommitTabProps) {
  const getCommitDetail = useGitStore((s) => s.getCommitDetail);
  const getCommitFileDiff = useGitStore((s) => s.getCommitFileDiff);

  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [fileDiffs, setFileDiffs] = useState<Record<string, string>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setDetail(null);
    setFileDiffs({});
    setExpandedFile(null);
    getCommitDetail(hash)
      .then((d) => setDetail(d))
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
  }, [hash, getCommitDetail]);

  const toggleFile = useCallback(
    async (filePath: string) => {
      if (expandedFile === filePath) {
        setExpandedFile(null);
        return;
      }
      setExpandedFile(filePath);

      if (fileDiffs[filePath]) return;

      setLoadingDiff(filePath);
      try {
        const diff = await getCommitFileDiff(hash, filePath);
        setFileDiffs((prev) => ({ ...prev, [filePath]: diff }));
      } catch {
        setFileDiffs((prev) => ({ ...prev, [filePath]: '(Failed to load diff)' }));
      } finally {
        setLoadingDiff(null);
      }
    },
    [expandedFile, fileDiffs, hash, getCommitFileDiff],
  );

  const copyHash = useCallback(() => {
    if (detail) navigator.clipboard.writeText(detail.hash);
  }, [detail]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-red-400">
        {error}
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-start gap-3 min-w-0">
          <GitCommit className="h-5 w-5 text-accent mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground leading-snug whitespace-pre-wrap mb-2">
              {detail.message}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
              <button
                onClick={copyHash}
                className="flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-accent hover:bg-accent/20 transition-colors"
                title="Copy full hash"
              >
                {detail.short_hash}
                <Copy className="h-2.5 w-2.5" />
              </button>
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {detail.author} &lt;{detail.email}&gt;
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatFullDate(detail.timestamp)} ({formatRelativeTime(detail.timestamp)})
              </span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-[10px] shrink-0 ml-4 mt-0.5">
          <span className="flex items-center gap-1 text-muted-foreground">
            <FileText className="h-3 w-3" />
            {detail.files.length} file{detail.files.length !== 1 ? 's' : ''}
          </span>
          {detail.total_insertions > 0 && (
            <span className="flex items-center gap-0.5 text-green-400">
              <Plus className="h-3 w-3" />{detail.total_insertions}
            </span>
          )}
          {detail.total_deletions > 0 && (
            <span className="flex items-center gap-0.5 text-red-400">
              <Minus className="h-3 w-3" />{detail.total_deletions}
            </span>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {detail.files.map((file) => (
          <FileChangeRow
            key={file.path}
            file={file}
            isExpanded={expandedFile === file.path}
            isLoadingDiff={loadingDiff === file.path}
            diffContent={fileDiffs[file.path] ?? null}
            onToggle={() => toggleFile(file.path)}
          />
        ))}
      </div>
    </div>
  );
}

// ── File Change Row ──────────────────────────────────────────────────────────

function FileChangeRow({
  file,
  isExpanded,
  isLoadingDiff,
  diffContent,
  onToggle,
}: {
  file: CommitFileChange;
  isExpanded: boolean;
  isLoadingDiff: boolean;
  diffContent: string | null;
  onToggle: () => void;
}) {
  const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
  const dirPath = file.path.includes('/')
    ? file.path.substring(0, file.path.lastIndexOf('/'))
    : '';

  const statusColor = STATUS_COLORS[file.status] ?? 'text-muted-foreground';
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div className="border-b border-border/30">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-6 py-1.5 text-left hover:bg-surface-raised transition-colors"
      >
        <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className={`shrink-0 font-mono text-[10px] font-medium ${statusColor}`}>
          {file.status}
        </span>
        <span className="truncate text-[11px] text-foreground">{fileName}</span>
        {dirPath && (
          <span className="truncate text-[10px] text-muted-foreground/60">{dirPath}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5 shrink-0 text-[10px]">
          {file.insertions > 0 && <span className="text-green-400">+{file.insertions}</span>}
          {file.deletions > 0 && <span className="text-red-400">-{file.deletions}</span>}
        </span>
      </button>

      {isExpanded && (
        <div className="bg-muted/30">
          {isLoadingDiff && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {diffContent != null && !isLoadingDiff && (
            <div className="overflow-x-auto">
              <DiffView content={diffContent} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline Diff Viewer ───────────────────────────────────────────────────────

function DiffView({ content }: { content: string }) {
  const lines = parseDiff(content);

  if (lines.length === 0) {
    return (
      <div className="px-6 py-3 text-[10px] text-muted-foreground">No diff available</div>
    );
  }

  return (
    <table className="w-full text-[10px] font-mono leading-[18px]">
      <tbody>
        {lines.map((line, i) => {
          if (line.type === 'hunk') {
            return (
              <tr key={i} className="bg-accent/5">
                <td colSpan={3} className="px-2 py-0.5 text-accent/70 select-none">
                  {line.content}
                </td>
              </tr>
            );
          }

          const bg =
            line.type === 'add'
              ? 'bg-green-500/8'
              : line.type === 'del'
                ? 'bg-red-500/8'
                : '';

          const textColor =
            line.type === 'add'
              ? 'text-green-300'
              : line.type === 'del'
                ? 'text-red-300'
                : 'text-foreground/70';

          return (
            <tr key={i} className={bg}>
              <td className="w-[40px] select-none px-1 text-right text-muted-foreground/40">
                {line.oldNum ?? ''}
              </td>
              <td className="w-[40px] select-none px-1 text-right text-muted-foreground/40">
                {line.newNum ?? ''}
              </td>
              <td className={`px-2 whitespace-pre ${textColor}`}>
                <span className="select-none opacity-50">
                  {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                </span>
                {line.content}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

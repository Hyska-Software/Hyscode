import { useMemo, useState, useRef } from 'react';
import {
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Lightbulb,
  Filter,
  ChevronDown,
  BarChart3,
  Plus,
  X,
  Send,
  Trash2,
  FileCode2,
  ChevronRight,
} from 'lucide-react';
import { useReviewStore } from '@/stores/review-store';
import { cn } from '@/lib/utils';
import type { ReviewComment, ReviewSeverity } from '@/stores/review-store';

// ─── Severity config ────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<ReviewSeverity, { label: string; icon: React.ElementType; color: string; bg: string; border: string }> = {
  p0: { label: 'Critical', icon: AlertOctagon, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/25' },
  p1: { label: 'Important', icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/25' },
  p2: { label: 'Suggestion', icon: Lightbulb, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/25' },
};

type FilterMode = 'all' | 'p0' | 'p1' | 'p2' | 'unresolved';

const CATEGORIES = ['bug', 'style', 'performance', 'security', 'logic', 'readability', 'other'] as const;

// ─── Score Card ─────────────────────────────────────────────────────────────

function ScoreCard() {
  const summary = useReviewStore((s) => s.summary);

  const scoreColor =
    summary.score === null ? 'text-muted-foreground'
    : summary.score >= 80 ? 'text-green-400'
    : summary.score >= 50 ? 'text-amber-400'
    : 'text-red-400';

  const scoreBg =
    summary.score === null ? 'bg-muted'
    : summary.score >= 80 ? 'bg-green-500/10'
    : summary.score >= 50 ? 'bg-amber-500/10'
    : 'bg-red-500/10';

  return (
    <div className="border-b border-border/30 px-3 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold text-foreground">Review Summary</span>
        </div>
        {summary.score !== null && (
          <div className={cn('flex items-center justify-center h-7 w-7 rounded-full', scoreBg)}>
            <span className={cn('text-sm font-bold tabular-nums', scoreColor)}>
              {summary.score}
            </span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Stat label="Files" value={`${summary.reviewedFiles}/${summary.totalFiles}`} />
        <Stat label="Open comments" value={summary.totalComments} />
        <Stat label="Critical" value={summary.bySeverity.p0} color="text-red-400" />
        <Stat label="Important" value={summary.bySeverity.p1} color="text-amber-400" />
        <Stat label="Suggestion" value={summary.bySeverity.p2} color="text-blue-400" />
        {(summary.totalAdditions > 0 || summary.totalDeletions > 0) && (
          <>
            <Stat label="Additions" value={`+${summary.totalAdditions}`} color="text-green-400" />
            <Stat label="Deletions" value={`-${summary.totalDeletions}`} color="text-red-400" />
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[9px] text-muted-foreground">{label}</span>
      <span className={cn('text-[10px] font-semibold tabular-nums', color ?? 'text-foreground')}>{value}</span>
    </div>
  );
}

// ─── Comment Item ───────────────────────────────────────────────────────────

function CommentItem({ comment }: { comment: ReviewComment }) {
  const { label, icon: Icon, color } = SEVERITY_CONFIG[comment.severity];
  const resolveComment = useReviewStore((s) => s.resolveComment);
  const unresolveComment = useReviewStore((s) => s.unresolveComment);
  const deleteComment = useReviewStore((s) => s.deleteComment);
  const setSelectedFile = useReviewStore((s) => s.setSelectedFile);

  const fileName = comment.filePath.split(/[\\/]/).pop() ?? comment.filePath;

  return (
    <div className={cn(
      'border-b border-border/20 px-3 py-2 transition-opacity',
      comment.resolved && 'opacity-40',
    )}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn('h-3 w-3 shrink-0', color)} />
        <span className={cn('text-[9px] font-bold uppercase', color)}>{label}</span>
        <span className="text-[9px] text-muted-foreground">{comment.category}</span>
        <div className="flex-1" />
        <button
          onClick={() => comment.resolved ? unresolveComment(comment.id) : resolveComment(comment.id)}
          className={cn(
            'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors',
            comment.resolved
              ? 'text-green-400 hover:bg-green-500/15'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <CheckCircle2 className="h-2.5 w-2.5" />
          {comment.resolved ? 'Resolved' : 'Resolve'}
        </button>
        <button
          onClick={() => deleteComment(comment.id)}
          className="flex items-center justify-center rounded px-1 py-0.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Delete"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-foreground/80 mb-1">{comment.message}</p>
      {comment.suggestion && (
        <div className="rounded bg-surface-raised/60 px-2 py-1.5 mb-1">
          <span className="text-[9px] font-medium text-muted-foreground">Fix: </span>
          <span className="text-[10px] text-foreground/70">{comment.suggestion}</span>
        </div>
      )}
      <button
        onClick={() => setSelectedFile(comment.filePath)}
        className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <FileCode2 className="h-2.5 w-2.5" />
        {fileName}:{comment.line}
      </button>
    </div>
  );
}

// ─── Comment Group by File ──────────────────────────────────────────────────

function FileCommentGroup({
  filePath,
  comments,
}: {
  filePath: string;
  comments: ReviewComment[];
}) {
  const [expanded, setExpanded] = useState(true);
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const unresolvedCount = comments.filter((c) => !c.resolved).length;

  return (
    <div className="border-b border-border/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <span className="truncate text-[10px] font-medium text-foreground">{fileName}</span>
        {unresolvedCount > 0 && (
          <span className="text-[9px] text-muted-foreground tabular-nums">{unresolvedCount} open</span>
        )}
      </button>
      {expanded && comments.map((c) => <CommentItem key={c.id} comment={c} />)}
    </div>
  );
}

// ─── Add Comment Form ───────────────────────────────────────────────────────

function AddCommentForm({ onClose }: { onClose: () => void }) {
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const addComment = useReviewStore((s) => s.addComment);
  const [line, setLine] = useState('');
  const [severity, setSeverity] = useState<ReviewSeverity>('p1');
  const [category, setCategory] = useState<string>('bug');
  const [message, setMessage] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const msgRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!message.trim() || !selectedFile) return;
    addComment({
      filePath: selectedFile,
      line: parseInt(line, 10) || 1,
      severity,
      category,
      message: message.trim(),
      suggestion: suggestion.trim() || undefined,
      resolved: false,
    });
    setMessage('');
    setSuggestion('');
    setLine('');
    onClose();
  };

  if (!selectedFile) {
    return (
      <div className="border-b border-border/30 px-3 py-3 text-center">
        <span className="text-[10px] text-muted-foreground">Select a file first</span>
      </div>
    );
  }

  const fileName = selectedFile.split(/[\\/]/).pop() ?? selectedFile;

  return (
    <div className="border-b border-border/30 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-foreground">New Comment</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="text-[9px] text-muted-foreground truncate">{fileName}</div>

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          placeholder="Line"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          className="w-14 rounded bg-surface-raised border border-border/40 px-1.5 py-1 text-[10px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent/50"
        />
        <div className="flex items-center gap-0.5 rounded bg-surface-raised p-0.5">
          {(['p0', 'p1', 'p2'] as ReviewSeverity[]).map((s) => {
            const cfg = SEVERITY_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors',
                  severity === s ? cn(cfg.bg, cfg.color) : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded bg-surface-raised border border-border/40 px-1.5 py-1 text-[9px] text-foreground focus:outline-none focus:border-accent/50"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <textarea
        ref={msgRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Describe the issue..."
        rows={2}
        className="w-full resize-none rounded bg-surface-raised border border-border/40 px-2 py-1.5 text-[10px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent/50 leading-relaxed"
        onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleSubmit(); }}
      />

      <input
        value={suggestion}
        onChange={(e) => setSuggestion(e.target.value)}
        placeholder="Suggestion (optional)"
        className="w-full rounded bg-surface-raised border border-border/40 px-2 py-1.5 text-[10px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent/50"
      />

      <button
        onClick={handleSubmit}
        disabled={!message.trim()}
        className="flex w-full items-center justify-center gap-1.5 rounded bg-accent/15 px-3 py-1.5 text-[10px] font-medium text-accent hover:bg-accent/25 disabled:opacity-30 transition-colors"
      >
        <Send className="h-3 w-3" />
        Add Comment
      </button>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ReviewCommentsPanel() {
  const comments = useReviewStore((s) => s.comments);
  const files = useReviewStore((s) => s.files);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [showFilter, setShowFilter] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [groupByFile, setGroupByFile] = useState(true);

  const filtered = useMemo(() => {
    let list = [...comments];
    if (filter === 'unresolved') list = list.filter((c) => !c.resolved);
    else if (filter === 'p0' || filter === 'p1' || filter === 'p2') list = list.filter((c) => c.severity === filter);
    return list.sort((a, b) => {
      const sev = { p0: 0, p1: 1, p2: 2 };
      if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
      return a.line - b.line;
    });
  }, [comments, filter]);

  const grouped = useMemo(() => {
    if (!groupByFile) return null;
    const map = new Map<string, ReviewComment[]>();
    for (const c of filtered) {
      const list = map.get(c.filePath) ?? [];
      list.push(c);
      map.set(c.filePath, list);
    }
    // Sort files by review order
    const fileOrder = new Map(files.map((f, i) => [f.path, i]));
    return Array.from(map.entries()).sort((a, b) => {
      const ai = fileOrder.get(a[0]) ?? Infinity;
      const bi = fileOrder.get(b[0]) ?? Infinity;
      return ai - bi;
    });
  }, [filtered, groupByFile, files]);

  return (
    <div className="flex h-full flex-col bg-surface rounded-lg">
      <ScoreCard />

      {/* Add comment form */}
      {showForm && <AddCommentForm onClose={() => setShowForm(false)} />}

      {/* Filter bar */}
      <div className="flex items-center gap-2 border-b border-border/30 px-3 py-1.5">
        <MessageSquare className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-medium text-foreground flex-1">
          Comments ({filtered.length})
        </span>
        <button
          onClick={() => setGroupByFile(!groupByFile)}
          className={cn(
            'hidden sm:flex items-center justify-center rounded h-5 px-1.5 text-[9px] font-medium transition-colors',
            groupByFile
              ? 'bg-accent/10 text-accent'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
          title="Group by file"
        >
          Group
        </button>
        <button
          onClick={() => setShowForm(!showForm)}
          className={cn(
            'flex items-center justify-center rounded h-5 w-5 transition-colors',
            showForm
              ? 'bg-accent/15 text-accent'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
          title="Add comment"
        >
          <Plus className="h-3 w-3" />
        </button>
        <button
          onClick={() => setShowFilter(!showFilter)}
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Filter className="h-2.5 w-2.5" />
          {filter === 'all' ? 'All' : filter === 'unresolved' ? 'Open' : filter.toUpperCase()}
          <ChevronDown className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* Filter dropdown */}
      {showFilter && (
        <div className="border-b border-border/30 px-3 py-1 flex flex-wrap gap-1">
          {(['all', 'unresolved', 'p0', 'p1', 'p2'] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setShowFilter(false); }}
              className={cn(
                'rounded px-2 py-0.5 text-[9px] font-medium transition-colors',
                filter === f ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {f === 'all' ? 'All' : f === 'unresolved' ? 'Open' : f.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="mb-2 h-6 w-6 opacity-20" />
            <span className="text-[10px]">
              {comments.length === 0 ? 'No comments yet' : 'No matching comments'}
            </span>
          </div>
        ) : groupByFile && grouped ? (
          grouped.map(([filePath, fileComments]) => (
            <FileCommentGroup key={filePath} filePath={filePath} comments={fileComments} />
          ))
        ) : (
          filtered.map((c) => <CommentItem key={c.id} comment={c} />)
        )}
      </div>
    </div>
  );
}

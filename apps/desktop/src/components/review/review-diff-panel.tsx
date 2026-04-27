import { Suspense, lazy, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Loader2,
  CheckCircle2,
  FileCode2,
  ChevronLeft,
  ChevronRight,
  SplitSquareHorizontal,
  Plus,
  X,
  Send,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { useReviewStore } from '@/stores/review-store';
import { useGitStore } from '@/stores/git-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStore } from '@/stores/editor-store';
import { defineAllMonacoThemes, getMonacoThemeName } from '@/lib/monaco-themes';
import { cn } from '@/lib/utils';
import type { ReviewComment, ReviewSeverity } from '@/stores/review-store';

const MonacoDiffEditor = lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.DiffEditor })),
);

// ─── Language detection ─────────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact',
  js: 'javascript', jsx: 'javascriptreact',
  json: 'json', md: 'markdown', css: 'css', html: 'html',
  rs: 'rust', py: 'python', toml: 'toml', yaml: 'yaml',
  yml: 'yaml', sql: 'sql', sh: 'shell',
};

function detectLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] || 'plaintext';
}

// ─── Severity config ────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<ReviewSeverity, { label: string; color: string; bg: string; border: string }> = {
  p0: { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/25' },
  p1: { label: 'Important', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/25' },
  p2: { label: 'Suggestion', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/25' },
};

const CATEGORIES = ['bug', 'style', 'performance', 'security', 'logic', 'readability', 'other'] as const;

// ─── Inline Comment Form ─────────────────────────────────────────────────────

interface InlineFormProps {
  line: number;
  top: number;
  filePath: string;
  onClose: () => void;
}

function InlineCommentForm({ line, top, filePath, onClose }: InlineFormProps) {
  const addComment = useReviewStore((s) => s.addComment);
  const [message, setMessage] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [severity, setSeverity] = useState<ReviewSeverity>('p1');
  const [category, setCategory] = useState<string>('bug');
  const msgRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    msgRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!message.trim()) return;
    addComment({
      filePath,
      line,
      severity,
      category,
      message: message.trim(),
      suggestion: suggestion.trim() || undefined,
      resolved: false,
    });
    onClose();
  };

  return (
    <div
      style={{ position: 'absolute', left: 8, right: 8, top: top + 22, zIndex: 50 }}
      className="rounded-lg border border-border/50 bg-surface shadow-xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-border/30 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <Plus className="h-3 w-3 text-accent" />
          <span className="text-[10px] font-semibold text-foreground">Comment on line {line}</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="p-2.5 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-0.5 rounded bg-surface-raised p-0.5">
            {(['p0', 'p1', 'p2'] as ReviewSeverity[]).map((s) => {
              const cfg = SEVERITY_CONFIG[s];
              return (
                <button
                  key={s}
                  onClick={() => setSeverity(s)}
                  className={cn(
                    'rounded px-2 py-0.5 text-[9px] font-bold uppercase transition-colors',
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
            className="rounded bg-surface-raised border border-border/40 px-1.5 py-0.5 text-[9px] text-foreground focus:outline-none focus:border-accent/50"
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) handleSubmit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Describe the issue… (Ctrl+Enter to submit)"
          rows={2}
          className="w-full resize-none rounded bg-surface-raised border border-border/40 px-2 py-1.5 text-[10px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent/50 leading-relaxed"
        />

        <input
          value={suggestion}
          onChange={(e) => setSuggestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
          placeholder="Suggestion / fix (optional)"
          className="w-full rounded bg-surface-raised border border-border/40 px-2 py-1 text-[10px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent/50"
        />

        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={onClose}
            className="rounded px-2.5 py-1 text-[9px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!message.trim()}
            className="flex items-center gap-1 rounded bg-accent/15 px-2.5 py-1 text-[9px] font-medium text-accent hover:bg-accent/25 disabled:opacity-30 transition-colors"
          >
            <Send className="h-2.5 w-2.5" />
            Add Comment
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Comment Gutter Item ────────────────────────────────────────────────────

function CommentGutterItem({ comment }: { comment: ReviewComment }) {
  const { label, color, bg, border } = SEVERITY_CONFIG[comment.severity];
  const resolveComment = useReviewStore((s) => s.resolveComment);
  const unresolveComment = useReviewStore((s) => s.unresolveComment);
  const deleteComment = useReviewStore((s) => s.deleteComment);

  return (
    <div className={cn(
      'rounded-md border px-2.5 py-2 transition-opacity',
      comment.resolved ? 'opacity-50' : '',
      bg,
      border,
    )}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className={cn('text-[9px] font-bold uppercase', color)}>{label}</span>
          <span className="text-[9px] text-muted-foreground">{comment.category}</span>
          <span className="text-[9px] text-muted-foreground/50">L{comment.line}{comment.endLine ? `-${comment.endLine}` : ''}</span>
        </div>
        <div className="flex items-center gap-0.5">
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
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-foreground/80">{comment.message}</p>
      {comment.suggestion && (
        <div className="mt-1.5 rounded bg-surface-raised/60 px-2 py-1.5">
          <span className="text-[9px] font-medium text-muted-foreground">Suggestion: </span>
          <span className="text-[10px] text-foreground/70">{comment.suggestion}</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ReviewDiffPanel() {
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const files = useReviewStore((s) => s.files);
  const comments = useReviewStore((s) => s.comments);
  const markFileReviewed = useReviewStore((s) => s.markFileReviewed);
  const setSelectedFile = useReviewStore((s) => s.setSelectedFile);
  const getFileContent = useGitStore((s) => s.getFileContent);
  const themeId = useSettingsStore((s) => s.themeId);
  const openTab = useEditorStore((s) => s.openTab);
  const monacoTheme = getMonacoThemeName(themeId);

  const [original, setOriginal] = useState('');
  const [modified, setModified] = useState('');
  const [loading, setLoading] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const hoverClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [hoverTop, setHoverTop] = useState(0);

  const [formLine, setFormLine] = useState<number | null>(null);
  const [formTop, setFormTop] = useState(0);

  const handleEditorMount = useCallback((editor: any) => {
    const mod = editor.getModifiedEditor();

    mod.onMouseMove((e: any) => {
      if (hoverClearTimer.current) {
        clearTimeout(hoverClearTimer.current);
        hoverClearTimer.current = null;
      }
      const line = e.target?.position?.lineNumber;
      if (!line) return;
      const pos = mod.getScrolledVisiblePosition({ lineNumber: line, column: 1 });
      if (pos) {
        setHoverLine(line);
        setHoverTop(pos.top);
      }
    });

    mod.onMouseLeave(() => {
      hoverClearTimer.current = setTimeout(() => setHoverLine(null), 250);
    });
  }, []);

  const openForm = useCallback((line: number, top: number) => {
    setFormLine(line);
    setFormTop(top);
    setHoverLine(null);
  }, []);

  const closeForm = useCallback(() => setFormLine(null), []);

  const fileComments = useMemo(
    () => comments.filter((c) => c.filePath === selectedFile).sort((a, b) => a.line - b.line),
    [comments, selectedFile],
  );

  const currentIndex = files.findIndex((f) => f.path === selectedFile);
  const currentFile = files[currentIndex] ?? null;

  useEffect(() => {
    setFormLine(null);
    setHoverLine(null);
  }, [selectedFile]);

  useEffect(() => {
    if (!selectedFile) {
      setOriginal('');
      setModified('');
      return;
    }

    let cancelled = false;
    setLoading(true);

    getFileContent(selectedFile)
      .then((content) => {
        if (!cancelled) {
          setOriginal(content.original);
          setModified(content.modified);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOriginal('');
          setModified('// Error loading file');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedFile, getFileContent]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentIndex > 0) setSelectedFile(files[currentIndex - 1].path);
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        if (currentIndex < files.length - 1) setSelectedFile(files[currentIndex + 1].path);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentIndex, files, setSelectedFile]);

  const goToPrev = () => {
    if (currentIndex > 0) {
      setSelectedFile(files[currentIndex - 1].path);
    }
  };

  const goToNext = () => {
    if (currentIndex < files.length - 1) {
      setSelectedFile(files[currentIndex + 1].path);
    }
  };

  const handleCopyPath = () => {
    if (selectedFile) navigator.clipboard.writeText(selectedFile);
  };

  const handleOpenInEditor = () => {
    if (!selectedFile) return;
    const fileName = selectedFile.split(/[\\/]/).pop() ?? selectedFile;
    openTab({
      id: selectedFile,
      fileName,
      filePath: selectedFile,
      language: detectLang(selectedFile),
    });
  };

  if (!selectedFile || !currentFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <FileCode2 className="mb-3 h-8 w-8 opacity-20" />
        <span className="text-[11px]">Select a file to review</span>
      </div>
    );
  }

  const fileName = selectedFile.split(/[\\/]/).pop() ?? selectedFile;

  return (
    <div className="flex h-full flex-col bg-surface rounded-lg">
      {/* File header bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-1.5">
        <div className="flex items-center gap-0.5">
          <button
            onClick={goToPrev}
            disabled={currentIndex <= 0}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={goToNext}
            disabled={currentIndex >= files.length - 1}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <FileCode2 className="h-3 w-3 text-muted-foreground" />
        <span className="truncate text-[11px] font-medium text-foreground">{fileName}</span>
        <span className="text-[9px] text-muted-foreground uppercase">{detectLang(selectedFile)}</span>

        {/* File diff stats */}
        {(currentFile.additions > 0 || currentFile.deletions > 0) && (
          <span className="hidden sm:flex items-center gap-1 text-[9px] tabular-nums">
            {currentFile.additions > 0 && <span className="text-green-400">+{currentFile.additions}</span>}
            {currentFile.deletions > 0 && <span className="text-red-400">-{currentFile.deletions}</span>}
          </span>
        )}

        <span className="text-[9px] text-muted-foreground tabular-nums">
          {currentIndex + 1}/{files.length}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleCopyPath}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Copy path"
          >
            <Copy className="h-3 w-3" />
          </button>
          <button
            onClick={handleOpenInEditor}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Open in editor"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            onClick={() => setSideBySide(!sideBySide)}
            className={cn(
              'flex h-5 items-center gap-1 rounded px-1.5 text-[9px] font-medium transition-colors',
              sideBySide
                ? 'bg-accent/10 text-accent'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            title={sideBySide ? 'Inline diff' : 'Side by side'}
          >
            <SplitSquareHorizontal className="h-3 w-3" />
          </button>
          <button
            onClick={() => markFileReviewed(selectedFile)}
            className={cn(
              'flex h-5 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors',
              currentFile.reviewed
                ? 'bg-green-500/15 text-green-400'
                : 'text-muted-foreground hover:bg-green-500/10 hover:text-green-400',
            )}
          >
            <CheckCircle2 className="h-3 w-3" />
            {currentFile.reviewed ? 'Reviewed' : 'Mark reviewed'}
          </button>
        </div>
      </div>

      {/* Main area: editor + comments gutter */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor */}
        <div ref={editorContainerRef} className="relative flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Suspense fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            }>
            <MonacoDiffEditor
              original={original}
              modified={modified}
              language={detectLang(selectedFile)}
              theme={monacoTheme}
              beforeMount={defineAllMonacoThemes}
              onMount={handleEditorMount}
              className="h-full w-full"
              options={{
                fontFamily: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace",
                fontSize: 13,
                lineHeight: 1.6,
                readOnly: true,
                renderSideBySide: sideBySide,
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                minimap: { enabled: false },
                padding: { top: 8 },
                overviewRulerLanes: 0,
                overviewRulerBorder: false,
              }}
            />
            </Suspense>
          )}

          {/* Gutter + button */}
          {hoverLine !== null && formLine === null && (
            <button
              style={{ position: 'absolute', top: hoverTop, left: 4, zIndex: 40 }}
              className="flex h-5 w-5 items-center justify-center rounded bg-accent/80 text-white shadow-md hover:bg-accent transition-colors"
              onMouseEnter={() => {
                if (hoverClearTimer.current) {
                  clearTimeout(hoverClearTimer.current);
                  hoverClearTimer.current = null;
                }
              }}
              onMouseLeave={() => {
                hoverClearTimer.current = setTimeout(() => setHoverLine(null), 150);
              }}
              onClick={() => openForm(hoverLine, hoverTop)}
              title={`Add comment on line ${hoverLine}`}
            >
              <Plus className="h-3 w-3" />
            </button>
          )}

          {formLine !== null && selectedFile && (
            <InlineCommentForm
              line={formLine}
              top={formTop}
              filePath={selectedFile}
              onClose={closeForm}
            />
          )}
        </div>

        {/* Comments gutter */}
        {fileComments.length > 0 && (
          <div className="hidden lg:flex w-72 flex-col border-l border-border/20 bg-surface">
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border/20 px-3 py-1.5">
              <span className="text-[10px] font-medium text-foreground">Comments</span>
              <span className="text-[9px] text-muted-foreground tabular-nums">{fileComments.length}</span>
            </div>
            <div className="flex-1 overflow-auto space-y-1 p-2">
              {fileComments.map((c) => (
                <CommentGutterItem key={c.id} comment={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useFileStore } from './file-store';
import { useGitStore } from './git-store';
import type { GitFile } from './git-store';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ReviewSeverity = 'p0' | 'p1' | 'p2';
export type ReviewSource = 'working' | 'branch';
export type ReviewStatus = 'idle' | 'loading' | 'reviewing' | 'done' | 'error';

export interface ReviewComment {
  id: string;
  filePath: string;
  line: number;
  endLine?: number;
  severity: ReviewSeverity;
  category: string;
  message: string;
  suggestion?: string;
  resolved: boolean;
  createdAt: number;
}

export interface ReviewFileEntry {
  path: string;
  status: string;
  commentCount: number;
  reviewed: boolean;
  additions: number;
  deletions: number;
}

export interface ReviewSummary {
  totalFiles: number;
  reviewedFiles: number;
  totalComments: number;
  bySeverity: Record<ReviewSeverity, number>;
  score: number | null;
  totalAdditions: number;
  totalDeletions: number;
}

export interface ReviewThread {
  id: string;
  comments: ReviewComment[];
}

// ─── Persistence helpers ────────────────────────────────────────────────────

const STORAGE_KEY = 'hyscode:review:data';

interface PersistedReviewData {
  comments: ReviewComment[];
  reviewedFiles: string[];
  version: number;
}

function loadPersistedData(projectPath: string | null): PersistedReviewData | null {
  if (!projectPath) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, PersistedReviewData>;
    return all[projectPath] ?? null;
  } catch {
    return null;
  }
}

function savePersistedData(projectPath: string, data: PersistedReviewData) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, PersistedReviewData>) : {};
    all[projectPath] = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

function clearPersistedData(projectPath: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const all = JSON.parse(raw) as Record<string, PersistedReviewData>;
    delete all[projectPath];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface ReviewState {
  // Source
  source: ReviewSource;
  targetBranch: string;

  // Status
  status: ReviewStatus;
  error: string | null;

  // Files under review
  files: ReviewFileEntry[];
  selectedFile: string | null;

  // Comments
  comments: ReviewComment[];

  // Summary
  summary: ReviewSummary;

  // Actions
  setSource: (source: ReviewSource) => void;
  setTargetBranch: (branch: string) => void;
  setSelectedFile: (path: string | null) => void;
  loadFiles: () => Promise<void>;
  setStatus: (status: ReviewStatus) => void;
  setError: (error: string | null) => void;

  // Comment actions
  addComment: (comment: Omit<ReviewComment, 'id' | 'createdAt'>) => string;
  addComments: (comments: Omit<ReviewComment, 'id' | 'createdAt'>[]) => void;
  resolveComment: (id: string) => void;
  unresolveComment: (id: string) => void;
  deleteComment: (id: string) => void;
  clearComments: () => void;

  // File review tracking
  markFileReviewed: (path: string) => void;
  unmarkFileReviewed: (path: string) => void;
  markAllReviewed: () => void;

  // Summary
  recalcSummary: () => void;

  // Export
  exportReview: () => string;

  // Reset
  reset: () => void;
}

function getRootPath(): string | null {
  return useFileStore.getState().rootPath;
}

const EMPTY_SUMMARY: ReviewSummary = {
  totalFiles: 0,
  reviewedFiles: 0,
  totalComments: 0,
  bySeverity: { p0: 0, p1: 0, p2: 0 },
  score: null,
  totalAdditions: 0,
  totalDeletions: 0,
};

export const useReviewStore = create<ReviewState>()(
  immer((set, get) => ({
    source: 'working',
    targetBranch: 'main',
    status: 'idle',
    error: null,
    files: [],
    selectedFile: null,
    comments: [],
    summary: { ...EMPTY_SUMMARY },

    setSource: (source) => set((s) => { s.source = source; }),
    setTargetBranch: (branch) => set((s) => { s.targetBranch = branch; }),
    setSelectedFile: (path) => set((s) => { s.selectedFile = path; }),
    setStatus: (status) => set((s) => { s.status = status; }),
    setError: (error) => set((s) => { s.error = error; }),

    loadFiles: async () => {
      const rootPath = getRootPath();
      if (!rootPath) return;

      set((s) => { s.status = 'loading'; s.error = null; });

      try {
        // Refresh git state first
        await useGitStore.getState().refresh();
        const gitState = useGitStore.getState();

        const source = get().source;
        let gitFiles: GitFile[];

        if (source === 'working') {
          // Combine staged + unstaged + untracked
          gitFiles = [...gitState.staged, ...gitState.unstaged, ...gitState.untracked];
        } else {
          // For branch diff we use staged + unstaged (TODO: proper branch compare)
          gitFiles = [...gitState.staged, ...gitState.unstaged, ...gitState.untracked];
        }

        // Deduplicate by path
        const seen = new Set<string>();
        const unique: GitFile[] = [];
        for (const f of gitFiles) {
          if (!seen.has(f.path)) {
            seen.add(f.path);
            unique.push(f);
          }
        }

        // Load persisted reviewed flags
        const persisted = loadPersistedData(rootPath);
        const persistedReviewed = new Set(persisted?.reviewedFiles ?? []);

        // Preserve comment counts from existing comments or persisted
        const prevComments = get().comments.length > 0 ? get().comments : (persisted?.comments ?? []);

        // Fetch diff stats for each file
        const entries: ReviewFileEntry[] = await Promise.all(
          unique.map(async (f) => {
            const commentCount = prevComments.filter((c) => c.filePath === f.path).length;
            let additions = 0;
            let deletions = 0;
            try {
              const diffText = await useGitStore.getState().getDiff(f.path, false);
              // Parse unified diff for +/- counts (naive but fast)
              for (const line of diffText.split('\n')) {
                if (line.startsWith('+') && !line.startsWith('+++')) additions++;
                else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
              }
            } catch {
              // ignore
            }
            return {
              path: f.path,
              status: f.status,
              commentCount,
              reviewed: persistedReviewed.has(f.path),
              additions,
              deletions,
            };
          }),
        );

        set((s) => {
          s.files = entries;
          s.status = 'idle';
          s.selectedFile = entries[0]?.path ?? null;
          s.comments = prevComments;
        });

        get().recalcSummary();
      } catch (err: any) {
        set((s) => {
          s.status = 'error';
          s.error = err.message ?? String(err);
        });
      }
    },

    addComment: (comment) => {
      const id = crypto.randomUUID();
      const full: ReviewComment = { ...comment, id, createdAt: Date.now() };
      set((s) => {
        s.comments.push(full);
        const file = s.files.find((f) => f.path === full.filePath);
        if (file) file.commentCount++;
      });
      get().recalcSummary();
      _persistState();
      return id;
    },

    addComments: (comments) => {
      set((s) => {
        for (const c of comments) {
          const full: ReviewComment = { ...c, id: crypto.randomUUID(), createdAt: Date.now() };
          s.comments.push(full);
          const file = s.files.find((f) => f.path === full.filePath);
          if (file) file.commentCount++;
        }
      });
      get().recalcSummary();
      _persistState();
    },

    resolveComment: (id) => {
      set((s) => {
        const c = s.comments.find((c) => c.id === id);
        if (c) c.resolved = true;
      });
      get().recalcSummary();
      _persistState();
    },

    unresolveComment: (id) => {
      set((s) => {
        const c = s.comments.find((c) => c.id === id);
        if (c) c.resolved = false;
      });
      get().recalcSummary();
      _persistState();
    },

    deleteComment: (id) => {
      set((s) => {
        const idx = s.comments.findIndex((c) => c.id === id);
        if (idx === -1) return;
        const c = s.comments[idx];
        s.comments.splice(idx, 1);
        const file = s.files.find((f) => f.path === c.filePath);
        if (file) file.commentCount = Math.max(0, file.commentCount - 1);
      });
      get().recalcSummary();
      _persistState();
    },

    clearComments: () => {
      set((s) => {
        s.comments = [];
        for (const f of s.files) f.commentCount = 0;
      });
      get().recalcSummary();
      _persistState();
    },

    markFileReviewed: (path) => {
      set((s) => {
        const file = s.files.find((f) => f.path === path);
        if (file) file.reviewed = true;
      });
      get().recalcSummary();
      _persistState();
    },

    unmarkFileReviewed: (path) => {
      set((s) => {
        const file = s.files.find((f) => f.path === path);
        if (file) file.reviewed = false;
      });
      get().recalcSummary();
      _persistState();
    },

    markAllReviewed: () => {
      set((s) => {
        for (const f of s.files) f.reviewed = true;
      });
      get().recalcSummary();
      _persistState();
    },

    recalcSummary: () => {
      const { files, comments } = get();
      const bySeverity: Record<ReviewSeverity, number> = { p0: 0, p1: 0, p2: 0 };
      for (const c of comments) {
        if (!c.resolved) bySeverity[c.severity]++;
      }

      const unresolvedCount = comments.filter((c) => !c.resolved).length;
      const totalFiles = files.length;
      const reviewedFiles = files.filter((f) => f.reviewed).length;
      const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
      const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

      // Score: 100 - (P0*25 + P1*8 + P2*1), clamped 0-100
      // Bonus: +5 if all files reviewed
      let score: number | null = null;
      if (comments.length > 0 || totalFiles > 0) {
        score = Math.max(0, Math.min(100, 100 - (bySeverity.p0 * 25 + bySeverity.p1 * 8 + bySeverity.p2 * 1)));
        if (reviewedFiles === totalFiles && totalFiles > 0) score = Math.min(100, score + 5);
      }

      set((s) => {
        s.summary = {
          totalFiles,
          reviewedFiles,
          totalComments: unresolvedCount,
          bySeverity,
          score,
          totalAdditions,
          totalDeletions,
        };
      });
    },

    exportReview: () => {
      const { comments, summary } = get();
      const lines: string[] = [];
      lines.push('# Code Review Report');
      lines.push('');
      lines.push(`**Files reviewed:** ${summary.reviewedFiles}/${summary.totalFiles}`);
      lines.push(`**Open comments:** ${summary.totalComments}`);
      lines.push(`**Score:** ${summary.score ?? 'N/A'}/100`);
      lines.push('');
      lines.push('## Comments');
      lines.push('');

      const byFile = new Map<string, ReviewComment[]>();
      for (const c of comments.filter((c) => !c.resolved).sort((a, b) => a.line - b.line)) {
        const list = byFile.get(c.filePath) ?? [];
        list.push(c);
        byFile.set(c.filePath, list);
      }

      for (const [filePath, list] of byFile) {
        lines.push(`### ${filePath}`);
        lines.push('');
        for (const c of list) {
          lines.push(`- **${c.severity.toUpperCase()}** L${c.line} (${c.category}): ${c.message}`);
          if (c.suggestion) lines.push(`  - Suggestion: ${c.suggestion}`);
        }
        lines.push('');
      }

      return lines.join('\n');
    },

    reset: () => {
      const rootPath = getRootPath();
      if (rootPath) clearPersistedData(rootPath);
      set((s) => {
        s.source = 'working';
        s.targetBranch = 'main';
        s.status = 'idle';
        s.error = null;
        s.files = [];
        s.selectedFile = null;
        s.comments = [];
        s.summary = { ...EMPTY_SUMMARY };
      });
    },

  })),
);

// Internal persistence helper
function _persistState() {
  const rootPath = getRootPath();
  if (!rootPath) return;
  const state = useReviewStore.getState();
  const reviewedFiles = state.files.filter((f) => f.reviewed).map((f) => f.path);
  savePersistedData(rootPath, { comments: state.comments, reviewedFiles, version: 1 });
}

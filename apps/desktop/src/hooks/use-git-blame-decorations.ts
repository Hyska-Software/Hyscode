import { useEffect, useRef } from 'react';
import { useGitStore } from '../stores/git-store';
import { useFileStore } from '../stores/file-store';
import { useSettingsStore } from '../stores/settings-store';
import type * as monacoEditor from 'monaco-editor';

// ── Types ─────────────────────────────────────────────────────────────────────

type IEditor = monacoEditor.editor.IStandaloneCodeEditor;
type IMonaco = typeof monacoEditor;

interface GitBlameHunk {
  start_line: number;
  lines_in_hunk: number;
  author: string;
  email: string;
  timestamp: number;
  short_hash: string;
  message: string;
}

// ── One-time CSS injection ────────────────────────────────────────────────────

let cssInjected = false;

function ensureGitBlameCss() {
  if (cssInjected) return;
  cssInjected = true;
  const el = document.createElement('style');
  el.textContent = `
    .monaco-editor .git-blame-inline {
      color: #8b949e;
      font-size: 11px;
      font-style: italic;
      opacity: 0.8;
      pointer-events: none;
      white-space: pre;
      margin-left: 2ch;
    }
  `;
  document.head.appendChild(el);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeRelPath(filePath: string, rootPath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  let root = rootPath.replace(/\\/g, '/');
  if (!root.endsWith('/')) root += '/';
  return norm.startsWith(root) ? norm.slice(root.length) : norm;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  const intervals: [number, string][] = [
    [31536000, 'year'],
    [2592000, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [secs, label] of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) {
      return `${count} ${label}${count > 1 ? 's' : ''} ago`;
    }
  }
  return 'just now';
}

function getBlameTextForLine(hunks: GitBlameHunk[], line: number): string | null {
  for (const hunk of hunks) {
    if (line >= hunk.start_line && line < hunk.start_line + hunk.lines_in_hunk) {
      const timeAgo = formatTimeAgo(hunk.timestamp);
      return `${hunk.author}, ${timeAgo}`;
    }
  }
  return null;
}

function createLineDecoration(
  line: number,
  text: string,
  monaco: IMonaco,
  model: monacoEditor.editor.ITextModel,
): monacoEditor.editor.IModelDeltaDecoration {
  const maxColumn = model.getLineMaxColumn(line);
  return {
    range: new monaco.Range(line, maxColumn, line, maxColumn),
    options: {
      after: {
        content: text,
        inlineClassName: 'git-blame-inline',
        cursorStops: monaco.editor.InjectedTextCursorStops.None,
      },
      showIfCollapsed: true,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useGitBlameDecorations(
  editorRef: React.MutableRefObject<IEditor | null>,
  monacoRef: React.MutableRefObject<IMonaco | null>,
  filePath: string | null,
  editorVersion: number,
) {
  const rootPath = useFileStore((s) => s.rootPath);
  const enabled = useSettingsStore((s) => s.gitBlameInline);

  const ownedDecorationsRef = useRef<Map<string, string[]>>(new Map());
  const hunksRef = useRef<GitBlameHunk[]>([]);

  // Inject CSS once on mount
  useEffect(() => {
    ensureGitBlameCss();
  }, []);

  // Main effect: runs whenever prerequisites change
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    // Reset and bail if prerequisites are missing
    if (!editor || !monaco || !filePath || !rootPath || !enabled) {
      if (editor) {
        const model = editor.getModel();
        if (model) {
          const uri = model.uri.toString();
          const oldIds = ownedDecorationsRef.current.get(uri) ?? [];
          if (oldIds.length > 0) {
            model.deltaDecorations(oldIds, []);
            ownedDecorationsRef.current.delete(uri);
          }
        }
      }
      hunksRef.current = [];
      return;
    }

    if (filePath.startsWith('untitled:')) {
      hunksRef.current = [];
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    const relPath = normalizeRelPath(filePath, rootPath);
    let cancelled = false;

    // Apply blame for a specific line using current editor/monaco/hunks state
    const applyForLine = (line: number) => {
      const ed = editorRef.current;
      const mn = monacoRef.current;
      if (!ed || !mn) return;

      const m = ed.getModel();
      if (!m) return;

      const uri = m.uri.toString();
      const oldIds = ownedDecorationsRef.current.get(uri) ?? [];

      const text = getBlameTextForLine(hunksRef.current, line);
      if (!text) {
        if (oldIds.length > 0) {
          m.deltaDecorations(oldIds, []);
          ownedDecorationsRef.current.delete(uri);
        }
        return;
      }

      const decoration = createLineDecoration(line, text, mn, m);
      const newIds = m.deltaDecorations(oldIds, [decoration]);
      ownedDecorationsRef.current.set(uri, newIds);
    };

    const clearDecorations = () => {
      const ed = editorRef.current;
      if (!ed) return;
      const m = ed.getModel();
      if (!m) return;
      const uri = m.uri.toString();
      const oldIds = ownedDecorationsRef.current.get(uri) ?? [];
      if (oldIds.length > 0) {
        m.deltaDecorations(oldIds, []);
        ownedDecorationsRef.current.delete(uri);
      }
    };

    // Fetch blame for this file
    useGitStore.getState().getBlame(relPath)
      .then((hunks) => {
        if (cancelled) return;
        hunksRef.current = hunks;
        const ed = editorRef.current;
        if (!ed) return;
        const pos = ed.getPosition();
        if (pos) applyForLine(pos.lineNumber);
      })
      .catch((err) => {
        if (cancelled) return;
        hunksRef.current = [];
        console.warn('[git-blame] error:', err);
        clearDecorations();
      });

    // Listen to cursor position changes
    const cursorDisposable = editor.onDidChangeCursorPosition((e) => {
      applyForLine(e.position.lineNumber);
    });

    // Re-fetch blame after typing stops (3s debounce)
    let timer: ReturnType<typeof setTimeout> | null = null;
    const contentDisposable = editor.onDidChangeModelContent(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const ed = editorRef.current;
        if (!ed) return;
        const rel = rootPath ? normalizeRelPath(filePath, rootPath) : null;
        if (!rel) return;
        useGitStore.getState().getBlame(rel)
          .then((hunks) => {
            hunksRef.current = hunks;
            const e2 = editorRef.current;
            if (!e2) return;
            const pos = e2.getPosition();
            if (pos) applyForLine(pos.lineNumber);
          })
          .catch(() => {
            hunksRef.current = [];
            clearDecorations();
          });
      }, 3000);
    });

    return () => {
      cancelled = true;
      cursorDisposable.dispose();
      contentDisposable.dispose();
      if (timer) clearTimeout(timer);
      hunksRef.current = [];
    };
  }, [editorRef, monacoRef, filePath, rootPath, enabled, editorVersion]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (editor) {
        const model = editor.getModel();
        if (model) {
          const uri = model.uri.toString();
          const oldIds = ownedDecorationsRef.current.get(uri) ?? [];
          if (oldIds.length > 0) {
            model.deltaDecorations(oldIds, []);
          }
        }
      }
      ownedDecorationsRef.current.clear();
      hunksRef.current = [];
    };
  }, []);
}

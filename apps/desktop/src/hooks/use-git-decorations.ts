import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useGitStore } from '../stores/git-store';
import { useFileStore } from '../stores/file-store';
import { computeDiffHunks } from '../lib/compute-diff';
import type { DiffHunk } from '../stores/agent-store';
import type * as monacoEditor from 'monaco-editor';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DiffHunkInfo {
  new_start: number;
  new_lines: number;
  old_lines: number;
}

type IEditor = monacoEditor.editor.IStandaloneCodeEditor;
type IMonaco = typeof monacoEditor;

// ── One-time CSS injection ────────────────────────────────────────────────────

let cssInjected = false;

function ensureGitGutterCss() {
  if (cssInjected) return;
  cssInjected = true;
  const el = document.createElement('style');
  el.textContent = `
    /* VS Code dirty-diff style – border-left only, never override Monaco's
       inline top/height on .cdr elements or all bars pile at container-top */
    .monaco-editor .git-gutter-added {
      border-left: 3px solid #3fb950 !important;
      border-radius: 0 1px 1px 0 !important;
    }
    .monaco-editor .git-gutter-modified {
      border-left: 3px solid #e3b341 !important;
    }
    .monaco-editor .git-gutter-deleted {
      border-left: 3px solid #f85149 !important;
      opacity: 0.8 !important;
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

function hunksToDecorations(
  hunks: DiffHunk[],
  monaco: IMonaco,
): monacoEditor.editor.IModelDeltaDecoration[] {
  const decorations: monacoEditor.editor.IModelDeltaDecoration[] = [];

  for (const hunk of hunks) {
    switch (hunk.type) {
      case 'delete': {
        const line = Math.max(1, hunk.newStart);
        decorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            linesDecorationsClassName: 'git-gutter-deleted',
            minimap: {
              color: '#f85149',
              position: monaco.editor.MinimapPosition.Inline,
            },
            overviewRuler: {
              color: '#f85149',
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        });
        break;
      }
      case 'add': {
        const endLine = Math.max(hunk.newStart, hunk.newStart + hunk.newLines - 1);
        decorations.push({
          range: new monaco.Range(hunk.newStart, 1, endLine, 1),
          options: {
            linesDecorationsClassName: 'git-gutter-added',
            minimap: {
              color: '#3fb950',
              position: monaco.editor.MinimapPosition.Inline,
            },
            overviewRuler: {
              color: '#3fb950',
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        });
        break;
      }
      case 'modify': {
        const endLine = Math.max(hunk.newStart, hunk.newStart + hunk.newLines - 1);
        decorations.push({
          range: new monaco.Range(hunk.newStart, 1, endLine, 1),
          options: {
            linesDecorationsClassName: 'git-gutter-modified',
            minimap: {
              color: '#e3b341',
              position: monaco.editor.MinimapPosition.Inline,
            },
            overviewRuler: {
              color: '#e3b341',
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        });
        break;
      }
    }
  }

  return decorations;
}

function backendHunksToDiffHunks(hunks: DiffHunkInfo[]): DiffHunk[] {
  return hunks.map((h) => {
    const isAddition = h.old_lines === 0;
    const isDeletion = h.new_lines === 0;
    if (isDeletion) {
      return {
        type: 'delete' as const,
        oldStart: h.new_start,
        oldLines: h.old_lines,
        newStart: h.new_start,
        newLines: 0,
      };
    }
    if (isAddition) {
      return {
        type: 'add' as const,
        oldStart: h.new_start,
        oldLines: 0,
        newStart: h.new_start,
        newLines: h.new_lines,
      };
    }
    return {
      type: 'modify' as const,
      oldStart: h.new_start,
      oldLines: h.old_lines,
      newStart: h.new_start,
      newLines: h.new_lines,
    };
  });
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useGitDecorations(
  editorRef: React.MutableRefObject<IEditor | null>,
  monacoRef: React.MutableRefObject<IMonaco | null>,
  filePath: string | null,
  editorVersion: number,
) {
  const rootPath = useFileStore((s) => s.rootPath);

  // Stable selector: only the current file's status (string), not the full arrays.
  // Prevents re-renders from unrelated git-status changes in other files.
  const fileGitStatus = useGitStore((s): 'staged' | 'unstaged' | null => {
    if (!filePath || !rootPath) return null;
    const rel = normalizeRelPath(filePath, rootPath);
    const inUnstaged = s.unstaged.some((f) => f.path === rel);
    const inStaged = s.staged.some((f) => f.path === rel);
    if (!inUnstaged && !inStaged) return null;
    return inStaged && !inUnstaged ? 'staged' : 'unstaged';
  });

  // Per-model decoration IDs: uri → string[]
  // Using model.deltaDecorations directly avoids stale-ID cross-model duplicates
  const ownedDecorationsRef = useRef<Map<string, string[]>>(new Map());
  const originalContentRef = useRef<string | null>(null);
  const currentFilePathRef = useRef<string | null>(null);

  // Inject CSS once on mount
  useEffect(() => {
    ensureGitGutterCss();
  }, []);

  // Core function to apply decorations
  const applyDecorations = useCallback(
    async (useEditorContent = false) => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco || !filePath || !rootPath) return;

      // Read latest git state at call-time (avoids stale closure + dep-array churn)
      const { staged, unstaged } = useGitStore.getState();
      const relPath = normalizeRelPath(filePath, rootPath);
      const inUnstaged = unstaged.some((f) => f.path === relPath);
      const inStaged = staged.some((f) => f.path === relPath);

      const model = editor.getModel();
      if (!model) return;
      const modelUri = model.uri.toString();

      if (!inUnstaged && !inStaged) {
        const oldIds = ownedDecorationsRef.current.get(modelUri) ?? [];
        if (oldIds.length > 0) {
          model.deltaDecorations(oldIds, []);
          ownedDecorationsRef.current.delete(modelUri);
        }
        return;
      }

      const useStaged = inStaged && !inUnstaged;

      try {
        let hunks: DiffHunk[] = [];

        if (useEditorContent && originalContentRef.current !== null) {
          const currentContent = model.getValue();
          hunks = computeDiffHunks(originalContentRef.current, currentContent);
        } else {
          const backendHunks = await invoke<DiffHunkInfo[]>('git_diff_hunks', {
            repoPath: rootPath,
            filePath: relPath,
            staged: useStaged,
          });
          hunks = backendHunksToDiffHunks(backendHunks);
        }

        const ed = editorRef.current;
        const mn = monacoRef.current;
        if (!ed || !mn) return;

        const currentModel = ed.getModel();
        if (!currentModel) return;

        const currentUri = currentModel.uri.toString();
        const decorations = hunksToDecorations(hunks, mn);

        const oldIds = ownedDecorationsRef.current.get(currentUri) ?? [];
        const newIds = currentModel.deltaDecorations(oldIds, decorations);
        ownedDecorationsRef.current.set(currentUri, newIds);
      } catch (err) {
        console.warn('[git-decorations]', err);
        const ed = editorRef.current;
        if (ed) {
          const m = ed.getModel();
          if (m) {
            const uri = m.uri.toString();
            const oldIds = ownedDecorationsRef.current.get(uri) ?? [];
            if (oldIds.length > 0) {
              m.deltaDecorations(oldIds, []);
              ownedDecorationsRef.current.delete(uri);
            }
          }
        }
      }
    },
    // No staged/unstaged here — read via getState() inside the fn
    [editorRef, monacoRef, filePath, rootPath],
  );

  // Fetch original content when file opens or git status changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !filePath || !rootPath) {
      originalContentRef.current = null;
      currentFilePathRef.current = null;
      return;
    }

    if (fileGitStatus === null) {
      originalContentRef.current = null;
      currentFilePathRef.current = null;
      // File is clean now — clear any leftover decorations
      applyDecorations(false);
      return;
    }

    const relPath = normalizeRelPath(filePath, rootPath);

    // Fetch original content from HEAD for real-time diff
    if (currentFilePathRef.current !== filePath) {
      currentFilePathRef.current = filePath;
      invoke<{ original: string }>('git_file_content', {
        repoPath: rootPath,
        filePath: relPath,
        originalRef: undefined,
        modifiedRef: undefined,
        baseBranch: undefined,
      })
        .then((result) => {
          originalContentRef.current = result.original;
          applyDecorations(false);
        })
        .catch(() => {
          originalContentRef.current = null;
          applyDecorations(false);
        });
    } else {
      applyDecorations(false);
    }
  }, [filePath, fileGitStatus, rootPath, editorVersion, applyDecorations]);

  // Real-time diff while typing (debounced)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !filePath || fileGitStatus === null) return;

    let timeout: ReturnType<typeof setTimeout>;
    const disposable = editor.onDidChangeModelContent(() => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        applyDecorations(true);
      }, 300);
    });

    return () => {
      disposable.dispose();
      if (timeout) clearTimeout(timeout);
    };
  }, [editorRef, filePath, fileGitStatus, applyDecorations]);

  // Clean up decorations on unmount
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
      originalContentRef.current = null;
      currentFilePathRef.current = null;
    };
  }, []);
}

/**
 * Active Monaco editor service.
 *
 * Bridges the extension API to the live editor instance so extension actions
 * (context menu items, commands) operate on the editor buffer instead of
 * bypassing it with direct disk reads/writes. Model edits applied here go
 * through `pushEditOperations`, so `@monaco-editor/react`'s `onChange`
 * fires and the normal dirty/LSP-sync pipeline runs.
 */

import type * as monacoEditor from 'monaco-editor';

type MonacoEditor = monacoEditor.editor.IStandaloneCodeEditor;

let activeEditor: MonacoEditor | null = null;

export function setActiveEditor(editor: MonacoEditor | null): void {
  activeEditor = editor;
}

export function getActiveEditor(): MonacoEditor | null {
  return activeEditor;
}

export interface EditorSelectionSnapshot {
  text: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface EditorDecorationLike {
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  options: {
    className?: string;
    inlineClassName?: string;
    hoverMessage?: string;
    isWholeLine?: boolean;
    glyphMarginClassName?: string;
  };
}

/** Full text of the active editor buffer. */
export function getActiveEditorContent(): string | null {
  return activeEditor?.getModel()?.getValue() ?? null;
}

/** Current selection (text + range) of the active editor. */
export function getActiveEditorSelection(): EditorSelectionSnapshot | null {
  const editor = activeEditor;
  const model = editor?.getModel();
  const selection = editor?.getSelection();
  if (!editor || !model || !selection) return null;
  return {
    text: model.getValueInRange(selection),
    startLineNumber: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLineNumber: selection.endLineNumber,
    endColumn: selection.endColumn,
  };
}

function applyEdits(
  edits: monacoEditor.editor.IIdentifiedSingleEditOperation[],
): boolean {
  const editor = activeEditor;
  const model = editor?.getModel();
  if (!editor || !model) return false;
  model.pushStackElement();
  model.pushEditOperations(null, edits, () => null);
  model.pushStackElement();
  editor.focus();
  return true;
}

/** Replace the whole active buffer with `text`. */
export function replaceActiveEditorContent(text: string): boolean {
  const model = activeEditor?.getModel();
  if (!model) return false;
  return applyEdits([{ range: model.getFullModelRange(), text }]);
}

/** Replace the current selection/cursor with `text`. */
export function replaceActiveEditorSelection(text: string): boolean {
  const selection = activeEditor?.getSelection();
  if (!selection) return false;
  return applyEdits([{ range: selection, text }]);
}

/** Insert `text` at the current selection/cursor (same as replacing it). */
export function insertIntoActiveEditor(text: string): boolean {
  return replaceActiveEditorSelection(text);
}

/** Apply ephemeral decorations to the active editor. */
export function applyEditorDecorations(
  decorations: EditorDecorationLike[],
): { dispose(): void } {
  const editor = activeEditor;
  if (!editor) return { dispose() {} };
  const collection = editor.createDecorationsCollection(
    decorations.map((decoration) => ({
      range: {
        startLineNumber: decoration.range.startLine,
        startColumn: decoration.range.startColumn,
        endLineNumber: decoration.range.endLine,
        endColumn: decoration.range.endColumn,
      },
      options: {
        className: decoration.options.className,
        inlineClassName: decoration.options.inlineClassName,
        hoverMessage: decoration.options.hoverMessage
          ? { value: decoration.options.hoverMessage }
          : undefined,
        isWholeLine: decoration.options.isWholeLine,
        glyphMarginClassName: decoration.options.glyphMarginClassName,
      },
    })),
  );
  return { dispose: () => collection.clear() };
}

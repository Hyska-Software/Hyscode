/**
 * Applies an extension document formatter to the active editor buffer.
 *
 * Shared by the editor context menu ("Format with X") and the
 * `workbench.action.formatDocument` keybinding so both paths behave
 * identically: edits go through the Monaco history stack and trigger the
 * normal dirty/LSP-sync pipeline via the editor's change event.
 */

import type { DocumentFormatter } from '@hyscode/extension-api';
import { useEditorStore, useSettingsStore } from '../stores';
import { useExtensionUiStore } from '../stores/extension-ui-store';
import { useFileStore } from '../stores/file-store';
import { getActiveEditor } from './editor-service';
import { detectLanguage } from './lsp-bridge';

/** Minimal model surface needed to apply formatter output. */
export interface FormatTargetModel {
  getValue(): string;
  getFullModelRange(): unknown;
  pushStackElement(): void;
  pushEditOperations(
    selections: null,
    ops: Array<{ range: unknown; text: string }>,
    cursorStateComputer: () => null,
  ): void;
}

/** Minimal editor surface needed to apply formatter output. */
export interface FormatTargetEditor {
  getModel(): FormatTargetModel | null;
  focus(): void;
  trigger?: (source: string, handlerId: string, payload?: unknown) => void;
}

type NotifyType = 'info' | 'warning' | 'error';

function notify(type: NotifyType, message: string, title?: string): void {
  useExtensionUiStore.getState().showNotification(type, message, title);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface FormatterContext {
  tabId: string;
  filePath: string;
  languageId: string;
  tabSize: number;
  insertSpaces: boolean;
}

/**
 * Format the active editor (or `editorOverride`, e.g. the editor instance
 * owned by the context menu) with the first formatter registered for the
 * language, or with `formatterId` when provided. Falls back to Monaco's
 * built-in format action (LSP provider) when no extension formatter exists.
 *
 * Returns true when formatting was applied.
 */
export async function formatActiveDocument(
  formatterId?: string,
  editorOverride?: FormatTargetEditor | null,
): Promise<boolean> {
  // `getActiveEditor()` returns the Monaco instance, which structurally
  // provides the subset of methods this module needs.
  const editor: FormatTargetEditor | null =
    editorOverride ?? (getActiveEditor() as FormatTargetEditor | null);
  if (!editor) return false;

  const { activeTabId, tabs } = useEditorStore.getState();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? '';
  const languageId = filePath
    ? (detectLanguage(filePath) || activeTab?.language || 'plaintext')
    : 'plaintext';
  const { tabSize, insertSpaces } = useSettingsStore.getState();

  const formatters = useExtensionUiStore.getState().getFormattersForLanguage(languageId);
  const formatter = formatterId
    ? formatters.find((f) => f.item.id === formatterId)
    : formatters[0];

  if (!formatter) {
    editor.trigger?.('formatActiveDocument', 'editor.action.formatDocument', undefined);
    return false;
  }

  return applyFormatter(editor, formatter.item, {
    tabId: activeTabId ?? '',
    filePath,
    languageId,
    tabSize,
    insertSpaces,
  });
}

async function applyFormatter(
  editor: FormatTargetEditor,
  formatter: DocumentFormatter,
  ctx: FormatterContext,
): Promise<boolean> {
  const model = editor.getModel();
  if (!model) return false;

  const content = model.getValue();
  let formatted: string;
  try {
    formatted = await formatter.format({
      content,
      filePath: ctx.filePath,
      languageId: ctx.languageId,
      tabSize: ctx.tabSize,
      insertSpaces: ctx.insertSpaces,
    });
  } catch (err) {
    notify('error', `Formatter "${formatter.displayName}" failed: ${errorMessage(err)}`, 'Format Document');
    return false;
  }

  if (typeof formatted !== 'string') {
    notify(
      'error',
      `Formatter "${formatter.displayName}" returned invalid output (expected string).`,
      'Format Document',
    );
    return false;
  }

  if (formatted === content) {
    editor.focus();
    return true;
  }

  // Anti-race: abort when the user switched tabs or kept typing mid-format.
  if (useEditorStore.getState().activeTabId !== ctx.tabId) return false;
  if (model.getValue() !== content) {
    notify(
      'warning',
      'File changed while formatting — skipped applying to avoid losing edits.',
      'Format Document',
    );
    return false;
  }

  try {
    const fullRange = model.getFullModelRange();
    model.pushStackElement();
    model.pushEditOperations(null, [{ range: fullRange, text: formatted }], () => null);
    model.pushStackElement();
    useFileStore.getState().setFileContent(ctx.filePath, formatted);
    useEditorStore.getState().markDirty(ctx.tabId, true);
    editor.focus();
    return true;
  } catch (err) {
    notify('error', `Failed to apply formatting: ${errorMessage(err)}`, 'Format Document');
    return false;
  }
}

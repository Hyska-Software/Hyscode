import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatActiveDocument } from './format-document';
import { useEditorStore } from '../stores/editor-store';
import { useFileStore } from '../stores/file-store';
import { useSettingsStore } from '../stores/settings-store';
import { useExtensionUiStore } from '../stores/extension-ui-store';

function setCodeTab(filePath: string, language = 'plaintext') {
  useEditorStore.setState({
    tabs: [
      {
        id: filePath,
        filePath,
        fileName: filePath.split('/').pop() ?? filePath,
        language,
        isDirty: false,
        isPinned: false,
        isPreview: false,
        type: 'file',
        viewerType: 'code',
      },
    ],
    activeTabId: filePath,
  });
}

function fakeEditor(initialValue: string) {
  const pushEditOperations = vi.fn();
  const pushStackElement = vi.fn();
  const model = {
    getValue: () => initialValue,
    getFullModelRange: () => ({}),
    pushStackElement,
    pushEditOperations,
  };
  const editor = {
    getModel: () => model,
    focus: vi.fn(),
    trigger: vi.fn(),
  };
  return { editor, model, pushEditOperations };
}

function addFormatter(format: (params: unknown) => Promise<string>) {
  return useExtensionUiStore.getState().addFormatter('test-ext', {
    id: 'test-fmt',
    displayName: 'TestFmt',
    languageIds: ['typescript'],
    format: format as never,
  });
}

beforeEach(() => {
  setCodeTab('C:/proj/app.ts', 'typescript');
  useSettingsStore.setState({ tabSize: 2, insertSpaces: true });
});

afterEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useExtensionUiStore.setState({ contextMenuItems: [], formatters: [], notifications: [] });
});

describe('formatActiveDocument', () => {
  it('applies formatter output through the editor history and marks the tab dirty', async () => {
    addFormatter(async () => 'const x = 1;\n');
    const { editor, model, pushEditOperations } = fakeEditor('const x=1;');

    const applied = await formatActiveDocument(undefined, editor);

    expect(applied).toBe(true);
    expect(model.pushStackElement).toHaveBeenCalledTimes(2);
    expect(pushEditOperations).toHaveBeenCalledTimes(1);
    const [selections, edits] = pushEditOperations.mock.calls[0] as [null, Array<{ text: string }>];
    expect(selections).toBeNull();
    expect(edits[0].text).toBe('const x = 1;\n');
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    expect(useFileStore.getState().getFileContent('C:/proj/app.ts')).toBe('const x = 1;\n');
  });

  it('falls back to the Monaco format action when no formatter is registered', async () => {
    const { editor, pushEditOperations } = fakeEditor('const x=1;');

    const applied = await formatActiveDocument(undefined, editor);

    expect(applied).toBe(false);
    expect(editor.trigger).toHaveBeenCalledWith(
      'formatActiveDocument',
      'editor.action.formatDocument',
      undefined,
    );
    expect(pushEditOperations).not.toHaveBeenCalled();
  });

  it('skips applying when the buffer changed while formatting', async () => {
    let resolveFormat: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      resolveFormat = resolve;
    });
    addFormatter(() => pending);
    const { editor, model, pushEditOperations } = fakeEditor('const x=1;');

    const resultPromise = formatActiveDocument(undefined, editor);
    model.getValue = () => 'const x=1; // typed';
    resolveFormat('const x = 1;\n');

    const applied = await resultPromise;
    expect(applied).toBe(false);
    expect(pushEditOperations).not.toHaveBeenCalled();
    expect(useExtensionUiStore.getState().notifications.some((n) => n.type === 'warning')).toBe(true);
  });

  it('rejects non-string formatter output without touching the model', async () => {
    addFormatter(async () => undefined as never);
    const { editor, pushEditOperations } = fakeEditor('const x=1;');

    const applied = await formatActiveDocument(undefined, editor);

    expect(applied).toBe(false);
    expect(pushEditOperations).not.toHaveBeenCalled();
    expect(useExtensionUiStore.getState().notifications.some((n) => n.type === 'error')).toBe(true);
  });
});

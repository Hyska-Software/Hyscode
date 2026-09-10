/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorContextMenu } from './editor-context-menu';
import { openCommandPalette } from './command-palette';
import { useEditorStore } from '../../stores/editor-store';
import { useFileStore } from '../../stores/file-store';
import { useLspStore } from '../../stores/lsp-store';
import { useExtensionUiStore } from '../../stores/extension-ui-store';
import { tauriInvoke } from '../../lib/tauri-invoke';
import { writeClipboard } from '../../lib/utils';

vi.mock('../../lib/tauri-invoke', () => ({ tauriInvoke: vi.fn() }));
vi.mock('../../lib/tauri-fs', () => ({
  tauriFs: {
    statPath: vi.fn(),
    watch: vi.fn().mockResolvedValue(undefined),
    unwatch: vi.fn().mockResolvedValue(undefined),
    listDir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(''),
  },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }));
vi.mock('../../lib/utils', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../lib/utils')>();
  return { ...orig, writeClipboard: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('./command-palette', () => ({ openCommandPalette: vi.fn() }));

const tauriInvokeMock = vi.mocked(tauriInvoke);
const writeClipboardMock = vi.mocked(writeClipboard);
const openCommandPaletteMock = vi.mocked(openCommandPalette);

interface FakeSelection {
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
}

function fakeEditor(selection: FakeSelection | null, selectedText: string | null) {
  const pushEditOperations = vi.fn();
  return {
    trigger: vi.fn(),
    focus: vi.fn(),
    pushEditOperations,
    getPosition: () => ({ lineNumber: 3, column: 5 }),
    getSelection: () => selection,
    getModel: () => ({
      getValue: () => 'const x = 1;',
      getValueInRange: () => selectedText ?? '',
      getFullModelRange: () => ({}),
      pushStackElement: () => {},
      pushEditOperations,
    }),
  };
}

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

function isDisabled(el: HTMLElement): boolean {
  return el.hasAttribute('data-disabled');
}

/**
 * Base UI submenus open on hover after a short rest delay. The trigger reacts
 * to pointer/enter/move events, so tests dispatch all three.
 */
function hoverSubmenu(name: string | RegExp) {
  const trigger = screen.getByRole('menuitem', { name });
  fireEvent.pointerEnter(trigger);
  fireEvent.mouseEnter(trigger);
  fireEvent.mouseMove(trigger);
}

async function openGroup(
  name: 'Go to' | 'Clipboard' | 'File',
  entry: RegExp,
): Promise<HTMLElement> {
  hoverSubmenu(name);
  return screen.findByRole('menuitem', { name: entry }, { timeout: 3000 });
}

function readyLspStore(capabilities: Record<string, unknown>) {
  useLspStore.setState({
    serverStatuses: {
      rust: {
        serverId: 'lsp-rust',
        languageId: 'rust',
        displayName: 'rust-analyzer',
        status: 'ready',
        source: 'builtin',
      },
    },
    serverCapabilities: { rust: capabilities as never },
  });
}

beforeEach(() => {
  useFileStore.setState({ rootPath: 'C:/proj' });
  useLspStore.setState({ serverStatuses: {}, serverCapabilities: {} });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useFileStore.setState({ rootPath: null });
  useLspStore.setState({ serverStatuses: {}, serverCapabilities: {} });
  useExtensionUiStore.setState({ contextMenuItems: [], formatters: [], notifications: [] });
});

describe('EditorContextMenu', () => {
  it('disables LSP actions for plaintext without a running server', async () => {
    setCodeTab('C:/proj/notes.txt');
    const editor = fakeEditor(null, null);

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={() => {}} />);

    expect(isDisabled(screen.getByRole('menuitem', { name: /Rename Symbol/ }))).toBe(true);
    expect(isDisabled(screen.getByRole('menuitem', { name: /Show Code Actions/ }))).toBe(true);

    await openGroup('Go to', /Go to Definition/);
    expect(isDisabled(screen.getByRole('menuitem', { name: /Go to Definition/ }))).toBe(true);

    const copy = await openGroup('Clipboard', /Copy\s*Ctrl\+C/);
    expect(isDisabled(copy)).toBe(false);
  });

  it('keeps navigation enabled for TypeScript via native intelligence', async () => {
    setCodeTab('C:/proj/app.ts', 'typescript');
    const editor = fakeEditor(null, null);

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={() => {}} />);

    expect(isDisabled(screen.getByRole('menuitem', { name: /Rename Symbol/ }))).toBe(false);

    const definition = await openGroup('Go to', /Go to Definition/);
    expect(isDisabled(definition)).toBe(false);
  });

  it('enables navigation for other languages once the LSP server is ready', async () => {
    setCodeTab('C:/proj/main.rs', 'rust');
    readyLspStore({
      definitionProvider: true,
      typeDefinitionProvider: true,
      implementationProvider: true,
      referencesProvider: true,
      renameProvider: true,
      codeActionProvider: true,
      documentSymbolProvider: true,
    });
    const editor = fakeEditor(null, null);

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={() => {}} />);
    await openGroup('Go to', /Go to Definition/);

    expect(isDisabled(screen.getByRole('menuitem', { name: /Go to Definition/ }))).toBe(false);
    expect(isDisabled(screen.getByRole('menuitem', { name: /Go to Type Definition/ }))).toBe(false);
    expect(isDisabled(screen.getByRole('menuitem', { name: /Go to Implementation/ }))).toBe(false);
  });

  it('disables actions the ready server does not declare capabilities for', async () => {
    setCodeTab('C:/proj/main.rs', 'rust');
    readyLspStore({ definitionProvider: true });
    const editor = fakeEditor(null, null);

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={() => {}} />);

    expect(isDisabled(screen.getByRole('menuitem', { name: /Rename Symbol/ }))).toBe(true);

    await openGroup('Go to', /Go to Definition/);
    expect(isDisabled(screen.getByRole('menuitem', { name: /Go to Definition/ }))).toBe(false);
    expect(isDisabled(screen.getByRole('menuitem', { name: /Find All References/ }))).toBe(true);
  });

  it('falls back Go to Declaration to definition when no declaration provider exists', async () => {
    setCodeTab('C:/proj/main.rs', 'rust');
    readyLspStore({ definitionProvider: true });
    const editor = fakeEditor(null, null);

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={() => {}} />);
    const declaration = await openGroup('Go to', /Go to Declaration/);

    expect(isDisabled(declaration)).toBe(false);
    fireEvent.click(declaration);

    expect(editor.trigger).toHaveBeenCalledWith('contextMenu', 'editor.action.revealDefinition');
    expect(editor.trigger).not.toHaveBeenCalledWith('contextMenu', 'editor.action.revealDeclaration');
  });

  it('triggers the real declaration action when the server declares the capability', async () => {
    setCodeTab('C:/proj/main.rs', 'rust');
    readyLspStore({ definitionProvider: true, declarationProvider: true });
    const editor = fakeEditor(null, null);

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={() => {}} />);
    const declaration = await openGroup('Go to', /Go to Declaration/);
    fireEvent.click(declaration);

    expect(editor.trigger).toHaveBeenCalledWith('contextMenu', 'editor.action.revealDeclaration');
  });

  it('opens the IDE command palette instead of the Monaco quick command', () => {
    setCodeTab('C:/proj/app.ts', 'typescript');
    const editor = fakeEditor(null, null);

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Command Palette/ }));

    expect(openCommandPaletteMock).toHaveBeenCalledTimes(1);
    expect(editor.trigger).not.toHaveBeenCalledWith('contextMenu', 'editor.action.quickCommand');
  });

  it('triggers the Monaco navigation action on click', async () => {
    setCodeTab('C:/proj/app.ts', 'typescript');
    const editor = fakeEditor(null, null);
    const onClose = vi.fn();

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={onClose} />);
    const definition = await openGroup('Go to', /Go to Definition/);
    fireEvent.click(definition);

    expect(editor.trigger).toHaveBeenCalledWith('contextMenu', 'editor.action.revealDefinition');
    expect(onClose).toHaveBeenCalled();
  });

  it('opens submenus on hover', async () => {
    setCodeTab('C:/proj/app.ts', 'typescript');

    render(<EditorContextMenu x={10} y={10} editorInstance={fakeEditor(null, null)} onClose={() => {}} />);

    expect(screen.queryByRole('menuitem', { name: /Go to Definition/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Copy and Trim/ })).toBeNull();

    await openGroup('Go to', /Go to Definition/);
    await openGroup('Clipboard', /Copy and Trim/);
    expect(screen.getByRole('menuitem', { name: /Copy and Trim/ })).toBeTruthy();
  });

  it('loads file history when the history submenu opens', async () => {
    setCodeTab('C:/proj/app.ts', 'typescript');
    tauriInvokeMock.mockResolvedValue([
      {
        hash: 'abc123def456',
        short_hash: 'abc123d',
        message: 'Fix the thing',
        author: 'Dev',
        email: 'dev@example.com',
        timestamp: 1700000000,
      },
    ]);

    render(<EditorContextMenu x={10} y={10} editorInstance={fakeEditor(null, null)} onClose={() => {}} />);
    hoverSubmenu(/View File History/);

    expect(await screen.findByRole('menuitem', { name: /Fix the thing/ })).toBeTruthy();
    expect(tauriInvokeMock).toHaveBeenCalledWith(
      'git_log_file',
      expect.objectContaining({ repoPath: 'C:/proj', limit: 20 }),
    );
  });

  it('closes on Escape', () => {
    setCodeTab('C:/proj/app.ts', 'typescript');
    const onClose = vi.fn();

    render(<EditorContextMenu x={10} y={10} editorInstance={fakeEditor(null, null)} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('disables Copy and Trim without a selection and copies trimmed text with one', async () => {
    setCodeTab('C:/proj/app.ts', 'typescript');

    const { unmount } = render(
      <EditorContextMenu x={10} y={10} editorInstance={fakeEditor(null, null)} onClose={() => {}} />,
    );
    const disabledItem = await openGroup('Clipboard', /Copy and Trim/);
    expect(isDisabled(disabledItem)).toBe(true);
    unmount();

    render(
      <EditorContextMenu
        x={10}
        y={10}
        editorInstance={fakeEditor(
          { startLineNumber: 1, endLineNumber: 2, startColumn: 1, endColumn: 3 },
          'hello   \nworld\t',
        )}
        onClose={() => {}}
      />,
    );
    const item = await openGroup('Clipboard', /Copy and Trim/);
    expect(isDisabled(item)).toBe(false);
    fireEvent.click(item);
    expect(writeClipboardMock).toHaveBeenCalledWith('hello\nworld');
  });

  it('copies path with line and selection range', async () => {
    setCodeTab('C:/proj/app.ts', 'typescript');
    const editor = fakeEditor(
      { startLineNumber: 3, endLineNumber: 3, startColumn: 2, endColumn: 9 },
      'selected',
    );

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={() => {}} />);
    const item = await openGroup('File', /Copy Path with Line/);
    fireEvent.click(item);

    expect(writeClipboardMock).toHaveBeenCalledWith('C:/proj/app.ts:3:2-9');
  });

  it('filters extension items by when-clause', () => {
    setCodeTab('C:/proj/app.ts', 'typescript');
    const { dispose } = useExtensionUiStore.getState().addContextMenuItem('test-ext', {
      id: 'sel-action',
      label: 'Selection Action',
      when: 'editorHasSelection',
      handler: () => {},
    });

    const { unmount } = render(
      <EditorContextMenu x={10} y={10} editorInstance={fakeEditor(null, null)} onClose={() => {}} />,
    );
    expect(screen.queryByRole('menuitem', { name: /Selection Action/ })).toBeNull();
    unmount();

    render(
      <EditorContextMenu
        x={10}
        y={10}
        editorInstance={fakeEditor(
          { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 4 },
          'abc',
        )}
        onClose={() => {}}
      />,
    );
    expect(isDisabled(screen.getByRole('menuitem', { name: /Selection Action/ }))).toBe(false);
    dispose();
  });

  it('applies formatter output and marks the tab dirty', async () => {
    setCodeTab('C:/proj/app.ts', 'typescript');
    const { dispose } = useExtensionUiStore.getState().addFormatter('test-ext', {
      id: 'test-fmt',
      displayName: 'TestFmt',
      languageIds: ['typescript'],
      format: async () => 'const x = 1;\n',
    });
    const editor = fakeEditor(null, null);

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Format with TestFmt/ }));

    await waitFor(() => {
      expect(editor.pushEditOperations).toHaveBeenCalledTimes(1);
    });
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    dispose();
  });

  it('opens a real commit tab when a history entry is clicked', async () => {
    setCodeTab('C:/proj/app.ts', 'typescript');
    tauriInvokeMock.mockResolvedValue([
      {
        hash: 'abc123def456',
        short_hash: 'abc123d',
        message: 'Fix the thing',
        author: 'Dev',
        email: 'dev@example.com',
        timestamp: 1700000000,
      },
    ]);
    const editor = fakeEditor(null, null);

    render(<EditorContextMenu x={10} y={10} editorInstance={editor} onClose={() => {}} />);
    hoverSubmenu(/View File History/);

    const entry = await screen.findByRole('menuitem', { name: /Fix the thing/ });
    fireEvent.click(entry);

    expect(useEditorStore.getState().tabs.some((t) => t.type === 'commit')).toBe(true);
  });
});

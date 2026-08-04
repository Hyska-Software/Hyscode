import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

const { invokeMock, destroyMock, getHarnessMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  destroyMock: vi.fn(),
  getHarnessMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock('./tauri-invoke', () => ({
  tauriInvoke: invokeMock,
  tauriInvokeRaw: invokeMock,
}));

vi.mock('./harness-bridge', () => ({
  HarnessBridge: {
    destroy: destroyMock,
    get: getHarnessMock,
  },
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

const storageValues = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageValues.get(key) ?? null,
  setItem: (key: string, value: string) => storageValues.set(key, value),
  removeItem: (key: string) => storageValues.delete(key),
  clear: () => storageValues.clear(),
};

describe('project workspace lifecycle', () => {
  let persistence: typeof import('./project-persistence');
  let projectStore: typeof import('@/stores/project-store');
  let fileStore: typeof import('@/stores/file-store');
  let editorStore: typeof import('@/stores/editor-store');
  let agentStore: typeof import('@/stores/agent-store');
  let terminalStore: typeof import('@/stores/terminal-store');
  let layoutStore: typeof import('@/stores/layout-store');
  let originalOpenFolder: ReturnType<typeof fileStore.useFileStore.getState>['openFolder'];

  beforeAll(async () => {
    vi.stubGlobal('localStorage', localStorageMock);
    [persistence, projectStore, fileStore, editorStore, agentStore, terminalStore, layoutStore] =
      await Promise.all([
        import('./project-persistence'),
        import('@/stores/project-store'),
        import('@/stores/file-store'),
        import('@/stores/editor-store'),
        import('@/stores/agent-store'),
        import('@/stores/terminal-store'),
        import('@/stores/layout-store'),
      ]);
    originalOpenFolder = fileStore.useFileStore.getState().openFolder;
  });

  beforeEach(() => {
    storageValues.clear();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'db_list_conversations') return [];
      if (command === 'db_get_conversation') return null;
      return undefined;
    });
    destroyMock.mockClear();
    getHarnessMock.mockReset();
    listenMock.mockReset().mockResolvedValue(vi.fn());

    projectStore.useProjectStore.setState({
      name: null,
      rootPath: null,
      isLoading: false,
      recentProjects: [],
    });
    fileStore.useFileStore.setState({
      rootPath: null,
      tree: [],
      fileCache: new Map(),
      externalConflicts: new Set(),
      openFolder: originalOpenFolder,
    });
    editorStore.useEditorStore.setState({ tabs: [], activeTabId: null });
    agentStore.useAgentStore.getState().resetProjectState();
    terminalStore.useTerminalStore.setState({ sessions: [], activeSessionId: null, nextIndex: 1 });
    layoutStore.useLayoutStore.setState({
      workspaceMode: 'editor',
      terminalVisible: false,
      sidebarActiveTab: 'chat',
    });
  });

  it('clears old project UI and opens the selected directory as one workspace', async () => {
    projectStore.useProjectStore.getState().openProject('C:/old-project');
    fileStore.useFileStore.setState({ rootPath: 'C:/old-project' });
    editorStore.useEditorStore.getState().openTab({
      id: 'C:/old-project/old.ts',
      filePath: 'C:/old-project/old.ts',
      fileName: 'old.ts',
      language: 'typescript',
    });
    agentStore.useAgentStore.getState().addMessage({
      id: 'old-message',
      role: 'assistant',
      content: 'Old project chat',
      timestamp: 0,
    });
    const oldTerminalId = terminalStore.useTerminalStore.getState().createSession();
    terminalStore.useTerminalStore.getState().setPtyId(oldTerminalId, 'old-pty');
    layoutStore.useLayoutStore.getState().setWorkspaceMode('agent');
    layoutStore.useLayoutStore.getState().setTerminalVisible(true);

    const openFolderMock = vi.fn(async (path: string) => {
      fileStore.useFileStore.setState({
        rootPath: path,
        tree: [{ name: 'new.ts', path: `${path}/new.ts`, isDir: false, size: 1 }],
      });
    });
    fileStore.useFileStore.setState({ openFolder: openFolderMock });

    await persistence.openProjectWorkspace('C:/new-project');

    expect(projectStore.useProjectStore.getState().rootPath).toBe('C:/new-project');
    expect(fileStore.useFileStore.getState().rootPath).toBe('C:/new-project');
    expect(fileStore.useFileStore.getState().tree[0]?.path).toBe('C:/new-project/new.ts');
    expect(editorStore.useEditorStore.getState().tabs).toEqual([]);
    expect(agentStore.useAgentStore.getState().messages).toEqual([]);
    expect(agentStore.useAgentStore.getState().openTabs).toEqual([
      { id: '__default__', title: 'New Chat' },
    ]);
    expect(terminalStore.useTerminalStore.getState().sessions).toEqual([]);
    expect(layoutStore.useLayoutStore.getState().workspaceMode).toBe('editor');
    expect(layoutStore.useLayoutStore.getState().terminalVisible).toBe(true);
    expect(openFolderMock).toHaveBeenCalledWith('C:/new-project');
    expect(invokeMock).toHaveBeenCalledWith('pty_kill', { ptyId: 'old-pty' });
    expect(destroyMock).toHaveBeenCalled();
  });
});

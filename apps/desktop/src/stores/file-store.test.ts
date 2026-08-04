import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

const { listDirMock, watchMock, unwatchMock, readFileMock, listenMock } = vi.hoisted(() => ({
  listDirMock: vi.fn(),
  watchMock: vi.fn(),
  unwatchMock: vi.fn(),
  readFileMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock('../lib/tauri-fs', () => ({
  tauriFs: {
    listDir: listDirMock,
    watch: watchMock,
    unwatch: unwatchMock,
    readFile: readFileMock,
  },
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { decideExternalFileUpdate, useFileStore } from './file-store';

const directoryEntries = (path: string) => [
  { name: 'README.md', path: `${path}/README.md`, is_dir: false, size: 10 },
];

beforeEach(() => {
  listDirMock.mockReset();
  watchMock.mockReset().mockResolvedValue(undefined);
  unwatchMock.mockReset().mockResolvedValue(undefined);
  readFileMock.mockReset().mockResolvedValue('');
  listenMock.mockReset().mockResolvedValue(vi.fn());
  useFileStore.getState().closeFolder();
});

describe('external file update policy', () => {
  it('reloads a cached clean buffer so open editors and previews update', () => {
    expect(
      decideExternalFileUpdate({ hasAgentEdit: false, isDirty: false, isCached: true }),
    ).toBe('reload');
  });

  it('preserves dirty buffers and reports a conflict', () => {
    expect(
      decideExternalFileUpdate({ hasAgentEdit: false, isDirty: true, isCached: true }),
    ).toBe('mark-conflict');
  });

  it('does not replace an active agent edit', () => {
    expect(
      decideExternalFileUpdate({ hasAgentEdit: true, isDirty: false, isCached: true }),
    ).toBe('ignore-agent-edit');
  });

  it('does not read text for files that have no cached buffer', () => {
    expect(
      decideExternalFileUpdate({ hasAgentEdit: false, isDirty: false, isCached: false }),
    ).toBe('ignore-uncached');
  });
});

describe('folder loading lifecycle', () => {
  it('does not publish a stale directory response after a newer project opens', async () => {
    const resolvers = new Map<
      string,
      (entries: Array<{ name: string; path: string; is_dir: boolean; size: number }>) => void
    >();
    listDirMock.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          resolvers.set(path, resolve);
        }),
    );

    const oldLoad = useFileStore.getState().openFolder('C:/old-project');
    await vi.waitFor(() => expect(listDirMock).toHaveBeenCalledWith('C:/old-project', false));

    const newLoad = useFileStore.getState().openFolder('C:/new-project');
    await vi.waitFor(() => expect(listDirMock).toHaveBeenCalledWith('C:/new-project', false));

    resolvers.get('C:/new-project')?.(directoryEntries('C:/new-project'));
    await newLoad;

    resolvers.get('C:/old-project')?.(directoryEntries('C:/old-project'));
    await oldLoad;

    expect(useFileStore.getState().rootPath).toBe('C:/new-project');
    expect(useFileStore.getState().tree[0]?.path).toBe('C:/new-project/README.md');
  });

  it('does not apply a delayed watcher read after a newer project opens', async () => {
    listDirMock.mockResolvedValue(directoryEntries('C:/project'));
    let resolveRead!: (content: string) => void;
    readFileMock.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolveRead = resolve;
      }),
    );

    await useFileStore.getState().openFolder('C:/old-project');
    const listener = listenMock.mock.calls[0]?.[1] as (
      event: { payload: { kind: string; paths: string[] } },
    ) => void;
    expect(listener).toBeDefined();

    useFileStore.getState().setFileContent('C:/old-project/app.ts', 'cached old content');
    listener({ payload: { kind: 'modify', paths: ['C:/old-project/app.ts'] } });
    await vi.waitFor(() => expect(readFileMock).toHaveBeenCalledWith('C:/old-project/app.ts'));

    const newLoad = useFileStore.getState().openFolder('C:/new-project');
    await newLoad;
    resolveRead('old project content');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useFileStore.getState().rootPath).toBe('C:/new-project');
    expect(useFileStore.getState().fileCache.has('C:/old-project/app.ts')).toBe(false);
  });
});

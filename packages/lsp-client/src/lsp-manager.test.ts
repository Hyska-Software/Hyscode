import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lsp-connection', () => ({
  LspConnection: class {
    capabilities = {};
    status = 'starting';
    serverId: string;
    private statusHandler: ((status: string) => void) | undefined;

    constructor(serverId: string) {
      this.serverId = serverId;
    }

    onStatusChange(handler: (status: string) => void): void {
      this.statusHandler = handler;
    }

    async initialize(): Promise<{ capabilities: Record<string, never> }> {
      this.status = 'ready';
      this.statusHandler?.('ready');
      return { capabilities: {} };
    }

    async shutdown(): Promise<void> {
      this.status = 'stopped';
    }
  },
}));

vi.mock('./tauri-transport', () => ({
  TauriLspTransport: class {
    async start(): Promise<void> {}
    close(): void {}
  },
}));

vi.mock('./monaco-adapter', () => ({
  MonacoLspAdapter: class {
    register(): void {}
    dispose(): void {}
  },
}));

vi.mock('./language-registry', () => ({
  normalizeLspLanguage: (languageId: string) =>
    languageId === 'typescriptreact' ? 'typescript' : languageId,
  enableNativeTypeScriptValidation: vi.fn(),
  disableNativeTypeScriptValidation: vi.fn(),
}));

import { LspManager } from './lsp-manager';

describe('LspManager startup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shares one startup across concurrent documents for the same server', async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'lsp_start') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { server_id: args?.id, root_path: 'D:\\workspace' };
      }
      return undefined;
    });
    const listen = vi.fn(async () => () => {});
    const manager = new LspManager(invoke, listen);
    manager.setRootUri('file:///d%3A/workspace');
    manager.setMonaco({} as typeof import('monaco-editor'));
    manager.registerServerConfig({
      id: 'typescript',
      languageIds: ['typescript', 'typescriptreact'],
      command: 'typescript-language-server',
      args: ['--stdio'],
    });

    await Promise.all([
      manager.onLanguageOpened('typescript', 'D:\\workspace\\src\\one.ts'),
      manager.onLanguageOpened('typescriptreact', 'D:\\workspace\\src\\two.tsx'),
    ]);

    expect(invoke.mock.calls.filter(([command]) => command === 'lsp_start')).toHaveLength(1);
    expect(manager.getStatus('typescript')).toBe('ready');

    await manager.stopAll();
    expect(invoke.mock.calls.filter(([command]) => command === 'lsp_stop')).toHaveLength(1);
  });

  it('ignores syntax-only languages without reporting a missing server error', async () => {
    const invoke = vi.fn();
    const manager = new LspManager(invoke, vi.fn());
    const statusChange = vi.fn();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    manager.onStatusChange(statusChange);

    await manager.onLanguageOpened('markdown', 'D:\\workspace\\README.md');

    expect(invoke).not.toHaveBeenCalled();
    expect(statusChange).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it('does not report an error before Monaco mounts and can start afterward', async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'lsp_start') {
        return { server_id: args?.id, root_path: 'D:\\workspace' };
      }
      return undefined;
    });
    const manager = new LspManager(
      invoke,
      vi.fn(async () => () => {}),
    );
    const statusChange = vi.fn();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    manager.setRootUri('file:///d%3A/workspace');
    manager.registerServerConfig({
      id: 'rust',
      languageIds: ['rust'],
      command: 'rust-analyzer',
    });
    manager.onStatusChange(statusChange);

    await manager.onLanguageOpened('rust', 'D:\\workspace\\src\\lib.rs');

    expect(invoke).not.toHaveBeenCalled();
    expect(statusChange).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();

    manager.setMonaco({} as typeof import('monaco-editor'));
    await manager.onLanguageOpened('rust', 'D:\\workspace\\src\\lib.rs');

    expect(invoke.mock.calls.filter(([command]) => command === 'lsp_start')).toHaveLength(1);
    expect(manager.getStatus('rust')).toBe('ready');
    await manager.stopAll();
  });
});

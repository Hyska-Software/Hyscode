import { describe, expect, it, vi } from 'vitest';
import { LspConnection } from './lsp-connection';
import type { LspResponse } from './types';

function createConnection(languageId = 'rust') {
  let handleMessage: ((msg: LspResponse) => void) | undefined;
  const transport = {
    send: vi.fn(),
    onMessage: (handler: (msg: LspResponse) => void) => {
      handleMessage = handler;
    },
    close: vi.fn(),
  };
  const connection = new LspConnection('srv-1', languageId, transport);
  return { connection, transport, respond: (msg: LspResponse) => handleMessage?.(msg) };
}

describe('LspConnection declaration/typeDefinition/implementation', () => {
  it('sends declaration requests with 0-based params', async () => {
    const { connection, transport, respond } = createConnection();
    const pending = connection.declaration('file:///proj/main.rs', 2, 4);

    expect(transport.send).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 1,
      method: 'textDocument/declaration',
      params: {
        textDocument: { uri: 'file:///proj/main.rs' },
        position: { line: 2, character: 4 },
      },
    });

    respond({ jsonrpc: '2.0', id: 1, result: [] });
    await expect(pending).resolves.toEqual([]);
  });

  it('sends typeDefinition and implementation requests', async () => {
    const { connection, transport, respond } = createConnection();

    const typeDefinition = connection.typeDefinition('file:///proj/main.rs', 0, 1);
    expect(transport.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1, method: 'textDocument/typeDefinition' }),
    );
    respond({ jsonrpc: '2.0', id: 1, result: null });

    const implementation = connection.implementation('file:///proj/main.rs', 3, 2);
    expect(transport.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 2, method: 'textDocument/implementation' }),
    );
    respond({ jsonrpc: '2.0', id: 2, result: null });

    await expect(typeDefinition).resolves.toBeNull();
    await expect(implementation).resolves.toBeNull();
  });

  it('advertises linkSupport for declaration, typeDefinition and implementation', async () => {
    const { connection, transport, respond } = createConnection();
    const initialize = connection.initialize('file:///proj');

    const sent = transport.send.mock.calls[0][0] as {
      method: string;
      params: { capabilities: { textDocument: Record<string, { linkSupport?: boolean }> } };
    };
    expect(sent.method).toBe('initialize');
    expect(sent.params.capabilities.textDocument.declaration.linkSupport).toBe(true);
    expect(sent.params.capabilities.textDocument.typeDefinition.linkSupport).toBe(true);
    expect(sent.params.capabilities.textDocument.implementation.linkSupport).toBe(true);

    respond({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: {} },
    });
    await expect(initialize).resolves.toEqual({ capabilities: {} });
  });
});

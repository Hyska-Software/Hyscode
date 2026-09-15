import { describe, expect, it, vi } from 'vitest';
import { MonacoLspAdapter } from './monaco-adapter';
import type { LspConnection } from './lsp-connection';
import type { LocationLink, ServerCapabilities } from './types';

interface RegisteredProvider {
  selector: string;
  provider: Record<string, (...args: unknown[]) => unknown>;
}

function createFakeMonaco() {
  const registrations = new Map<string, RegisteredProvider>();
  const capture =
    (kind: string) =>
    (selector: string, provider: Record<string, (...args: unknown[]) => unknown>) => {
      registrations.set(kind, { selector, provider });
      return { dispose() {} };
    };

  const monaco = {
    languages: {
      registerDefinitionProvider: capture('definition'),
      registerDeclarationProvider: capture('declaration'),
      registerTypeDefinitionProvider: capture('typeDefinition'),
      registerImplementationProvider: capture('implementation'),
      registerInlayHintsProvider: capture('inlayHints'),
      InlayHintKind: { Parameter: 2, Type: 1 },
    },
    Uri: {
      parse: (value: string) => ({ toString: () => value, value }),
    },
    Position: class FakePosition {
      constructor(
        public lineNumber: number,
        public character: number,
      ) {}
    },
    Range: class FakeRange {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
  };

  return { monaco, registrations };
}

function createFakeConnection(
  capabilities: ServerCapabilities,
  responses: Record<string, unknown>,
) {
  const calls: Array<{ method: string; args: number[] }> = [];
  const connection = {
    languageId: 'rust',
    capabilities,
    definition: vi.fn(async (_uri: string, line: number, character: number) => {
      calls.push({ method: 'definition', args: [line, character] });
      return responses.definition ?? null;
    }),
    declaration: vi.fn(async (_uri: string, line: number, character: number) => {
      calls.push({ method: 'declaration', args: [line, character] });
      return responses.declaration ?? null;
    }),
    typeDefinition: vi.fn(async (_uri: string, line: number, character: number) => {
      calls.push({ method: 'typeDefinition', args: [line, character] });
      return responses.typeDefinition ?? null;
    }),
    implementation: vi.fn(async (_uri: string, line: number, character: number) => {
      calls.push({ method: 'implementation', args: [line, character] });
      return responses.implementation ?? null;
    }),
    inlayHints: vi.fn(async () => responses.inlayHints ?? null),
    onNotification: vi.fn(),
  };
  return { connection: connection as unknown as LspConnection, calls };
}

const model = {
  uri: {
    scheme: 'file',
    path: '/proj/main.rs',
    toString: () => 'file:///proj/main.rs',
  },
};
const position = { lineNumber: 3, column: 5 };

describe('MonacoLspAdapter declaration/typeDefinition/implementation', () => {
  it('registers only the providers declared in the server capabilities', () => {
    const { monaco, registrations } = createFakeMonaco();
    const { connection } = createFakeConnection(
      { definitionProvider: true, declarationProvider: true },
      {},
    );

    const adapter = new MonacoLspAdapter(connection, monaco as never);
    adapter.register('rust');

    expect(registrations.has('definition')).toBe(true);
    expect(registrations.has('declaration')).toBe(true);
    expect(registrations.has('typeDefinition')).toBe(false);
    expect(registrations.has('implementation')).toBe(false);
  });

  it('converts Location results and LSP 0-based positions', async () => {
    const { monaco, registrations } = createFakeMonaco();
    const { connection, calls } = createFakeConnection(
      { declarationProvider: true },
      {
        declaration: [
          {
            uri: 'file:///proj/lib.rs',
            range: { start: { line: 9, character: 1 }, end: { line: 9, character: 7 } },
          },
        ],
      },
    );

    const adapter = new MonacoLspAdapter(connection, monaco as never);
    adapter.register('rust');
    const provider = registrations.get('declaration')!;

    const result = (await provider.provider.provideDeclaration(model, position)) as Array<{
      uri: { value: string };
      range: { startLineNumber: number; startColumn: number };
    }>;

    expect(calls).toEqual([{ method: 'declaration', args: [2, 4] }]);
    expect(result).toHaveLength(1);
    expect(result[0].uri.value).toBe('file:///proj/lib.rs');
    expect(result[0].range.startLineNumber).toBe(10);
    expect(result[0].range.startColumn).toBe(2);
  });

  it('prefers targetSelectionRange when the server returns LocationLinks', async () => {
    const { monaco, registrations } = createFakeMonaco();
    const link: LocationLink = {
      targetUri: 'file:///proj/traits.rs',
      targetRange: { start: { line: 1, character: 0 }, end: { line: 40, character: 0 } },
      targetSelectionRange: { start: { line: 5, character: 6 }, end: { line: 5, character: 11 } },
    };
    const { connection } = createFakeConnection(
      { implementationProvider: true },
      { implementation: [link] },
    );

    const adapter = new MonacoLspAdapter(connection, monaco as never);
    adapter.register('rust');
    const provider = registrations.get('implementation')!;

    const result = (await provider.provider.provideImplementation(model, position)) as Array<{
      range: { startLineNumber: number; startColumn: number };
    }>;

    expect(result[0].range.startLineNumber).toBe(6);
    expect(result[0].range.startColumn).toBe(7);
  });

  it('returns an empty list for null results', async () => {
    const { monaco, registrations } = createFakeMonaco();
    const { connection } = createFakeConnection({ typeDefinitionProvider: true }, {});

    const adapter = new MonacoLspAdapter(connection, monaco as never);
    adapter.register('rust');
    const provider = registrations.get('typeDefinition')!;

    const result = await provider.provider.provideTypeDefinition(model, position);
    expect(result).toEqual([]);
  });

  it('sends the visible range with inlay hint requests', async () => {
    const { monaco, registrations } = createFakeMonaco();
    const { connection } = createFakeConnection({ inlayHintProvider: true }, {});
    const adapter = new MonacoLspAdapter(connection, monaco as never);
    adapter.register('rust');
    const provider = registrations.get('inlayHints')!;

    await provider.provider.provideInlayHints(model, {
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 8,
      endColumn: 1,
    });

    expect(connection.inlayHints).toHaveBeenCalledWith('file:///proj/main.rs', {
      start: { line: 1, character: 2 },
      end: { line: 7, character: 0 },
    });
  });

  it('rebuilds canonical uris for models parsed from raw windows paths', async () => {
    const { monaco, registrations } = createFakeMonaco();
    const { connection } = createFakeConnection({ definitionProvider: true }, {});
    const adapter = new MonacoLspAdapter(connection, monaco as never);
    adapter.register('rust');
    const provider = registrations.get('definition')!;
    const windowsModel = {
      uri: {
        scheme: 'D',
        path: '/Lang/SpectraLang\\midend\\src\\lib.rs',
        toString: () => 'D:/Lang/SpectraLang%5Cmidend%5Csrc%5Clib.rs',
      },
    };

    await provider.provider.provideDefinition(windowsModel, position);

    expect(connection.definition).toHaveBeenCalledWith(
      'file:///d%3A/Lang/SpectraLang/midend/src/lib.rs',
      2,
      4,
    );
  });

  it('skips requests for non-file models', async () => {
    const { monaco, registrations } = createFakeMonaco();
    const { connection } = createFakeConnection({ definitionProvider: true }, {});
    const adapter = new MonacoLspAdapter(connection, monaco as never);
    adapter.register('rust');
    const provider = registrations.get('definition')!;
    const historyModel = {
      uri: { scheme: 'history', path: 'abc', toString: () => 'history:abc' },
    };

    const result = await provider.provider.provideDefinition(historyModel, position);

    expect(result).toBeNull();
    expect(connection.definition).not.toHaveBeenCalled();
  });
});

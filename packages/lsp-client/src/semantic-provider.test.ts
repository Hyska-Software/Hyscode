import { describe, expect, it, vi } from 'vitest';
import { MonacoLspAdapter } from './monaco-adapter';
import type { LspConnection } from './lsp-connection';

function createMonacoWithSemantic() {
  const registered: Array<{ kind: string; selector: string }> = [];
  const monaco = {
    languages: {
      registerDocumentSemanticTokensProvider: vi.fn((selector: string, _p: unknown) => {
        registered.push({ kind: 'full', selector });
        return { dispose() {} };
      }),
      registerDocumentRangeSemanticTokensProvider: vi.fn((selector: string, _p: unknown) => {
        registered.push({ kind: 'range', selector });
        return { dispose() {} };
      }),
      registerCompletionItemProvider: () => ({ dispose() {} }),
      registerHoverProvider: () => ({ dispose() {} }),
      CompletionItemKind: { Text: 1 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      DocumentHighlightKind: { Text: 1, Read: 2, Write: 3 },
      InlayHintKind: { Parameter: 2, Type: 1 },
      SymbolKind: { File: 1 },
    },
    Uri: { parse: (v: string) => ({ toString: () => v }) },
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    Position: class {
      constructor(
        public lineNumber: number,
        public column: number,
      ) {}
    },
    editor: { getModels: () => [], setModelMarkers: vi.fn() },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  };
  return { monaco, registered };
}

describe('MonacoLspAdapter semantic tokens', () => {
  it('registers full + range providers when server supports them', () => {
    const { monaco, registered } = createMonacoWithSemantic();
    const connection = {
      languageId: 'rust',
      capabilities: {
        semanticTokensProvider: {
          legend: { tokenTypes: ['namespace', 'type'], tokenModifiers: ['declaration'] },
          full: { delta: true },
          range: true,
        },
      },
      onNotification: vi.fn(),
    } as unknown as LspConnection;
    const adapter = new MonacoLspAdapter(connection, monaco as never);
    adapter.register('rust');
    expect(registered.some((r) => r.kind === 'full' && r.selector === 'rust')).toBe(true);
    expect(registered.some((r) => r.kind === 'range')).toBe(true);
  });

  it('skips semantic registration when unsupported', () => {
    const { monaco, registered } = createMonacoWithSemantic();
    const connection = {
      languageId: 'toml',
      capabilities: {},
      onNotification: vi.fn(),
    } as unknown as LspConnection;
    const adapter = new MonacoLspAdapter(connection, monaco as never);
    adapter.register('toml');
    expect(registered.length).toBe(0);
  });

  it('provides document tokens remapped to canonical legend', async () => {
    const { monaco } = createMonacoWithSemantic();
    let captured: {
      getLegend: () => { tokenTypes: string[]; tokenModifiers: string[] };
      provideDocumentSemanticTokens: (model: unknown, lastId: string | null) => Promise<unknown>;
    } | null = null;
    (
      monaco.languages.registerDocumentSemanticTokensProvider as ReturnType<typeof vi.fn>
    ).mockImplementation((_sel: string, p: typeof captured) => {
      captured = p;
      return { dispose() {} };
    });
    const connection = {
      languageId: 'rust',
      capabilities: {
        semanticTokensProvider: {
          legend: { tokenTypes: ['namespace', 'type'], tokenModifiers: [] },
          full: true,
        },
      },
      semanticTokensFull: vi.fn(async () => ({ resultId: '1', data: [0, 0, 3, 0, 0] })),
      semanticTokensFullDelta: vi.fn(),
      onNotification: vi.fn(),
    } as unknown as LspConnection;
    const adapter = new MonacoLspAdapter(connection, monaco as never);
    adapter.register('rust');
    expect(captured).not.toBeNull();
    const legend = captured!.getLegend();
    expect(legend.tokenTypes).toContain('namespace');
    const model = {
      uri: { scheme: 'file', path: '/a.rs', toString: () => 'file:///a.rs' },
      getValueLength: () => 10,
    };
    const result = (await captured!.provideDocumentSemanticTokens(model, null)) as {
      data: Uint32Array;
      resultId?: string;
    };
    expect(result.data).toBeInstanceOf(Uint32Array);
    expect(result.resultId).toBe('1');
  });
});

import type { LspConnection } from './lsp-connection';
import type { CompletionItem, CompletionList, Hover, Location, LspDiagnostic, DocumentSymbol, InlayHint } from './types';
import { disableNativeTypeScriptValidation, enableNativeTypeScriptValidation } from './language-registry';

type MonacoEditor = typeof import('monaco-editor');

const TSJS_IDS = new Set(['typescript', 'javascript', 'typescriptreact', 'javascriptreact']);

function normalizeUri(u: string): string {
  try {
    return decodeURIComponent(u).replace(/\\/g, '/').toLowerCase();
  } catch {
    return u.replace(/\\/g, '/').toLowerCase();
  }
}

export class MonacoLspAdapter {
  private disposables: Array<{ dispose(): void }> = [];
  private connection: LspConnection;
  private monaco: MonacoEditor;
  private nativeTsDisabled: boolean;

  constructor(connection: LspConnection, monaco: MonacoEditor) {
    this.connection = connection;
    this.monaco = monaco;
    this.nativeTsDisabled = TSJS_IDS.has(connection.languageId);
    if (this.nativeTsDisabled) {
      disableNativeTypeScriptValidation(monaco);
    }
  }

  register(languageId: string) {
    const caps = this.connection.capabilities;
    if (!caps) return;

    if (caps.completionProvider) {
      this.registerCompletionProvider(languageId, caps.completionProvider);
    }
    if (caps.hoverProvider) {
      this.registerHoverProvider(languageId);
    }
    if (caps.definitionProvider) {
      this.registerDefinitionProvider(languageId);
    }
    if (caps.signatureHelpProvider) {
      this.registerSignatureHelpProvider(languageId, caps.signatureHelpProvider);
    }
    if (caps.documentFormattingProvider) {
      this.registerFormattingProvider(languageId);
    }
    if (caps.codeActionProvider) {
      this.registerCodeActionProvider(languageId);
    }
    if (caps.documentSymbolProvider) {
      this.registerDocumentSymbolProvider(languageId);
    }
    if (caps.referencesProvider) {
      this.registerReferencesProvider(languageId);
    }
    if (caps.renameProvider) {
      this.registerRenameProvider(languageId);
    }
    if (caps.documentHighlightProvider) {
      this.registerDocumentHighlightProvider(languageId);
    }
    if (caps.selectionRangeProvider) {
      this.registerSelectionRangeProvider(languageId);
    }
    if (caps.inlayHintProvider) {
      this.registerInlayHintProvider(languageId);
    }
    if (caps.documentRangeFormattingProvider) {
      this.registerRangeFormattingProvider(languageId);
    }

    this.registerDiagnostics();
  }

  private registerCompletionProvider(
    languageId: string,
    options: { triggerCharacters?: string[]; resolveProvider?: boolean },
  ) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: options.triggerCharacters ?? ['.'],
      provideCompletionItems: async (model, position) => {
        const uri = model.uri.toString();
        const result = (await conn.completion(uri, position.lineNumber - 1, position.column - 1)) as
          | CompletionList
          | CompletionItem[]
          | null;

        if (!result) return { suggestions: [] };
        const items = Array.isArray(result) ? result : result.items;

        return {
          suggestions: items.map((item) => {
            let range: import('monaco-editor').IRange | undefined;
            if (item.textEdit) {
              const r = item.textEdit.range;
              range = new monacoRef.Range(
                r.start.line + 1,
                r.start.character + 1,
                r.end.line + 1,
                r.end.character + 1,
              );
            }

            const additionalTextEdits = item.additionalTextEdits?.map((edit) => ({
              range: new monacoRef.Range(
                edit.range.start.line + 1,
                edit.range.start.character + 1,
                edit.range.end.line + 1,
                edit.range.end.character + 1,
              ),
              text: edit.newText,
            }));

            const suggestion: any = {
              label: item.label,
              kind: this.mapCompletionKind(item.kind),
              detail: item.detail,
              documentation: typeof item.documentation === 'string'
                ? item.documentation
                : item.documentation?.value,
              insertText: item.insertText ?? item.label,
              insertTextRules: item.insertTextFormat === 2
                ? monacoRef.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              sortText: item.sortText,
              filterText: item.filterText,
            };
            if (range) suggestion.range = range;
            if (additionalTextEdits) suggestion.additionalTextEdits = additionalTextEdits;
            return suggestion;
          }),
        };
      },
    });
    this.disposables.push(d);
  }

  private registerHoverProvider(languageId: string) {
    const conn = this.connection;
    const d = this.monaco.languages.registerHoverProvider(languageId, {
      provideHover: async (model, position) => {
        const uri = model.uri.toString();
        const result = (await conn.hover(uri, position.lineNumber - 1, position.column - 1)) as Hover | null;
        if (!result) return null;

        const contents = Array.isArray(result.contents)
          ? result.contents
          : [result.contents];

        return {
          contents: contents.map((c) =>
            typeof c === 'string'
              ? { value: c }
              : { value: c.value },
          ),
          range: result.range
            ? new this.monaco.Range(
                result.range.start.line + 1,
                result.range.start.character + 1,
                result.range.end.line + 1,
                result.range.end.character + 1,
              )
            : undefined,
        };
      },
    });
    this.disposables.push(d);
  }

  private registerDefinitionProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerDefinitionProvider(languageId, {
      provideDefinition: async (model, position) => {
        const uri = model.uri.toString();
        const result = (await conn.definition(uri, position.lineNumber - 1, position.column - 1)) as
          | Location
          | Location[]
          | null;

        if (!result) return null;
        const locations = Array.isArray(result) ? result : [result];

        return locations.map((loc) => ({
          uri: monacoRef.Uri.parse(loc.uri),
          range: new monacoRef.Range(
            loc.range.start.line + 1,
            loc.range.start.character + 1,
            loc.range.end.line + 1,
            loc.range.end.character + 1,
          ),
        }));
      },
    });
    this.disposables.push(d);
  }

  private registerSignatureHelpProvider(
    languageId: string,
    options: { triggerCharacters?: string[] },
  ) {
    const conn = this.connection;
    const d = this.monaco.languages.registerSignatureHelpProvider(languageId, {
      signatureHelpTriggerCharacters: options.triggerCharacters ?? ['(', ','],
      provideSignatureHelp: async (model, position) => {
        const uri = model.uri.toString();
        const result = (await conn.signatureHelp(uri, position.lineNumber - 1, position.column - 1)) as {
          signatures: Array<{
            label: string;
            documentation?: string | { kind: string; value: string };
            parameters?: Array<{ label: string | [number, number]; documentation?: string }>;
          }>;
          activeSignature?: number;
          activeParameter?: number;
        } | null;

        if (!result) return null;

        return {
          value: {
            signatures: result.signatures.map((sig) => ({
              label: sig.label,
              documentation: typeof sig.documentation === 'string'
                ? sig.documentation
                : sig.documentation?.value,
              parameters: (sig.parameters ?? []).map((p) => ({
                label: p.label,
                documentation: p.documentation,
              })),
            })),
            activeSignature: result.activeSignature ?? 0,
            activeParameter: result.activeParameter ?? 0,
          },
          dispose: () => {},
        };
      },
    });
    this.disposables.push(d);
  }

  private registerFormattingProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerDocumentFormattingEditProvider(languageId, {
      provideDocumentFormattingEdits: async (model, options) => {
        const uri = model.uri.toString();
        const result = (await conn.formatting(uri, options.tabSize, options.insertSpaces)) as
          | Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }>
          | null;

        if (!result) return [];

        return result.map((edit) => ({
          range: new monacoRef.Range(
            edit.range.start.line + 1,
            edit.range.start.character + 1,
            edit.range.end.line + 1,
            edit.range.end.character + 1,
          ),
          text: edit.newText,
        }));
      },
    });
    this.disposables.push(d);
  }

  private registerCodeActionProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerCodeActionProvider(languageId, {
      provideCodeActions: async (model, range, context) => {
        const uri = model.uri.toString();
        const lspRange = {
          start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
          end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
        };

        const result = (await conn.codeAction(uri, lspRange, context.markers)) as
          | Array<import('./types').CodeAction>
          | null;

        if (!result) return { actions: [], dispose: () => {} };

        return {
          actions: result.map((action) => {
            let edit: import('monaco-editor').languages.WorkspaceEdit | undefined;
            if (action.edit?.changes) {
              const workspaceEdits: import('monaco-editor').languages.IWorkspaceTextEdit[] = [];
              for (const [fileUri, edits] of Object.entries(action.edit.changes)) {
                for (const e of edits) {
                  workspaceEdits.push({
                    resource: monacoRef.Uri.parse(fileUri),
                    versionId: undefined,
                    textEdit: {
                      range: new monacoRef.Range(
                        e.range.start.line + 1,
                        e.range.start.character + 1,
                        e.range.end.line + 1,
                        e.range.end.character + 1,
                      ),
                      text: e.newText,
                    },
                  });
                }
              }
              edit = { edits: workspaceEdits };
            }

            const diagnostics = (action.diagnostics ?? []).map((d) => ({
              severity: this.mapSeverity(d.severity),
              startLineNumber: d.range.start.line + 1,
              startColumn: d.range.start.character + 1,
              endLineNumber: d.range.end.line + 1,
              endColumn: d.range.end.character + 1,
              message: d.message,
              source: d.source,
              code: d.code !== undefined ? String(d.code) : undefined,
            }));

            return {
              title: action.title,
              kind: action.kind,
              diagnostics,
              isPreferred: action.isPreferred ?? false,
              edit,
              command: action.command
                ? {
                    id: action.command.command,
                    title: action.command.title,
                    arguments: action.command.arguments,
                  }
                : undefined,
            };
          }),
          dispose: () => {},
        };
      },
    });
    this.disposables.push(d);
  }

  private registerDocumentSymbolProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerDocumentSymbolProvider(languageId, {
      provideDocumentSymbols: async (model) => {
        const uri = model.uri.toString();
        const result = (await conn.documentSymbol(uri)) as
          | DocumentSymbol[]
          | Array<{
              name: string;
              kind: number;
              location: Location;
              containerName?: string;
            }>
          | null;

        if (!result) return [];

        // Handle hierarchical DocumentSymbol[] directly
        if (result.length > 0 && 'range' in result[0]) {
          return (result as DocumentSymbol[]).map((s) => this.toMonacoDocumentSymbol(s, monacoRef));
        }

        // Flat SymbolInformation[]
        return (result as Array<{ name: string; kind: number; location: Location; containerName?: string }>).map(
          (s) => ({
            name: s.name,
            detail: '',
            kind: this.mapSymbolKind(s.kind),
            containerName: s.containerName,
            tags: [],
            range: new monacoRef.Range(
              s.location.range.start.line + 1,
              s.location.range.start.character + 1,
              s.location.range.end.line + 1,
              s.location.range.end.character + 1,
            ),
            selectionRange: new monacoRef.Range(
              s.location.range.start.line + 1,
              s.location.range.start.character + 1,
              s.location.range.end.line + 1,
              s.location.range.end.character + 1,
            ),
          }),
        ) as any;
      },
    });
    this.disposables.push(d);
  }

  private toMonacoDocumentSymbol(
    s: DocumentSymbol,
    monacoRef: MonacoEditor,
  ): import('monaco-editor').languages.DocumentSymbol {
    return {
      name: s.name,
      detail: s.detail ?? '',
      kind: this.mapSymbolKind(s.kind),
      tags: [],
      range: new monacoRef.Range(
        s.range.start.line + 1,
        s.range.start.character + 1,
        s.range.end.line + 1,
        s.range.end.character + 1,
      ),
      selectionRange: new monacoRef.Range(
        s.selectionRange.start.line + 1,
        s.selectionRange.start.character + 1,
        s.selectionRange.end.line + 1,
        s.selectionRange.end.character + 1,
      ),
      children: s.children?.map((c) => this.toMonacoDocumentSymbol(c, monacoRef)),
    };
  }

  private registerReferencesProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerReferenceProvider(languageId, {
      provideReferences: async (model, position, context) => {
        const uri = model.uri.toString();
        const result = (await conn.references(
          uri,
          position.lineNumber - 1,
          position.column - 1,
          context.includeDeclaration,
        )) as Location[] | null;

        if (!result) return [];

        return result.map((loc) => ({
          uri: monacoRef.Uri.parse(loc.uri),
          range: new monacoRef.Range(
            loc.range.start.line + 1,
            loc.range.start.character + 1,
            loc.range.end.line + 1,
            loc.range.end.character + 1,
          ),
        }));
      },
    });
    this.disposables.push(d);
  }

  private registerRenameProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerRenameProvider(languageId, {
      provideRenameEdits: async (model, position, newName) => {
        const uri = model.uri.toString();
        const result = (await conn.rename(
          uri,
          position.lineNumber - 1,
          position.column - 1,
          newName,
        )) as {
          changes?: Record<string, Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }>>;
        } | null;

        if (!result) return null;

        const edits: any[] = [];
        for (const [fileUri, fileEdits] of Object.entries(result.changes ?? {})) {
          for (const e of fileEdits) {
            edits.push({
              resource: monacoRef.Uri.parse(fileUri),
              versionId: undefined,
              textEdit: {
                range: new monacoRef.Range(
                  e.range.start.line + 1,
                  e.range.start.character + 1,
                  e.range.end.line + 1,
                  e.range.end.character + 1,
                ),
                text: e.newText,
              },
            });
          }
        }

        return { edits } as any;
      },
    });
    this.disposables.push(d);
  }

  private registerDocumentHighlightProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerDocumentHighlightProvider(languageId, {
      provideDocumentHighlights: async (model, position) => {
        const uri = model.uri.toString();
        const result = (await conn.documentHighlight(
          uri,
          position.lineNumber - 1,
          position.column - 1,
        )) as Array<{
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
          kind?: number;
        }> | null;

        if (!result) return [];

        return result.map((h) => ({
          range: new monacoRef.Range(
            h.range.start.line + 1,
            h.range.start.character + 1,
            h.range.end.line + 1,
            h.range.end.character + 1,
          ),
          kind:
            h.kind === 3
              ? monacoRef.languages.DocumentHighlightKind.Write
              : h.kind === 2
                ? monacoRef.languages.DocumentHighlightKind.Read
                : monacoRef.languages.DocumentHighlightKind.Text,
        }));
      },
    });
    this.disposables.push(d);
  }

  private registerSelectionRangeProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerSelectionRangeProvider(languageId, {
      provideSelectionRanges: async (model, positions) => {
        const uri = model.uri.toString();
        const lspPositions = positions.map((p) => ({
          line: p.lineNumber - 1,
          character: p.column - 1,
        }));
        const result = (await conn.selectionRanges(uri, lspPositions)) as Array<{
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
          parent?: { range: { start: { line: number; character: number }; end: { line: number; character: number } } };
        }> | null;

        if (!result) return [];

        const selectionRanges: import('monaco-editor').languages.SelectionRange[][] = result.map((r) => {
          const ranges: import('monaco-editor').Range[] = [
            new monacoRef.Range(
              r.range.start.line + 1,
              r.range.start.character + 1,
              r.range.end.line + 1,
              r.range.end.character + 1,
            ),
          ];
          let parent = r.parent;
          while (parent) {
            ranges.push(
              new monacoRef.Range(
                parent.range.start.line + 1,
                parent.range.start.character + 1,
                parent.range.end.line + 1,
                parent.range.end.character + 1,
              ),
            );
            parent = (parent as { parent?: typeof parent }).parent;
          }
          return ranges.map((range) => ({ range }));
        });

        return selectionRanges;
      },
    });
    this.disposables.push(d);
  }

  private registerInlayHintProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerInlayHintsProvider(languageId, {
      provideInlayHints: async (model) => {
        const uri = model.uri.toString();
        const result = (await conn.inlayHints(uri)) as InlayHint[] | null;

        if (!result) return { hints: [], dispose: () => {} };

        const hints = result.map((h) => ({
          position: new monacoRef.Position(h.position.line + 1, h.position.character + 1),
          label:
            typeof h.label === 'string'
              ? h.label
              : h.label.map((l) => l.value).join(''),
          kind: h.kind === 2 ? monacoRef.languages.InlayHintKind.Parameter : monacoRef.languages.InlayHintKind.Type,
          paddingLeft: h.paddingLeft,
          paddingRight: h.paddingRight,
        }));

        return { hints, dispose: () => {} };
      },
    });
    this.disposables.push(d);
  }

  private registerRangeFormattingProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, {
      provideDocumentRangeFormattingEdits: async (model, range, options) => {
        const uri = model.uri.toString();
        const lspRange = {
          start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
          end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
        };
        const result = (await conn.rangeFormatting(uri, lspRange, options.tabSize, options.insertSpaces)) as
          | Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }>
          | null;

        if (!result) return [];

        return result.map((edit) => ({
          range: new monacoRef.Range(
            edit.range.start.line + 1,
            edit.range.start.character + 1,
            edit.range.end.line + 1,
            edit.range.end.character + 1,
          ),
          text: edit.newText,
        }));
      },
    });
    this.disposables.push(d);
  }

  private registerDiagnostics() {
    this.connection.onNotification('textDocument/publishDiagnostics', (params) => {
      const { uri, diagnostics } = params as { uri: string; diagnostics: LspDiagnostic[] };
      const targetUri = normalizeUri(uri);
      const model = this.monaco.editor.getModels().find((m) => normalizeUri(m.uri.toString()) === targetUri);
      if (!model) return;

      const markers = diagnostics.map((d) => ({
        severity: this.mapSeverity(d.severity),
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        message: d.message,
        source: d.source,
        code: d.code !== undefined ? String(d.code) : undefined,
      }));

      this.monaco.editor.setModelMarkers(model, `lsp-${this.connection.languageId}`, markers);
    });
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    if (this.nativeTsDisabled) {
      enableNativeTypeScriptValidation(this.monaco);
    }
  }

  private mapCompletionKind(kind?: number): import('monaco-editor').languages.CompletionItemKind {
    const map: Record<number, import('monaco-editor').languages.CompletionItemKind> = {
      1: this.monaco.languages.CompletionItemKind.Text,
      2: this.monaco.languages.CompletionItemKind.Method,
      3: this.monaco.languages.CompletionItemKind.Function,
      4: this.monaco.languages.CompletionItemKind.Constructor,
      5: this.monaco.languages.CompletionItemKind.Field,
      6: this.monaco.languages.CompletionItemKind.Variable,
      7: this.monaco.languages.CompletionItemKind.Class,
      8: this.monaco.languages.CompletionItemKind.Interface,
      9: this.monaco.languages.CompletionItemKind.Module,
      10: this.monaco.languages.CompletionItemKind.Property,
      13: this.monaco.languages.CompletionItemKind.Enum,
      14: this.monaco.languages.CompletionItemKind.Keyword,
      15: this.monaco.languages.CompletionItemKind.Snippet,
      21: this.monaco.languages.CompletionItemKind.Constant,
      22: this.monaco.languages.CompletionItemKind.Struct,
    };
    return map[kind ?? 1] ?? this.monaco.languages.CompletionItemKind.Text;
  }

  private mapSeverity(severity?: number): import('monaco-editor').MarkerSeverity {
    switch (severity) {
      case 1: return this.monaco.MarkerSeverity.Error;
      case 2: return this.monaco.MarkerSeverity.Warning;
      case 3: return this.monaco.MarkerSeverity.Info;
      case 4: return this.monaco.MarkerSeverity.Hint;
      default: return this.monaco.MarkerSeverity.Info;
    }
  }

  private mapSymbolKind(kind?: number): import('monaco-editor').languages.SymbolKind {
    const map: Record<number, import('monaco-editor').languages.SymbolKind> = {
      1: this.monaco.languages.SymbolKind.File,
      2: this.monaco.languages.SymbolKind.Module,
      3: this.monaco.languages.SymbolKind.Namespace,
      4: this.monaco.languages.SymbolKind.Package,
      5: this.monaco.languages.SymbolKind.Class,
      6: this.monaco.languages.SymbolKind.Method,
      7: this.monaco.languages.SymbolKind.Property,
      8: this.monaco.languages.SymbolKind.Field,
      9: this.monaco.languages.SymbolKind.Constructor,
      10: this.monaco.languages.SymbolKind.Enum,
      11: this.monaco.languages.SymbolKind.Interface,
      12: this.monaco.languages.SymbolKind.Function,
      13: this.monaco.languages.SymbolKind.Variable,
      14: this.monaco.languages.SymbolKind.Constant,
      15: this.monaco.languages.SymbolKind.String,
      16: this.monaco.languages.SymbolKind.Number,
      17: this.monaco.languages.SymbolKind.Boolean,
      18: this.monaco.languages.SymbolKind.Array,
      19: this.monaco.languages.SymbolKind.Object,
      20: this.monaco.languages.SymbolKind.Key,
      21: this.monaco.languages.SymbolKind.Null,
      22: this.monaco.languages.SymbolKind.EnumMember,
      23: this.monaco.languages.SymbolKind.Struct,
      24: this.monaco.languages.SymbolKind.Event,
      25: this.monaco.languages.SymbolKind.Operator,
      26: this.monaco.languages.SymbolKind.TypeParameter,
    };
    return map[kind ?? 1] ?? this.monaco.languages.SymbolKind.File;
  }
}

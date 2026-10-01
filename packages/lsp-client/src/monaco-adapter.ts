import type { LspConnection } from './lsp-connection';
import type {
  CompletionItem,
  CompletionList,
  Hover,
  Location,
  LocationLink,
  LspDiagnostic,
  LspRange,
  DocumentSymbol,
  InlayHint,
  SemanticTokensDeltaResponse,
  SemanticTokensFullResponse,
  SemanticTokensProviderOptions,
} from './types';
import {
  disableNativeTypeScriptValidation,
  enableNativeTypeScriptValidation,
} from './language-registry';
import { documentUriFromModelUri } from './uri';
import {
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  remapSemanticTokensToLegend,
  toMonacoSemanticEdits,
} from './semantic-tokens';

type MonacoEditor = typeof import('monaco-editor');

const TSJS_IDS = new Set(['typescript', 'javascript', 'typescriptreact', 'javascriptreact']);

function normalizeUri(u: string): string {
  // Compare URIs by slash-normalized, percent-decoding form. Do NOT
  // lowercase: file paths on Linux/macOS are case-sensitive and lowercasing
  // breaks model matching for mixed-case paths.
  try {
    return decodeURIComponent(u).replace(/\\/g, '/');
  } catch {
    return u.replace(/\\/g, '/');
  }
}

/** Schemes we accept from LSP responses. Anything else (http:, javascript:,
 *  data:, …) is ignored so a malicious server can't drive Monaco to
 *  external/unsafe resources. */
const ALLOWED_URI_SCHEMES = new Set(['file', 'untitled', 'vscode-remote']);

function safeParseUri(monacoRef: MonacoEditor, uri: string): import('monaco-editor').Uri | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(uri);
  const scheme = match?.[1]?.toLowerCase() ?? '';
  if (!ALLOWED_URI_SCHEMES.has(scheme)) return null;
  try {
    return monacoRef.Uri.parse(uri);
  } catch {
    return null;
  }
}

function toMonacoRange(range: LspRange, monacoRef: MonacoEditor): import('monaco-editor').Range {
  return new monacoRef.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

/**
 * Convert any LSP location-ish result (Location, Location[], LocationLink or
 * LocationLink[]) into Monaco locations. LocationLinks use
 * `targetSelectionRange` for the cursor target, falling back to `targetRange`.
 */
function toMonacoLocations(
  result: Location | Location[] | LocationLink | LocationLink[] | null | undefined,
  monacoRef: MonacoEditor,
): import('monaco-editor').languages.Location[] {
  if (!result) return [];
  const entries: Array<Location | LocationLink> = Array.isArray(result) ? result : [result];
  const locations: import('monaco-editor').languages.Location[] = [];
  for (const entry of entries) {
    if ('targetUri' in entry) {
      const selectionRange = entry.targetSelectionRange ?? entry.targetRange;
      const uri = safeParseUri(monacoRef, entry.targetUri);
      if (!uri) continue;
      locations.push({ uri, range: toMonacoRange(selectionRange, monacoRef) });
    } else {
      const uri = safeParseUri(monacoRef, entry.uri);
      if (!uri) continue;
      locations.push({ uri, range: toMonacoRange(entry.range, monacoRef) });
    }
  }
  return locations;
}

export class MonacoLspAdapter {
  private disposables: Array<{ dispose(): void }> = [];
  private connection: LspConnection;
  private monaco: MonacoEditor;
  private nativeTsDisabled: boolean;
  /** LanguageIds already registered — register() is idempotent per language. */
  private registeredLanguages = new Set<string>();
  /** Disposer for the publishDiagnostics notification handler. */
  private diagnosticsDisposer: (() => void) | null = null;

  constructor(connection: LspConnection, monaco: MonacoEditor) {
    this.connection = connection;
    this.monaco = monaco;
    this.nativeTsDisabled = TSJS_IDS.has(connection.languageId);
    if (this.nativeTsDisabled) {
      disableNativeTypeScriptValidation(monaco);
    }
  }

  register(languageId: string) {
    // Idempotency: LspManager registers both the normalized server key and
    // the original languageId — skip repeats so Monaco providers (and the
    // diagnostics handler) are never installed twice.
    if (this.registeredLanguages.has(languageId)) return;
    this.registeredLanguages.add(languageId);
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
    if (caps.declarationProvider) {
      this.registerDeclarationProvider(languageId);
    }
    if (caps.typeDefinitionProvider) {
      this.registerTypeDefinitionProvider(languageId);
    }
    if (caps.implementationProvider) {
      this.registerImplementationProvider(languageId);
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
    if (caps.semanticTokensProvider) {
      this.registerSemanticTokensProvider(languageId, caps.semanticTokensProvider);
    }

    this.registerDiagnostics();
  }

  /**
   * Run an LSP request, logging and falling back instead of rejecting into
   * Monaco (an unhandled provider rejection breaks completions/hover until
   * reload and spams the console with uncaught errors).
   */
  private async safeRequest<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[MonacoLspAdapter:${this.connection.languageId}] ${label} failed:`, err);
      return fallback;
    }
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
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return { suggestions: [] };
        const result = await this.safeRequest(
          'completion',
          null as CompletionList | CompletionItem[] | null,
          () =>
            conn.completion(uri, position.lineNumber - 1, position.column - 1) as Promise<
              CompletionList | CompletionItem[] | null
            >,
        );

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

            const suggestion: import('monaco-editor').languages.CompletionItem = {
              label: item.label,
              kind: this.mapCompletionKind(item.kind),
              detail: item.detail,
              documentation:
                typeof item.documentation === 'string'
                  ? item.documentation
                  : item.documentation?.value,
              insertText: item.insertText ?? item.label,
              insertTextRules:
                item.insertTextFormat === 2
                  ? monacoRef.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
              sortText: item.sortText,
              filterText: item.filterText,
              range:
                range ??
                new monacoRef.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                ),
            };
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
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return null;
        const result = await this.safeRequest(
          'hover',
          null as Hover | null,
          () =>
            conn.hover(uri, position.lineNumber - 1, position.column - 1) as Promise<Hover | null>,
        );
        if (!result) return null;

        const contents = Array.isArray(result.contents) ? result.contents : [result.contents];

        return {
          contents: contents.map((c) =>
            typeof c === 'string' ? { value: c } : { value: c.value },
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
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return null;
        const result = await this.safeRequest(
          'definition',
          null as Location | Location[] | LocationLink | LocationLink[] | null,
          () =>
            conn.definition(uri, position.lineNumber - 1, position.column - 1) as Promise<
              Location | Location[] | LocationLink | LocationLink[] | null
            >,
        );

        return toMonacoLocations(result, monacoRef);
      },
    });
    this.disposables.push(d);
  }

  private registerDeclarationProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerDeclarationProvider(languageId, {
      provideDeclaration: async (model, position) => {
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return null;
        const result = await this.safeRequest(
          'declaration',
          null as Location | Location[] | LocationLink | LocationLink[] | null,
          () =>
            conn.declaration(uri, position.lineNumber - 1, position.column - 1) as Promise<
              Location | Location[] | LocationLink | LocationLink[] | null
            >,
        );

        return toMonacoLocations(result, monacoRef);
      },
    });
    this.disposables.push(d);
  }

  private registerTypeDefinitionProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerTypeDefinitionProvider(languageId, {
      provideTypeDefinition: async (model, position) => {
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return null;
        const result = await this.safeRequest(
          'typeDefinition',
          null as Location | Location[] | LocationLink | LocationLink[] | null,
          () =>
            conn.typeDefinition(uri, position.lineNumber - 1, position.column - 1) as Promise<
              Location | Location[] | LocationLink | LocationLink[] | null
            >,
        );

        return toMonacoLocations(result, monacoRef);
      },
    });
    this.disposables.push(d);
  }

  private registerImplementationProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerImplementationProvider(languageId, {
      provideImplementation: async (model, position) => {
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return null;
        const result = await this.safeRequest(
          'implementation',
          null as Location | Location[] | LocationLink | LocationLink[] | null,
          () =>
            conn.implementation(uri, position.lineNumber - 1, position.column - 1) as Promise<
              Location | Location[] | LocationLink | LocationLink[] | null
            >,
        );

        return toMonacoLocations(result, monacoRef);
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
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return null;
        type SigHelp = {
          signatures: Array<{
            label: string;
            documentation?: string | { kind: string; value: string };
            parameters?: Array<{ label: string | [number, number]; documentation?: string }>;
          }>;
          activeSignature?: number;
          activeParameter?: number;
        } | null;
        const result = await this.safeRequest(
          'signatureHelp',
          null as SigHelp,
          () =>
            conn.signatureHelp(
              uri,
              position.lineNumber - 1,
              position.column - 1,
            ) as Promise<SigHelp>,
        );

        if (!result) return null;

        return {
          value: {
            signatures: result.signatures.map((sig) => ({
              label: sig.label,
              documentation:
                typeof sig.documentation === 'string'
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
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return [];
        type FmtEdits = Array<{
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          newText: string;
        }> | null;
        const result = await this.safeRequest(
          'formatting',
          null as FmtEdits,
          () => conn.formatting(uri, options.tabSize, options.insertSpaces) as Promise<FmtEdits>,
        );

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
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return { actions: [], dispose: () => {} };
        const lspRange = {
          start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
          end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
        };

        const result = await this.safeRequest(
          'codeAction',
          null as Array<import('./types').CodeAction> | null,
          () =>
            conn.codeAction(uri, lspRange, context.markers) as Promise<Array<
              import('./types').CodeAction
            > | null>,
        );

        if (!result) return { actions: [], dispose: () => {} };

        return {
          actions: result.map((action) => {
            let edit: import('monaco-editor').languages.WorkspaceEdit | undefined;
            if (action.edit?.changes) {
              const workspaceEdits: import('monaco-editor').languages.IWorkspaceTextEdit[] = [];
              for (const [fileUri, edits] of Object.entries(action.edit.changes)) {
                const resource = safeParseUri(monacoRef, fileUri);
                if (!resource) continue;
                for (const e of edits) {
                  workspaceEdits.push({
                    resource,
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
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return [];
        type DocSyms =
          | DocumentSymbol[]
          | Array<{ name: string; kind: number; location: Location; containerName?: string }>
          | null;
        const result = await this.safeRequest(
          'documentSymbol',
          null as DocSyms,
          () => conn.documentSymbol(uri) as Promise<DocSyms>,
        );

        if (!result) return [];

        // Handle hierarchical DocumentSymbol[] directly
        if (result.length > 0 && 'range' in result[0]) {
          return (result as DocumentSymbol[]).map((s) => this.toMonacoDocumentSymbol(s, monacoRef));
        }

        // Flat SymbolInformation[]
        return (
          result as Array<{
            name: string;
            kind: number;
            location: Location;
            containerName?: string;
          }>
        ).map((s): import('monaco-editor').languages.DocumentSymbol => ({
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
        })) as unknown as import('monaco-editor').languages.DocumentSymbol[];
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
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return [];
        const result = await this.safeRequest(
          'references',
          null as Location[] | null,
          () =>
            conn.references(
              uri,
              position.lineNumber - 1,
              position.column - 1,
              context.includeDeclaration,
            ) as Promise<Location[] | null>,
        );

        if (!result) return [];

        const locations: import('monaco-editor').languages.Location[] = [];
        for (const loc of result) {
          const locUri = safeParseUri(monacoRef, loc.uri);
          if (!locUri) continue;
          locations.push({
            uri: locUri,
            range: new monacoRef.Range(
              loc.range.start.line + 1,
              loc.range.start.character + 1,
              loc.range.end.line + 1,
              loc.range.end.character + 1,
            ),
          });
        }
        return locations;
      },
    });
    this.disposables.push(d);
  }

  private registerRenameProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerRenameProvider(languageId, {
      provideRenameEdits: async (model, position, newName) => {
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return null;
        type RenameResult = {
          changes?: Record<
            string,
            Array<{
              range: {
                start: { line: number; character: number };
                end: { line: number; character: number };
              };
              newText: string;
            }>
          >;
        } | null;
        const result = await this.safeRequest(
          'rename',
          null as RenameResult,
          () =>
            conn.rename(
              uri,
              position.lineNumber - 1,
              position.column - 1,
              newName,
            ) as Promise<RenameResult>,
        );

        if (!result) return null;

        const edits: import('monaco-editor').languages.IWorkspaceTextEdit[] = [];
        for (const [fileUri, fileEdits] of Object.entries(result.changes ?? {})) {
          const resource = safeParseUri(monacoRef, fileUri);
          if (!resource) continue;
          for (const e of fileEdits) {
            edits.push({
              resource,
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

        return { edits } as unknown as import('monaco-editor').languages.WorkspaceEdit;
      },
    });
    this.disposables.push(d);
  }

  private registerDocumentHighlightProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerDocumentHighlightProvider(languageId, {
      provideDocumentHighlights: async (model, position) => {
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return [];
        type Hl = Array<{
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          kind?: number;
        }> | null;
        const result = await this.safeRequest(
          'documentHighlight',
          null as Hl,
          () =>
            conn.documentHighlight(
              uri,
              position.lineNumber - 1,
              position.column - 1,
            ) as Promise<Hl>,
        );

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
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return [];
        const lspPositions = positions.map((p) => ({
          line: p.lineNumber - 1,
          character: p.column - 1,
        }));
        type SelRanges = Array<{
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          parent?: {
            range: {
              start: { line: number; character: number };
              end: { line: number; character: number };
            };
          };
        }> | null;
        const result = await this.safeRequest(
          'selectionRanges',
          null as SelRanges,
          () => conn.selectionRanges(uri, lspPositions) as Promise<SelRanges>,
        );

        if (!result) return [];

        const selectionRanges: import('monaco-editor').languages.SelectionRange[][] = result.map(
          (r) => {
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
          },
        );

        return selectionRanges;
      },
    });
    this.disposables.push(d);
  }

  private registerInlayHintProvider(languageId: string) {
    const conn = this.connection;
    const monacoRef = this.monaco;
    const d = this.monaco.languages.registerInlayHintsProvider(languageId, {
      provideInlayHints: async (model, range) => {
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return { hints: [], dispose: () => {} };
        const lspRange = {
          start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
          end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
        };
        const result = await this.safeRequest(
          'inlayHints',
          null as InlayHint[] | null,
          () => conn.inlayHints(uri, lspRange) as Promise<InlayHint[] | null>,
        );

        if (!result) return { hints: [], dispose: () => {} };

        const hints = result.map((h) => ({
          position: new monacoRef.Position(h.position.line + 1, h.position.character + 1),
          label: typeof h.label === 'string' ? h.label : h.label.map((l) => l.value).join(''),
          kind:
            h.kind === 2
              ? monacoRef.languages.InlayHintKind.Parameter
              : monacoRef.languages.InlayHintKind.Type,
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
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return [];
        const lspRange = {
          start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
          end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
        };
        type RangeEdits = Array<{
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          newText: string;
        }> | null;
        const result = await this.safeRequest(
          'rangeFormatting',
          null as RangeEdits,
          () =>
            conn.rangeFormatting(
              uri,
              lspRange,
              options.tabSize,
              options.insertSpaces,
            ) as Promise<RangeEdits>,
        );

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

  private registerSemanticTokensProvider(
    languageId: string,
    options: SemanticTokensProviderOptions,
  ) {
    const conn = this.connection;
    const serverTypes =
      options.legend.tokenTypes.length > 0 ? options.legend.tokenTypes : SEMANTIC_TOKEN_TYPES;
    const serverModifiers =
      options.legend.tokenModifiers.length > 0
        ? options.legend.tokenModifiers
        : SEMANTIC_TOKEN_MODIFIERS;
    const supportsDelta =
      typeof options.full === 'object' ? options.full.delta === true : options.full === true;
    const supportsRange = Boolean(options.range);

    const legend = { tokenTypes: SEMANTIC_TOKEN_TYPES, tokenModifiers: SEMANTIC_TOKEN_MODIFIERS };

    const toMonacoData = (data: number[] | undefined): Uint32Array | null => {
      if (!data || data.length === 0) return new Uint32Array(0);
      // Guard against truncated payloads (must be a multiple of 5).
      if (data.length % 5 !== 0) return null;
      try {
        return remapSemanticTokensToLegend(data, serverTypes, serverModifiers);
      } catch {
        return null;
      }
    };

    const fullProvider: import('monaco-editor').languages.DocumentSemanticTokensProvider = {
      getLegend: () => legend,
      provideDocumentSemanticTokens: async (model, lastResultId) => {
        const uri = documentUriFromModelUri(model.uri);
        if (!uri) return null;
        // Skip huge files — semantic tokens on multi-MB buffers stall the UI.
        if (model.getValueLength() > 1_000_000) return null;

        if (lastResultId && supportsDelta) {
          const delta = await this.safeRequest(
            'semanticTokensDelta',
            null as unknown as SemanticTokensFullResponse | SemanticTokensDeltaResponse | null,
            () =>
              conn.semanticTokensFullDelta(uri, lastResultId) as Promise<
                SemanticTokensFullResponse | SemanticTokensDeltaResponse | null
              >,
          );
          if (!delta) return null;
          if ('edits' in delta && Array.isArray((delta as SemanticTokensDeltaResponse).edits)) {
            const d = delta as SemanticTokensDeltaResponse;
            return {
              resultId: d.resultId,
              edits: toMonacoSemanticEdits(d.edits, serverTypes, serverModifiers),
            };
          }
          const full = delta as SemanticTokensFullResponse;
          const data = toMonacoData(full.data);
          if (!data) return null;
          return { resultId: full.resultId, data };
        }

        const result = await this.safeRequest(
          'semanticTokens',
          null as SemanticTokensFullResponse | null,
          () => conn.semanticTokensFull(uri) as Promise<SemanticTokensFullResponse | null>,
        );
        if (!result) return null;
        const data = toMonacoData(result.data);
        if (!data) return null;
        return { resultId: result.resultId, data };
      },
      releaseDocumentSemanticTokens: () => {},
    };

    try {
      const langs = this.monaco.languages as unknown as {
        registerDocumentSemanticTokensProvider?: (
          selector: string,
          provider: unknown,
        ) => { dispose(): void };
        registerDocumentRangeSemanticTokensProvider?: (
          selector: string,
          provider: unknown,
        ) => { dispose(): void };
      };
      if (typeof langs.registerDocumentSemanticTokensProvider === 'function') {
        this.disposables.push(
          langs.registerDocumentSemanticTokensProvider(languageId, fullProvider),
        );
      }
      if (
        supportsRange &&
        typeof langs.registerDocumentRangeSemanticTokensProvider === 'function'
      ) {
        const rangeProvider: import('monaco-editor').languages.DocumentRangeSemanticTokensProvider =
          {
            getLegend: () => legend,
            provideDocumentRangeSemanticTokens: async (model, range) => {
              const uri = documentUriFromModelUri(model.uri);
              if (!uri) return null;
              if (model.getValueLength() > 1_000_000) return null;
              const lspRange = {
                start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
              };
              const result = await this.safeRequest(
                'semanticTokensRange',
                null as SemanticTokensFullResponse | null,
                () =>
                  conn.semanticTokensRange(
                    uri,
                    lspRange,
                  ) as Promise<SemanticTokensFullResponse | null>,
              );
              if (!result) return null;
              const data = toMonacoData(result.data);
              if (!data) return null;
              return { resultId: result.resultId, data };
            },
          };
        this.disposables.push(
          langs.registerDocumentRangeSemanticTokensProvider(languageId, rangeProvider),
        );
      }
    } catch (err) {
      console.warn(
        `[MonacoLspAdapter:${this.connection.languageId}] semanticTokens registration failed:`,
        err,
      );
    }
  }

  private registerDiagnostics() {
    if (this.diagnosticsDisposer) return;
    this.diagnosticsDisposer = this.connection.onNotification(
      'textDocument/publishDiagnostics',
      (params) => {
        const { uri, diagnostics } = params as { uri: string; diagnostics: LspDiagnostic[] };
        const targetUri = normalizeUri(uri);
        const model = this.monaco.editor
          .getModels()
          .find((m) => normalizeUri(m.uri.toString()) === targetUri);
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
      },
    );
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    if (this.diagnosticsDisposer) {
      this.diagnosticsDisposer();
      this.diagnosticsDisposer = null;
    } else {
      // Fallback for handlers registered before the disposer API existed.
      this.connection.removeNotificationHandler('textDocument/publishDiagnostics');
    }
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
      11: this.monaco.languages.CompletionItemKind.Unit,
      12: this.monaco.languages.CompletionItemKind.Value,
      13: this.monaco.languages.CompletionItemKind.Enum,
      14: this.monaco.languages.CompletionItemKind.Keyword,
      15: this.monaco.languages.CompletionItemKind.Snippet,
      16: this.monaco.languages.CompletionItemKind.Color,
      17: this.monaco.languages.CompletionItemKind.File,
      18: this.monaco.languages.CompletionItemKind.Reference,
      19: this.monaco.languages.CompletionItemKind.Folder,
      20: this.monaco.languages.CompletionItemKind.EnumMember,
      21: this.monaco.languages.CompletionItemKind.Constant,
      22: this.monaco.languages.CompletionItemKind.Struct,
      23: this.monaco.languages.CompletionItemKind.Event,
      24: this.monaco.languages.CompletionItemKind.Operator,
      25: this.monaco.languages.CompletionItemKind.TypeParameter,
    };
    return map[kind ?? 1] ?? this.monaco.languages.CompletionItemKind.Text;
  }

  private mapSeverity(severity?: number): import('monaco-editor').MarkerSeverity {
    switch (severity) {
      case 1:
        return this.monaco.MarkerSeverity.Error;
      case 2:
        return this.monaco.MarkerSeverity.Warning;
      case 3:
        return this.monaco.MarkerSeverity.Info;
      case 4:
        return this.monaco.MarkerSeverity.Hint;
      default:
        return this.monaco.MarkerSeverity.Error;
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

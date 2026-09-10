/**
 * Pure helpers for the editor context menu.
 *
 * Kept free of React/Tauri/Monaco imports so every function is unit-testable
 * in plain Node. The component in `components/editor/editor-context-menu.tsx`
 * is a thin wiring layer over these helpers.
 */

// ── Path helpers ─────────────────────────────────────────────────────────────

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * Directory portion of an absolute file path, using `/` separators.
 * Returns `null` for untitled buffers, bare filenames without a directory,
 * or empty input. Falls back to `rootPath` when the file itself has no
 * directory component but a workspace is open.
 */
export function dirnameOf(filePath: string, rootPath: string | null): string | null {
  if (!filePath || filePath.startsWith('untitled:')) return null;
  const normalized = normalizeSlashes(filePath);
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) {
    // No directory component (e.g. `C:` or bare name) — use workspace root.
    return rootPath ? normalizeSlashes(rootPath) : null;
  }
  const dir = normalized.slice(0, idx);
  // Guard against degenerate results such as `C:` (drive without slash).
  if (/^[a-zA-Z]:$/.test(dir)) return `${dir}/`;
  return dir || null;
}

/**
 * Workspace-relative path for use with git backend commands.
 * Returns `null` when the file is outside the workspace (absolute path that
 * does not start with `rootPath`) or when inputs are missing/untitled.
 * The backend also accepts absolute in-worktree paths, but a relative path
 * is the canonical contract for `git_log_file` / `git_commit_file_diff`.
 */
export function toRepoRelativePath(
  filePath: string,
  rootPath: string | null,
): string | null {
  if (!filePath || !rootPath) return null;
  if (filePath.startsWith('untitled:')) return null;
  const file = normalizeSlashes(filePath);
  const root = stripTrailingSlash(normalizeSlashes(rootPath));
  if (!file.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null;
  const rel = file.slice(root.length + 1);
  return rel || null;
}

// ── Clipboard text helpers ───────────────────────────────────────────────────

export interface EditorSelectionLike {
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
}

export interface EditorPositionLike {
  lineNumber: number;
  column: number;
}

/** True when the selection covers at least one character. */
export function hasNonEmptySelection(sel: EditorSelectionLike | null | undefined): boolean {
  if (!sel) return false;
  return (
    sel.startLineNumber !== sel.endLineNumber || sel.startColumn !== sel.endColumn
  );
}

/** Trim trailing whitespace per line and surrounding blank lines. */
export function trimSelectionText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * `filePath:line` label, extended with a `:startCol-endLine:endCol` range
 * when a non-empty selection exists. Used by "Copy Path with Line".
 */
export function buildPathWithLine(
  filePath: string,
  pos: EditorPositionLike | null | undefined,
  sel: EditorSelectionLike | null | undefined,
): string {
  if (hasNonEmptySelection(sel)) {
    const s = sel as EditorSelectionLike;
    if (s.startLineNumber === s.endLineNumber) {
      return `${filePath}:${s.startLineNumber}:${s.startColumn}-${s.endColumn}`;
    }
    return `${filePath}:${s.startLineNumber}:${s.startColumn}-${s.endLineNumber}:${s.endColumn}`;
  }
  return `${filePath}:${pos?.lineNumber ?? 1}`;
}

// ── Extension `when`-clause evaluation ───────────────────────────────────────

/**
 * Minimal evaluator for the `when` field of `ExtensionContextMenuItem`.
 *
 * Supported (case-insensitive, `&&`-joined) clauses:
 * - `editorHasSelection` / `!editorHasSelection`
 * - `resourceLangId == <lang>` / `resourceLangId != <lang>`
 * - `editorLangId == <lang>` / `editorLangId != <lang>` (alias)
 *
 * Unknown clauses evaluate to `true` so legacy extensions that use
 * unsupported keys stay visible instead of silently disappearing.
 */
export function evaluateWhenClause(
  when: string | undefined,
  context: { hasSelection: boolean; languageId: string },
): boolean {
  if (!when || !when.trim()) return true;
  const clauses = when.split('&&').map((c) => c.trim());
  for (const raw of clauses) {
    let clause = raw;
    let negated = false;
    if (clause.startsWith('!')) {
      negated = true;
      clause = clause.slice(1).trim();
    }
    const lower = clause.toLowerCase();
    let result: boolean | null = null;
    if (lower === 'editorhasselection') {
      result = context.hasSelection;
    } else {
      const match = clause.match(/^(?:resourceLangId|editorLangId)\s*(==|!=)\s*([A-Za-z0-9#+_-]+)$/i);
      if (match) {
        const equals = match[1] === '==';
        const same =
          match[2].toLowerCase() === (context.languageId ?? '').toLowerCase();
        result = equals ? same : !same;
      }
    }
    if (result === null) continue;
    if (negated ? result : !result) return false;
  }
  return true;
}

// ── Extension item grouping ──────────────────────────────────────────────────

export type ExtensionMenuGroup = 'navigation' | 'modification' | 'formatting' | 'other';

export const EXTENSION_GROUP_ORDER: ExtensionMenuGroup[] = [
  'navigation',
  'modification',
  'formatting',
  'other',
];

export interface ExtensionMenuItemLike {
  extensionName: string;
  item: {
    id: string;
    label: string;
    group?: string;
    order?: number;
    when?: string;
  };
}

function normalizeGroup(group: string | undefined): ExtensionMenuGroup {
  if (group === 'navigation' || group === 'modification' || group === 'formatting') {
    return group;
  }
  return 'other';
}

/**
 * Filter extension items by `when`-clause, sort by `order` (default 50),
 * and bucket them by `group` in canonical display order. Only non-empty
 * groups are returned, preserving `EXTENSION_GROUP_ORDER`.
 */
export function groupExtensionItems<T extends ExtensionMenuItemLike>(
  items: T[],
  context: { hasSelection: boolean; languageId: string },
): Array<{ group: ExtensionMenuGroup; items: T[] }> {
  const visible = items.filter((reg) => evaluateWhenClause(reg.item.when, context));
  const buckets = new Map<ExtensionMenuGroup, T[]>();
  for (const reg of visible) {
    const group = normalizeGroup(reg.item.group);
    const bucket = buckets.get(group);
    if (bucket) bucket.push(reg);
    else buckets.set(group, [reg]);
  }
  const result: Array<{ group: ExtensionMenuGroup; items: T[] }> = [];
  for (const group of EXTENSION_GROUP_ORDER) {
    const bucket = buckets.get(group);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort((a, b) => (a.item.order ?? 50) - (b.item.order ?? 50));
    result.push({ group, items: bucket });
  }
  return result;
}

// ── LSP capability helper ────────────────────────────────────────────────────

/**
 * Languages where Monaco's built-in TypeScript/JavaScript worker already
 * provides definition, references, rename and quick fixes, so navigation
 * actions stay enabled even when no LSP server is running.
 */
export const NATIVE_INTELLISENSE_LANGUAGES: ReadonlySet<string> = new Set([
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
]);

/**
 * Navigation / rename / quick-fix actions need either a ready LSP server
 * for the language or Monaco's native TS/JS intelligence.
 */
export function isLspActionAvailable(
  lspLanguage: string | null | undefined,
  lspStatus: string | undefined,
): boolean {
  if (!lspLanguage) return false;
  if (NATIVE_INTELLISENSE_LANGUAGES.has(lspLanguage)) return true;
  return lspStatus === 'ready';
}

// ── Per-action LSP availability ──────────────────────────────────────────────

/** Structural subset of `ServerCapabilities` used for menu gating. */
export interface LspCapabilitiesLike {
  definitionProvider?: unknown;
  declarationProvider?: unknown;
  typeDefinitionProvider?: unknown;
  implementationProvider?: unknown;
  referencesProvider?: unknown;
  renameProvider?: unknown;
  codeActionProvider?: unknown;
  documentSymbolProvider?: unknown;
}

export interface LspActionAvailability {
  definition: boolean;
  /** True when the server exposes a real declaration provider. */
  declaration: boolean;
  /** True when declaration is unavailable but definition can be used instead. */
  declarationFallback: boolean;
  typeDefinition: boolean;
  implementation: boolean;
  references: boolean;
  rename: boolean;
  codeAction: boolean;
  documentSymbol: boolean;
}

/**
 * Actions Monaco's built-in TS/JS worker provides without any LSP server.
 * Declaration is intentionally absent: the worker has no declaration provider.
 */
const NATIVE_ACTION_SUPPORT: ReadonlySet<keyof LspCapabilitiesLike> = new Set([
  'definitionProvider',
  'typeDefinitionProvider',
  'implementationProvider',
  'referencesProvider',
  'renameProvider',
  'codeActionProvider',
  'documentSymbolProvider',
]);

function capabilityDeclared(
  capabilities: LspCapabilitiesLike | null | undefined,
  key: keyof LspCapabilitiesLike,
): boolean {
  const value = capabilities?.[key];
  return value !== undefined && value !== null && value !== false;
}

/**
 * Resolve which intellisense actions are actually backed by a provider:
 * either a capability-declaring, ready LSP server or the native TS/JS worker.
 */
export function getLspActionAvailability(
  lspLanguage: string | null | undefined,
  lspStatus: string | undefined,
  capabilities: LspCapabilitiesLike | null | undefined,
): LspActionAvailability {
  const native = !!lspLanguage && NATIVE_INTELLISENSE_LANGUAGES.has(lspLanguage);
  const ready = lspStatus === 'ready';

  const lsp = (key: keyof LspCapabilitiesLike): boolean =>
    ready && capabilityDeclared(capabilities, key);

  const supported = (key: keyof LspCapabilitiesLike): boolean =>
    (native && NATIVE_ACTION_SUPPORT.has(key)) || lsp(key);

  const definition = supported('definitionProvider');
  const declaration = lsp('declarationProvider');
  const typeDefinition = supported('typeDefinitionProvider');
  const implementation = supported('implementationProvider');

  return {
    definition,
    declaration,
    declarationFallback: !declaration && definition,
    typeDefinition,
    implementation,
    references: supported('referencesProvider'),
    rename: supported('renameProvider'),
    codeAction: supported('codeActionProvider'),
    documentSymbol: supported('documentSymbolProvider'),
  };
}

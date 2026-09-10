import { describe, expect, it } from 'vitest';
import {
  dirnameOf,
  toRepoRelativePath,
  hasNonEmptySelection,
  trimSelectionText,
  buildPathWithLine,
  evaluateWhenClause,
  groupExtensionItems,
  isLspActionAvailable,
  getLspActionAvailability,
} from './editor-context-menu-utils';

describe('dirnameOf', () => {
  it('returns the directory of a windows path', () => {
    expect(dirnameOf('C:\\proj\\src\\app.ts', 'C:\\proj')).toBe('C:/proj/src');
  });

  it('returns the directory of a posix path', () => {
    expect(dirnameOf('/home/u/proj/app.ts', '/home/u/proj')).toBe('/home/u/proj');
  });

  it('returns null for untitled buffers', () => {
    expect(dirnameOf('untitled:1', 'C:\\proj')).toBeNull();
  });

  it('falls back to the workspace root for bare filenames', () => {
    expect(dirnameOf('app.ts', 'C:\\proj')).toBe('C:/proj');
  });

  it('returns null when there is no directory and no workspace', () => {
    expect(dirnameOf('app.ts', null)).toBeNull();
  });
});

describe('toRepoRelativePath', () => {
  it('computes a workspace-relative path', () => {
    expect(toRepoRelativePath('C:\\proj\\src\\a.ts', 'C:\\proj')).toBe('src/a.ts');
  });

  it('tolerates a trailing slash on the root', () => {
    expect(toRepoRelativePath('C:/proj/src/a.ts', 'C:/proj/')).toBe('src/a.ts');
  });

  it('returns null for files outside the workspace', () => {
    expect(toRepoRelativePath('D:\\other\\a.ts', 'C:\\proj')).toBeNull();
  });

  it('returns null for untitled buffers or missing root', () => {
    expect(toRepoRelativePath('untitled:1', 'C:\\proj')).toBeNull();
    expect(toRepoRelativePath('C:\\proj\\a.ts', null)).toBeNull();
  });
});

describe('hasNonEmptySelection', () => {
  it('detects collapsed vs ranged selections', () => {
    expect(
      hasNonEmptySelection({ startLineNumber: 1, endLineNumber: 1, startColumn: 2, endColumn: 2 }),
    ).toBe(false);
    expect(
      hasNonEmptySelection({ startLineNumber: 1, endLineNumber: 1, startColumn: 2, endColumn: 5 }),
    ).toBe(true);
    expect(
      hasNonEmptySelection({ startLineNumber: 1, endLineNumber: 3, startColumn: 1, endColumn: 1 }),
    ).toBe(true);
    expect(hasNonEmptySelection(null)).toBe(false);
    expect(hasNonEmptySelection(undefined)).toBe(false);
  });
});

describe('trimSelectionText', () => {
  it('trims trailing whitespace per line and blank edges', () => {
    expect(trimSelectionText('  hello   \n\tworld\t\n\n')).toBe('hello\n\tworld');
  });
});

describe('buildPathWithLine', () => {
  it('builds path:line without a selection', () => {
    expect(buildPathWithLine('C:/a.ts', { lineNumber: 12, column: 4 }, null)).toBe('C:/a.ts:12');
  });

  it('builds a same-line range with a selection', () => {
    expect(
      buildPathWithLine(
        'C:/a.ts',
        { lineNumber: 1, column: 1 },
        { startLineNumber: 3, endLineNumber: 3, startColumn: 2, endColumn: 9 },
      ),
    ).toBe('C:/a.ts:3:2-9');
  });

  it('builds a multi-line range with a selection', () => {
    expect(
      buildPathWithLine(
        'C:/a.ts',
        { lineNumber: 1, column: 1 },
        { startLineNumber: 3, endLineNumber: 5, startColumn: 2, endColumn: 4 },
      ),
    ).toBe('C:/a.ts:3:2-5:4');
  });
});

describe('evaluateWhenClause', () => {
  const ctx = { hasSelection: true, languageId: 'typescript' };

  it('shows items without a clause', () => {
    expect(evaluateWhenClause(undefined, ctx)).toBe(true);
    expect(evaluateWhenClause('', ctx)).toBe(true);
  });

  it('evaluates editorHasSelection', () => {
    expect(evaluateWhenClause('editorHasSelection', ctx)).toBe(true);
    expect(evaluateWhenClause('editorHasSelection', { ...ctx, hasSelection: false })).toBe(false);
    expect(evaluateWhenClause('!editorHasSelection', { ...ctx, hasSelection: false })).toBe(true);
  });

  it('evaluates resourceLangId comparisons', () => {
    expect(evaluateWhenClause('resourceLangId == typescript', ctx)).toBe(true);
    expect(evaluateWhenClause('resourceLangId != typescript', ctx)).toBe(false);
    expect(evaluateWhenClause('resourceLangId == rust', ctx)).toBe(false);
  });

  it('treats editorLangId as an alias of resourceLangId', () => {
    expect(evaluateWhenClause('editorLangId == typescript', ctx)).toBe(true);
    expect(evaluateWhenClause('editorLangId != typescript', ctx)).toBe(false);
    expect(evaluateWhenClause('editorLangId == go', ctx)).toBe(false);
    expect(evaluateWhenClause('editorLangId != go', ctx)).toBe(true);
  });

  it('supports && combinations and ignores unknown clauses', () => {
    expect(
      evaluateWhenClause('editorHasSelection && resourceLangId == typescript', ctx),
    ).toBe(true);
    expect(
      evaluateWhenClause('editorHasSelection && resourceLangId == rust', ctx),
    ).toBe(false);
    expect(evaluateWhenClause('someFutureClause == x', ctx)).toBe(true);
  });
});

describe('groupExtensionItems', () => {
  const make = (id: string, order?: number, group?: string, when?: string) => ({
    extensionName: 'ext',
    item: { id, label: id, order, group, when },
  });

  it('filters by when-clause, sorts by order and buckets by group', () => {
    const groups = groupExtensionItems(
      [
        make('b-other', 20),
        make('a-other', 5),
        make('nav', 1, 'navigation'),
        make('hidden', 1, 'navigation', 'editorHasSelection'),
      ],
      { hasSelection: false, languageId: 'typescript' },
    );
    expect(groups.map((g) => g.group)).toEqual(['navigation', 'other']);
    expect(groups[0].items.map((i) => i.item.id)).toEqual(['nav']);
    expect(groups[1].items.map((i) => i.item.id)).toEqual(['a-other', 'b-other']);
  });

  it('normalizes unknown groups to other', () => {
    const groups = groupExtensionItems([make('x', 1, 'nonsense')], {
      hasSelection: false,
      languageId: 'plaintext',
    });
    expect(groups.map((g) => g.group)).toEqual(['other']);
  });
});

describe('isLspActionAvailable', () => {
  it('is always available for native TS/JS intelligence', () => {
    expect(isLspActionAvailable('typescript', undefined)).toBe(true);
    expect(isLspActionAvailable('javascriptreact', 'stopped')).toBe(true);
  });

  it('requires a ready server for other languages', () => {
    expect(isLspActionAvailable('rust', 'ready')).toBe(true);
    expect(isLspActionAvailable('rust', 'starting')).toBe(false);
    expect(isLspActionAvailable('rust', undefined)).toBe(false);
    expect(isLspActionAvailable(null, 'ready')).toBe(false);
  });
});

describe('getLspActionAvailability', () => {
  it('enables native TS/JS actions without any server', () => {
    const availability = getLspActionAvailability('typescript', undefined, undefined);
    expect(availability.definition).toBe(true);
    expect(availability.typeDefinition).toBe(true);
    expect(availability.implementation).toBe(true);
    expect(availability.references).toBe(true);
    expect(availability.rename).toBe(true);
    expect(availability.codeAction).toBe(true);
    expect(availability.documentSymbol).toBe(true);
    // The TS worker has no declaration provider — the menu falls back to definition.
    expect(availability.declaration).toBe(false);
    expect(availability.declarationFallback).toBe(true);
  });

  it('gates each action by its own server capability', () => {
    const availability = getLspActionAvailability('rust', 'ready', {
      definitionProvider: true,
      referencesProvider: true,
    });
    expect(availability.definition).toBe(true);
    expect(availability.references).toBe(true);
    expect(availability.typeDefinition).toBe(false);
    expect(availability.implementation).toBe(false);
    expect(availability.rename).toBe(false);
    expect(availability.codeAction).toBe(false);
    expect(availability.declaration).toBe(false);
    expect(availability.declarationFallback).toBe(true);
  });

  it('keeps everything disabled while the server is not ready', () => {
    const availability = getLspActionAvailability('rust', 'starting', {
      definitionProvider: true,
      declarationProvider: true,
    });
    expect(availability.definition).toBe(false);
    expect(availability.declaration).toBe(false);
    expect(availability.declarationFallback).toBe(false);
  });

  it('returns no fallback when the server provides neither declaration nor definition', () => {
    const availability = getLspActionAvailability('rust', 'ready', {
      referencesProvider: true,
    });
    expect(availability.definition).toBe(false);
    expect(availability.declarationFallback).toBe(false);
  });
});

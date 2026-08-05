import { describe, expect, it } from 'vitest';
import { mergeDiagnostics } from './diagnostics-merge';
import type { DiagnosticContract } from './diagnostics-types';

const editorDiagnostic = (overrides: Partial<DiagnosticContract> = {}): DiagnosticContract => ({
  file: 'C:/Workspace/src/app.ts',
  line: 3,
  col: 4,
  severity: 'error',
  message: 'The buffer is invalid.',
  source: 'lsp',
  ...overrides,
});

const compilerDiagnostic = (overrides: Partial<DiagnosticContract> = {}): DiagnosticContract => ({
  file: 'C:/Workspace/src/app.ts',
  line: 3,
  col: 4,
  severity: 'error',
  message: 'The disk version is invalid.',
  source: 'typescript',
  ...overrides,
});

describe('diagnostic merge', () => {
  it('gives an open buffer precedence over stale compiler output', () => {
    const merged = mergeDiagnostics(
      [editorDiagnostic()],
      [compilerDiagnostic()],
      ['c:/workspace/src/app.ts'],
      'C:/Workspace/src/app.ts',
    );

    expect(merged).toEqual([editorDiagnostic()]);
  });

  it('suppresses stale compiler output for open files in a global query', () => {
    const merged = mergeDiagnostics(
      [editorDiagnostic({ file: 'C:/Workspace/src/open.ts' })],
      [
        compilerDiagnostic({ file: 'C:/Workspace/src/open.ts' }),
        compilerDiagnostic({ file: 'C:/Workspace/src/closed.ts', message: 'Closed file error.' }),
      ],
      ['C:/Workspace/src/open.ts'],
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.file)).toEqual([
      'C:/Workspace/src/closed.ts',
      'C:/Workspace/src/open.ts',
    ]);
  });

  it('returns no compiler result for an open buffer with no current markers', () => {
    const merged = mergeDiagnostics(
      [],
      [compilerDiagnostic()],
      ['C:/Workspace/src/app.ts'],
      'c:/workspace/src/app.ts',
    );

    expect(merged).toEqual([]);
  });

  it('deduplicates equal diagnostics and sorts by file and position', () => {
    const duplicate = compilerDiagnostic({ line: 8 });
    const merged = mergeDiagnostics(
      [duplicate],
      [duplicate, compilerDiagnostic({ file: 'C:/Workspace/src/other.ts', line: 1 })],
      [],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].file).toBe('C:/Workspace/src/app.ts');
    expect(merged[1].file).toBe('C:/Workspace/src/other.ts');
  });
});

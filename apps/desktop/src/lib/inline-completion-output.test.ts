import { describe, expect, it } from 'vitest';
import { normalizeInlineCompletion } from './inline-completion-output';

describe('normalizeInlineCompletion', () => {
  it('preserves meaningful indentation and trailing newlines', () => {
    expect(
      normalizeInlineCompletion({
        rawText: '  return value;\n',
        prefix: 'function run() {\n',
        suffix: '}',
      }),
    ).toEqual({ status: 'ready', text: '  return value;\n' });
  });

  it('removes a complete markdown fence without trimming code', () => {
    expect(
      normalizeInlineCompletion({
        rawText: '```typescript\n  return value;\n```',
        prefix: '',
        suffix: '',
      }),
    ).toEqual({ status: 'ready', text: '  return value;' });
  });

  it('removes duplicated prefix and suffix overlap', () => {
    expect(
      normalizeInlineCompletion({
        rawText: 'foo();\n',
        prefix: 'const value = fo',
        suffix: '\n',
      }),
    ).toEqual({ status: 'ready', text: 'o();' });
  });

  it('never returns an incomplete fence or whitespace-only output', () => {
    expect(
      normalizeInlineCompletion({ rawText: '```typescript\nreturn value;', prefix: '', suffix: '' }),
    ).toEqual({ status: 'empty', text: '' });
    expect(normalizeInlineCompletion({ rawText: ' \n\t', prefix: '', suffix: '' })).toEqual({
      status: 'empty',
      text: '',
    });
  });
});

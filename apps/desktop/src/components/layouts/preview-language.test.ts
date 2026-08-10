import { describe, expect, it } from 'vitest';
import { detectPreviewLanguage } from './preview-language';

describe('Preview Monaco language detection', () => {
  it.each([
    ['components/code-console.tsx', 'typescript'],
    ['components/button.jsx', 'javascript'],
    ['config.json', 'json'],
  ])('maps %s to the Monaco tokenizer language %s', (filePath, expectedLanguage) => {
    expect(detectPreviewLanguage(filePath)).toBe(expectedLanguage);
  });

  it('falls back to plaintext for unknown extensions', () => {
    expect(detectPreviewLanguage('notes.unknown')).toBe('plaintext');
  });
});

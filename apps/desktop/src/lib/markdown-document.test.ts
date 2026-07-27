import { describe, expect, it } from 'vitest';
import {
  getImageMimeType,
  resolveMarkdownLink,
  slugifyMarkdownHeading,
} from './markdown-document';

const ROOT = 'C:\\workspace';
const DOCUMENT = 'C:\\workspace\\docs\\guide.md';

describe('Markdown document links', () => {
  it('resolves nested workspace files and decoded anchors', () => {
    expect(resolveMarkdownLink('../README.md#Getting%20Started', DOCUMENT, ROOT)).toEqual({
      kind: 'workspace',
      path: 'C:/workspace/README.md',
      anchor: 'Getting Started',
    });
  });

  it('resolves root-relative paths from the workspace root', () => {
    expect(resolveMarkdownLink('/assets/logo.png', DOCUMENT, ROOT)).toEqual({
      kind: 'workspace',
      path: 'C:/workspace/assets/logo.png',
      anchor: null,
    });
  });

  it('classifies anchors and supported external protocols', () => {
    expect(resolveMarkdownLink('#API%20Reference', DOCUMENT, ROOT)).toEqual({
      kind: 'anchor',
      anchor: 'API Reference',
    });
    expect(resolveMarkdownLink('https://example.com/docs', DOCUMENT, ROOT)).toEqual({
      kind: 'external',
      url: 'https://example.com/docs',
    });
    expect(resolveMarkdownLink('mailto:team@example.com', DOCUMENT, ROOT)).toEqual({
      kind: 'external',
      url: 'mailto:team@example.com',
    });
  });

  it('blocks traversal, malformed encoding and unsupported protocols', () => {
    expect(resolveMarkdownLink('../../../secret.txt', DOCUMENT, ROOT)).toEqual({
      kind: 'blocked',
    });
    expect(resolveMarkdownLink('%E0%A4%A', DOCUMENT, ROOT)).toEqual({ kind: 'blocked' });
    expect(resolveMarkdownLink('javascript:alert(1)', DOCUMENT, ROOT)).toEqual({
      kind: 'blocked',
    });
    expect(resolveMarkdownLink('file:///C:/Windows/System32/drivers/etc/hosts', DOCUMENT, ROOT)).toEqual({
      kind: 'blocked',
    });
  });
});

describe('Markdown document presentation helpers', () => {
  it('creates stable accent-insensitive heading slugs', () => {
    expect(slugifyMarkdownHeading('  Configuração da API!  ')).toBe('configuracao-da-api');
  });

  it('recognizes supported local image types only', () => {
    expect(getImageMimeType('diagram.SVG')).toBe('image/svg+xml');
    expect(getImageMimeType('photo.webp')).toBe('image/webp');
    expect(getImageMimeType('notes.txt')).toBeNull();
  });
});


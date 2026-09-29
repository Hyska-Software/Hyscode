import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  decodeSemanticTokens,
  remapSemanticTokensToLegend,
  resolveCanonicalTokenType,
} from './semantic-tokens';

describe('semantic-tokens legend', () => {
  it('covers VS Code parity types for all supported languages', () => {
    for (const t of [
      'namespace',
      'type',
      'class',
      'function',
      'method',
      'macro',
      'decorator',
      'parameter',
      'variable',
      'property',
    ]) {
      expect(SEMANTIC_TOKEN_TYPES).toContain(t);
    }
    for (const m of ['declaration', 'readonly', 'static', 'async']) {
      expect(SEMANTIC_TOKEN_MODIFIERS).toContain(m);
    }
  });

  it('resolves aliases without collapsing richness', () => {
    expect(resolveCanonicalTokenType('class')).toBe('class');
    expect(resolveCanonicalTokenType('decorator')).toBe('decorator');
    expect(resolveCanonicalTokenType('member')).toBe('property');
    expect(resolveCanonicalTokenType('totally-unknown')).toBe('variable');
  });

  it('decodes LSP relative encoding to absolute positions', () => {
    // Two tokens: (0,0,len5,type0) and (0,6,len3,type1)
    const decoded = decodeSemanticTokens([0, 0, 5, 0, 0, 0, 6, 3, 1, 0], ['namespace', 'type'], []);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({ line: 0, character: 0, length: 5, type: 'namespace' });
    expect(decoded[1]).toMatchObject({ line: 0, character: 6, length: 3, type: 'type' });
  });

  it('decodes modifiers as bitset', () => {
    const decoded = decodeSemanticTokens(
      [0, 0, 4, 0, 0b101],
      ['function'],
      ['declaration', 'static', 'async'],
    );
    expect(decoded[0].modifiers).toEqual(['declaration', 'async']);
  });

  it('remaps server legend to canonical legend for Monaco', () => {
    const serverTypes = ['namespace', 'type'];
    const data = [0, 0, 3, 0, 0, 0, 4, 5, 1, 0];
    const out = remapSemanticTokensToLegend(data, serverTypes, []);
    expect(out).toBeInstanceOf(Uint32Array);
    expect(out.length).toBe(10);
    // type indices must resolve inside our canonical legend
    expect(out[3]).toBe(SEMANTIC_TOKEN_TYPES.indexOf('namespace'));
    expect(out[8]).toBe(SEMANTIC_TOKEN_TYPES.indexOf('type'));
  });

  it('ignores truncated payloads safely', () => {
    const decoded = decodeSemanticTokens([0, 0, 5], ['namespace'], []);
    expect(decoded).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { defineAllMonacoThemes, getMonacoThemeName } from './monaco-themes';

// Canonical tokens that must be styled in every theme for VS Code parity.
const REQUIRED_TOKENS = [
  'comment',
  'keyword',
  'string',
  'number',
  'type',
  'namespace',
  'class',
  'struct',
  'enum',
  'interface',
  'function',
  'method',
  'macro',
  'decorator',
  'annotation',
  'parameter',
  'property',
  'variable',
  'constant',
  'operator',
  'delimiter',
];

const THEME_IDS = [
  'hyscode-dark',
  'aura',
  'hyscode-light',
  'nord',
  'monokai',
  'dracula',
  'github-dark',
];

function createMonacoCapture() {
  const defined = new Map<
    string,
    { rules: Array<{ token: string }>; colors: Record<string, string> }
  >();
  const monaco = {
    editor: {
      defineTheme: (
        name: string,
        def: { rules: Array<{ token: string }>; colors: Record<string, string> },
      ) => {
        defined.set(name, def);
      },
    },
  };
  return { monaco, defined };
}

describe('monaco-themes VS Code parity', () => {
  it('maps every settings themeId to a Monaco theme', () => {
    for (const id of THEME_IDS) {
      expect(getMonacoThemeName(id)).toMatch(/^hyscode-/);
    }
  });

  it('defines every required token in every built-in theme', () => {
    const { monaco, defined } = createMonacoCapture();
    defineAllMonacoThemes(monaco as never);
    expect(defined.size).toBeGreaterThanOrEqual(7);
    for (const [, def] of defined) {
      const tokens = new Set(def.rules.map((r) => r.token));
      for (const required of REQUIRED_TOKENS) {
        expect(tokens.has(required)).toBe(true);
      }
    }
  });
});

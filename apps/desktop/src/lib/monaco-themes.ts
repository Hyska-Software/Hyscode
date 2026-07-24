// ─── Monaco Theme Definitions ────────────────────────────────────────────────
// Defines all application themes for Monaco Editor instances.
// Each theme maps to the corresponding CSS theme class in app.css.
// Supports runtime registration of custom themes from extensions.

import type * as Monaco from 'monaco-editor';
import type { ThemeDefinition, TokenColorRule } from '@hyscode/extension-api';

type MonacoInstance = typeof Monaco;

interface ThemeDef {
  base: 'vs' | 'vs-dark';
  rules: Monaco.editor.ITokenThemeRule[];
  colors: Record<string, string>;
}

const THEMES: Record<string, ThemeDef> = {
  'hyscode-dark': {
    base: 'vs-dark',
    rules: [
      { token: 'comment', foreground: '8e8ea0', fontStyle: 'italic' },
      { token: 'keyword', foreground: '2fb28f' },
      { token: 'keyword.control', foreground: '2fb28f' },
      { token: 'string', foreground: '86efac' },
      { token: 'number', foreground: 'e3b341' },
      { token: 'type', foreground: '60a5fa' },
      { token: 'type.identifier', foreground: '60a5fa' },
      { token: 'function', foreground: '5cc6a8' },
      { token: 'variable', foreground: 'ececf1' },
      { token: 'operator', foreground: 'ececf1' },
      { token: 'delimiter', foreground: '8e8ea0' },
      { token: 'tag', foreground: '2fb28f' },
      { token: 'attribute.name', foreground: '60a5fa' },
      { token: 'attribute.value', foreground: '86efac' },
      { token: 'regexp', foreground: 'e3b341' },
    ],
    colors: {
      'editor.background': '#202123',
      'editor.foreground': '#ececf1',
      'editorLineNumber.foreground': '#5a5b66',
      'editorLineNumber.activeForeground': '#8e8ea0',
      'editor.selectionBackground': '#10a37f33',
      'editor.lineHighlightBackground': '#ffffff08',
      'editorCursor.foreground': '#10a37f',
      'editorIndentGuide.background': '#2f3037',
      'editorIndentGuide.activeBackground': '#3a3b44',
      'editorBracketMatch.background': '#10a37f22',
      'editorBracketMatch.border': '#10a37f44',
      'editor.wordHighlightBackground': '#10a37f18',
      'editorWidget.background': '#2a2b32',
      'editorWidget.border': '#3a3b44',
      'input.background': '#2a2b32',
      'input.foreground': '#ececf1',
      'input.border': '#3a3b44',
      'minimap.background': '#1a1b1f',
      'minimap.selectionHighlight': '#10a37f55',
      'minimapGutter.addedBackground': '#3fb950',
      'minimapGutter.modifiedBackground': '#e3b341',
      'minimapGutter.deletedBackground': '#f85149',
      'editorOverviewRuler.addedForeground': '#3fb95088',
      'editorOverviewRuler.modifiedForeground': '#e3b34188',
      'editorOverviewRuler.deletedForeground': '#f8514988',
      'editorGhostText.foreground': '#8e8ea0',
      'editorGhostText.border': '#5a5b66',
      'editorInlineSuggest.foreground': '#8e8ea0',
      'scrollbarSlider.background': '#10a37f22',
      'scrollbarSlider.hoverBackground': '#10a37f44',
      'scrollbarSlider.activeBackground': '#10a37f66',
    },
  },

  'hyscode-light': {
    base: 'vs',
    rules: [
      { token: 'comment', foreground: '6e6e80', fontStyle: 'italic' },
      { token: 'keyword', foreground: '0d8a6c' },
      { token: 'keyword.control', foreground: '0d8a6c' },
      { token: 'string', foreground: '16a34a' },
      { token: 'number', foreground: 'd97706' },
      { token: 'type', foreground: '1d4ed8' },
      { token: 'type.identifier', foreground: '1d4ed8' },
      { token: 'function', foreground: '0d8a6c' },
      { token: 'variable', foreground: '0d0d0f' },
      { token: 'operator', foreground: '374151' },
      { token: 'delimiter', foreground: '6e6e80' },
      { token: 'tag', foreground: '0d8a6c' },
      { token: 'attribute.name', foreground: '1d4ed8' },
      { token: 'attribute.value', foreground: '16a34a' },
      { token: 'regexp', foreground: 'd97706' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#0d0d0f',
      'editorLineNumber.foreground': '#c0c0c0',
      'editorLineNumber.activeForeground': '#6e6e80',
      'editor.selectionBackground': '#0d8a6c22',
      'editor.lineHighlightBackground': '#f5f5f5',
      'editorCursor.foreground': '#0d8a6c',
      'editorIndentGuide.background': '#e8e8e8',
      'editorIndentGuide.activeBackground': '#d0d0d0',
      'editorBracketMatch.background': '#0d8a6c22',
      'editorBracketMatch.border': '#0d8a6c44',
      'editor.wordHighlightBackground': '#0d8a6c18',
      'editorWidget.background': '#f5f5f5',
      'editorWidget.border': '#e0e0e0',
      'input.background': '#ffffff',
      'input.foreground': '#0d0d0f',
      'input.border': '#e0e0e0',
      'minimap.background': '#fafafa',
      'minimap.selectionHighlight': '#0d8a6c44',
      'minimapGutter.addedBackground': '#22c55e',
      'minimapGutter.modifiedBackground': '#eab308',
      'minimapGutter.deletedBackground': '#ef4444',
      'editorOverviewRuler.addedForeground': '#22c55e88',
      'editorOverviewRuler.modifiedForeground': '#eab30888',
      'editorOverviewRuler.deletedForeground': '#ef444488',
      'editorGhostText.foreground': '#9ca3af',
      'editorGhostText.border': '#d1d5db',
      'editorInlineSuggest.foreground': '#9ca3af',
      'scrollbarSlider.background': '#0d8a6c18',
      'scrollbarSlider.hoverBackground': '#0d8a6c30',
      'scrollbarSlider.activeBackground': '#0d8a6c48',
    },
  },

  'hyscode-nord': {
    base: 'vs-dark',
    rules: [
      { token: 'comment', foreground: '636e82', fontStyle: 'italic' },
      { token: 'keyword', foreground: '81a1c1' },
      { token: 'keyword.control', foreground: '81a1c1' },
      { token: 'string', foreground: 'a3be8c' },
      { token: 'number', foreground: 'b48ead' },
      { token: 'type', foreground: '88c0d0' },
      { token: 'type.identifier', foreground: '8fbcbb' },
      { token: 'function', foreground: '88c0d0' },
      { token: 'variable', foreground: 'd8dee9' },
      { token: 'operator', foreground: '81a1c1' },
      { token: 'delimiter', foreground: 'a0a8b7' },
      { token: 'tag', foreground: '81a1c1' },
      { token: 'attribute.name', foreground: '8fbcbb' },
      { token: 'attribute.value', foreground: 'a3be8c' },
      { token: 'regexp', foreground: 'ebcb8b' },
    ],
    colors: {
      'editor.background': '#2e3440',
      'editor.foreground': '#d8dee9',
      'editorLineNumber.foreground': '#4c566a',
      'editorLineNumber.activeForeground': '#d8dee9',
      'editor.selectionBackground': '#88c0d033',
      'editor.lineHighlightBackground': '#3b425208',
      'editorCursor.foreground': '#88c0d0',
      'editorIndentGuide.background': '#3b4252',
      'editorIndentGuide.activeBackground': '#4c566a',
      'editorBracketMatch.background': '#88c0d022',
      'editorBracketMatch.border': '#88c0d044',
      'editor.wordHighlightBackground': '#88c0d018',
      'editorWidget.background': '#3b4252',
      'editorWidget.border': '#4c566a',
      'input.background': '#3b4252',
      'input.foreground': '#d8dee9',
      'input.border': '#4c566a',
      'minimap.background': '#292e39',
      'minimap.selectionHighlight': '#88c0d044',
      'minimapGutter.addedBackground': '#a3be8c',
      'minimapGutter.modifiedBackground': '#ebcb8b',
      'minimapGutter.deletedBackground': '#bf616a',
      'editorOverviewRuler.addedForeground': '#a3be8c88',
      'editorOverviewRuler.modifiedForeground': '#ebcb8b88',
      'editorOverviewRuler.deletedForeground': '#bf616a88',
      'editorGhostText.foreground': '#7b88a1',
      'editorGhostText.border': '#4c566a',
      'editorInlineSuggest.foreground': '#7b88a1',
      'scrollbarSlider.background': '#4c566a55',
      'scrollbarSlider.hoverBackground': '#4c566a88',
      'scrollbarSlider.activeBackground': '#4c566aaa',
    },
  },

  'hyscode-monokai': {
    base: 'vs-dark',
    rules: [
      { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'f92672' },
      { token: 'keyword.control', foreground: 'f92672' },
      { token: 'string', foreground: 'e6db74' },
      { token: 'number', foreground: 'ae81ff' },
      { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
      { token: 'type.identifier', foreground: 'a6e22e' },
      { token: 'function', foreground: 'a6e22e' },
      { token: 'variable', foreground: 'f8f8f2' },
      { token: 'operator', foreground: 'f92672' },
      { token: 'delimiter', foreground: '8f908a' },
      { token: 'tag', foreground: 'f92672' },
      { token: 'attribute.name', foreground: 'a6e22e' },
      { token: 'attribute.value', foreground: 'e6db74' },
      { token: 'regexp', foreground: 'e6db74' },
    ],
    colors: {
      'editor.background': '#272822',
      'editor.foreground': '#f8f8f2',
      'editorLineNumber.foreground': '#4e4f47',
      'editorLineNumber.activeForeground': '#8f908a',
      'editor.selectionBackground': '#f9267233',
      'editor.lineHighlightBackground': '#2d2e2708',
      'editorCursor.foreground': '#f8f8f0',
      'editorIndentGuide.background': '#3e3d32',
      'editorIndentGuide.activeBackground': '#4e4d42',
      'editorBracketMatch.background': '#f9267222',
      'editorBracketMatch.border': '#f9267244',
      'editor.wordHighlightBackground': '#f9267218',
      'editorWidget.background': '#2d2e27',
      'editorWidget.border': '#3e3d32',
      'input.background': '#2d2e27',
      'input.foreground': '#f8f8f2',
      'input.border': '#3e3d32',
      'minimap.background': '#1e1f1c',
      'minimap.selectionHighlight': '#f9267244',
      'minimapGutter.addedBackground': '#a6e22e',
      'minimapGutter.modifiedBackground': '#e6db74',
      'minimapGutter.deletedBackground': '#f92672',
      'editorOverviewRuler.addedForeground': '#a6e22e88',
      'editorOverviewRuler.modifiedForeground': '#e6db7488',
      'editorOverviewRuler.deletedForeground': '#f9267288',
      'editorGhostText.foreground': '#75715e',
      'editorGhostText.border': '#4e4f47',
      'editorInlineSuggest.foreground': '#75715e',
      'scrollbarSlider.background': '#4e4d4255',
      'scrollbarSlider.hoverBackground': '#4e4d4288',
      'scrollbarSlider.activeBackground': '#4e4d42aa',
    },
  },

  'hyscode-dracula': {
    base: 'vs-dark',
    rules: [
      { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff79c6' },
      { token: 'keyword.control', foreground: 'ff79c6' },
      { token: 'string', foreground: 'f1fa8c' },
      { token: 'number', foreground: 'bd93f9' },
      { token: 'type', foreground: '8be9fd', fontStyle: 'italic' },
      { token: 'type.identifier', foreground: '8be9fd' },
      { token: 'function', foreground: '50fa7b' },
      { token: 'variable', foreground: 'f8f8f2' },
      { token: 'operator', foreground: 'ff79c6' },
      { token: 'delimiter', foreground: 'a0a4b8' },
      { token: 'tag', foreground: 'ff79c6' },
      { token: 'attribute.name', foreground: '50fa7b' },
      { token: 'attribute.value', foreground: 'f1fa8c' },
      { token: 'regexp', foreground: 'f1fa8c' },
    ],
    colors: {
      'editor.background': '#282a36',
      'editor.foreground': '#f8f8f2',
      'editorLineNumber.foreground': '#44475a',
      'editorLineNumber.activeForeground': '#a0a4b8',
      'editor.selectionBackground': '#bd93f933',
      'editor.lineHighlightBackground': '#2d2f3d08',
      'editorCursor.foreground': '#f8f8f2',
      'editorIndentGuide.background': '#3a3c4e',
      'editorIndentGuide.activeBackground': '#44475a',
      'editorBracketMatch.background': '#bd93f922',
      'editorBracketMatch.border': '#bd93f944',
      'editor.wordHighlightBackground': '#bd93f918',
      'editorWidget.background': '#2d2f3d',
      'editorWidget.border': '#44475a',
      'input.background': '#2d2f3d',
      'input.foreground': '#f8f8f2',
      'input.border': '#44475a',
      'minimap.background': '#21222c',
      'minimap.selectionHighlight': '#bd93f944',
      'minimapGutter.addedBackground': '#50fa7b',
      'minimapGutter.modifiedBackground': '#f1fa8c',
      'minimapGutter.deletedBackground': '#ff5555',
      'editorOverviewRuler.addedForeground': '#50fa7b88',
      'editorOverviewRuler.modifiedForeground': '#f1fa8c88',
      'editorOverviewRuler.deletedForeground': '#ff555588',
      'editorGhostText.foreground': '#6272a4',
      'editorGhostText.border': '#44475a',
      'editorInlineSuggest.foreground': '#6272a4',
      'scrollbarSlider.background': '#44475a55',
      'scrollbarSlider.hoverBackground': '#44475a88',
      'scrollbarSlider.activeBackground': '#44475aaa',
    },
  },

  'hyscode-github-dark': {
    base: 'vs-dark',
    rules: [
      { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff7b72' },
      { token: 'keyword.control', foreground: 'ff7b72' },
      { token: 'string', foreground: 'a5d6ff' },
      { token: 'number', foreground: '79c0ff' },
      { token: 'type', foreground: 'ffa657' },
      { token: 'type.identifier', foreground: 'ffa657' },
      { token: 'function', foreground: 'd2a8ff' },
      { token: 'variable', foreground: 'c9d1d9' },
      { token: 'operator', foreground: 'ff7b72' },
      { token: 'delimiter', foreground: '8b949e' },
      { token: 'tag', foreground: '7ee787' },
      { token: 'attribute.name', foreground: '79c0ff' },
      { token: 'attribute.value', foreground: 'a5d6ff' },
      { token: 'regexp', foreground: '7ee787' },
    ],
    colors: {
      'editor.background': '#0d1117',
      'editor.foreground': '#c9d1d9',
      'editorLineNumber.foreground': '#30363d',
      'editorLineNumber.activeForeground': '#8b949e',
      'editor.selectionBackground': '#58a6ff33',
      'editor.lineHighlightBackground': '#161b2208',
      'editorCursor.foreground': '#58a6ff',
      'editorIndentGuide.background': '#21262d',
      'editorIndentGuide.activeBackground': '#30363d',
      'editorBracketMatch.background': '#58a6ff22',
      'editorBracketMatch.border': '#58a6ff44',
      'editor.wordHighlightBackground': '#58a6ff18',
      'editorWidget.background': '#161b22',
      'editorWidget.border': '#30363d',
      'input.background': '#161b22',
      'input.foreground': '#c9d1d9',
      'input.border': '#30363d',
      'minimap.background': '#010409',
      'minimap.selectionHighlight': '#58a6ff44',
      'minimapGutter.addedBackground': '#3fb950',
      'minimapGutter.modifiedBackground': '#d29922',
      'minimapGutter.deletedBackground': '#f85149',
      'editorOverviewRuler.addedForeground': '#3fb95088',
      'editorOverviewRuler.modifiedForeground': '#d2992288',
      'editorOverviewRuler.deletedForeground': '#f8514988',
      'editorGhostText.foreground': '#6e7681',
      'editorGhostText.border': '#30363d',
      'editorInlineSuggest.foreground': '#6e7681',
      'scrollbarSlider.background': '#30363d55',
      'scrollbarSlider.hoverBackground': '#30363d88',
      'scrollbarSlider.activeBackground': '#30363daa',
    },
  },
};

/** Maps a settings ThemeId to the corresponding Monaco theme name. */
export function getMonacoThemeName(themeId: string): string {
  // Built-in themes map
  switch (themeId) {
    case 'hyscode-dark':   return 'hyscode-dark';
    case 'hyscode-light':  return 'hyscode-light';
    case 'nord':           return 'hyscode-nord';
    case 'monokai':        return 'hyscode-monokai';
    case 'dracula':        return 'hyscode-dracula';
    case 'github-dark':    return 'hyscode-github-dark';
    default: {
      // Extension-registered custom theme
      const monacoName = `ext-${themeId}`;
      return _customThemes.has(monacoName) ? monacoName : 'hyscode-dark';
    }
  }
}

/** Registers all HysCode themes in a Monaco instance. Call in beforeMount. */
export function defineAllMonacoThemes(monaco: MonacoInstance): void {
  for (const [name, def] of Object.entries(THEMES)) {
    monaco.editor.defineTheme(name, {
      base: def.base,
      inherit: true,
      rules: def.rules,
      colors: def.colors,
    });
  }
  // Also register any custom themes that were added at runtime
  for (const [name, def] of _customThemes.entries()) {
    monaco.editor.defineTheme(name, {
      base: def.base,
      inherit: true,
      rules: def.rules,
      colors: def.colors,
    });
  }
}

// ─── Extension Theme Runtime Registry ────────────────────────────────────────

/** Custom themes registered by extensions at runtime. */
const _customThemes = new Map<string, ThemeDef>();

/** Full ThemeDefinition objects for extension themes (used for terminal colors). */
const _customThemeDefinitions = new Map<string, ThemeDefinition>();

/** Metadata for registered custom themes, used by the theme picker. */
export interface CustomThemeMeta {
  themeId: string;
  label: string;
  type: 'dark' | 'light';
  extensionName?: string;
  colors: {
    bg: string;
    surface: string;
    sidebar: string;
    accent: string;
    fg: string;
    muted: string;
  };
}

const _customThemeMetas: CustomThemeMeta[] = [];

/** Returns all registered custom theme metadata (for the theme picker). */
export function getCustomThemeMetas(): readonly CustomThemeMeta[] {
  return _customThemeMetas;
}

/** Check if a theme id belongs to an extension theme. */
export function isExtensionTheme(themeId: string): boolean {
  return _customThemes.has(`ext-${themeId}`);
}

/** Check if an extension theme is a light theme. */
export function isLightTheme(themeId: string): boolean {
  if (themeId === 'hyscode-light') return true;
  const meta = _customThemeMetas.find((m) => m.themeId === themeId);
  return meta?.type === 'light';
}

/**
 * Register a custom theme from an extension's ThemeDefinition.
 * This:
 *  1. Converts tokenColors → Monaco token rules
 *  2. Converts colors → Monaco editor colors
 *  3. Injects CSS variables on `<html>` for the theme class `.theme-{id}`
 *  4. Injects hljs token color overrides into a `<style>` tag
 *  5. Stores metadata for the theme picker UI
 */
export function registerExtensionTheme(definition: ThemeDefinition): void {
  const monacoName = `ext-${definition.id}`;
  const base: 'vs' | 'vs-dark' = definition.type === 'light' ? 'vs' : 'vs-dark';

  // ── Convert tokenColors to Monaco rules ──
  const rules = convertTokenColorsToRules(definition.tokenColors ?? []);

  // ── Map colors to Monaco editor colors ──
  const monacoColors: Record<string, string> = {};
  const c = definition.colors;
  if (c['editor.background'])              monacoColors['editor.background'] = c['editor.background'];
  if (c['editor.foreground'])              monacoColors['editor.foreground'] = c['editor.foreground'];
  if (c['editorLineNumber.foreground'])    monacoColors['editorLineNumber.foreground'] = c['editorLineNumber.foreground'];
  if (c['editorLineNumber.activeForeground']) monacoColors['editorLineNumber.activeForeground'] = c['editorLineNumber.activeForeground'];
  if (c['editor.selectionBackground'])     monacoColors['editor.selectionBackground'] = c['editor.selectionBackground'];
  if (c['editor.lineHighlightBackground']) monacoColors['editor.lineHighlightBackground'] = c['editor.lineHighlightBackground'];
  if (c['editorCursor.foreground'])        monacoColors['editorCursor.foreground'] = c['editorCursor.foreground'];
  if (c['editorIndentGuide.background'])   monacoColors['editorIndentGuide.background'] = c['editorIndentGuide.background'];
  if (c['editorBracketMatch.background'])  monacoColors['editorBracketMatch.background'] = c['editorBracketMatch.background'];
  if (c['editorBracketMatch.border'])      monacoColors['editorBracketMatch.border'] = c['editorBracketMatch.border'];
  if (c['editorWidget.background'])        monacoColors['editorWidget.background'] = c['editorWidget.background'];
  if (c['editorWidget.border'])            monacoColors['editorWidget.border'] = c['editorWidget.border'];
  if (c['minimap.background'])             monacoColors['minimap.background'] = c['minimap.background'];
  if (c['scrollbarSlider.background'])     monacoColors['scrollbarSlider.background'] = c['scrollbarSlider.background'];
  if (c['scrollbarSlider.hoverBackground']) monacoColors['scrollbarSlider.hoverBackground'] = c['scrollbarSlider.hoverBackground'];

  // Also pass through any raw editor.* colors the extension defined
  for (const [key, val] of Object.entries(c)) {
    if (key.startsWith('editor') || key.startsWith('minimap') || key.startsWith('scrollbar') || key.startsWith('input')) {
      if (!monacoColors[key]) monacoColors[key] = val;
    }
  }

  const themeDef: ThemeDef = { base, rules, colors: monacoColors };
  _customThemes.set(monacoName, themeDef);
  _customThemeDefinitions.set(definition.id, definition);

  // ── Inject CSS theme class ──
  injectThemeCssVars(definition);

  // ── Inject hljs overrides ──
  injectHljsOverrides(definition);

  // ── Store metadata ──
  const bg = c['editor.background'] ?? c['background'] ?? (base === 'vs' ? '#ffffff' : '#1a1a1a');
  const fg = c['editor.foreground'] ?? c['foreground'] ?? (base === 'vs' ? '#1a1a1a' : '#e8e8e8');
  const surface = c['sideBar.background'] ?? c['panel.background'] ?? bg;
  const sidebar = c['activityBar.background'] ?? c['sideBar.background'] ?? bg;
  const accent = c['focusBorder'] ?? c['button.background'] ?? c['editorCursor.foreground'] ?? '#10a37f';
  const muted = c['editorLineNumber.foreground'] ?? c['tab.inactiveForeground'] ?? '#888888';

  // Remove previous meta entry if re-registering
  const existingIdx = _customThemeMetas.findIndex((m) => m.themeId === definition.id);
  if (existingIdx >= 0) _customThemeMetas.splice(existingIdx, 1);

  _customThemeMetas.push({
    themeId: definition.id,
    label: definition.label,
    type: definition.type,
    extensionName: definition.extensionName,
    colors: { bg, surface, sidebar, accent, fg, muted },
  });
}

/** Unregister a custom theme (e.g. when extension is disabled). */
export function unregisterExtensionTheme(themeId: string): void {
  const monacoName = `ext-${themeId}`;
  _customThemes.delete(monacoName);
  _customThemeDefinitions.delete(themeId);

  const idx = _customThemeMetas.findIndex((m) => m.themeId === themeId);
  if (idx >= 0) _customThemeMetas.splice(idx, 1);

  // Remove injected CSS
  document.getElementById(`hyscode-theme-vars-${themeId}`)?.remove();
  document.getElementById(`hyscode-theme-hljs-${themeId}`)?.remove();
}

// ─── xterm.js Terminal Theme ──────────────────────────────────────────────────

export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}

const XTERM_THEMES: Record<string, XtermTheme> = {
  'hyscode-dark': {
    background: '#202123', foreground: '#ececf1', cursor: '#10a37f', cursorAccent: '#202123',
    selectionBackground: 'rgba(16,163,127,0.25)',
    black: '#0d0d0f', red: '#f87171', green: '#4ade80', yellow: '#facc15',
    blue: '#60a5fa', magenta: '#10a37f', cyan: '#22d3ee', white: '#ececf1',
    brightBlack: '#8e8ea0', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a',
    brightBlue: '#93c5fd', brightMagenta: '#2fb28f', brightCyan: '#67e8f9', brightWhite: '#ffffff',
  },
  'hyscode-light': {
    background: '#f7f7f8', foreground: '#0d0d0f', cursor: '#0d8a6c', cursorAccent: '#f7f7f8',
    selectionBackground: 'rgba(13,138,108,0.2)',
    black: '#0d0d0f', red: '#dc2626', green: '#16a34a', yellow: '#d97706',
    blue: '#1d4ed8', magenta: '#0d8a6c', cyan: '#0891b2', white: '#e5e5e5',
    brightBlack: '#6e6e80', brightRed: '#ef4444', brightGreen: '#22c55e', brightYellow: '#f59e0b',
    brightBlue: '#3b82f6', brightMagenta: '#0d8a6c', brightCyan: '#06b6d4', brightWhite: '#ffffff',
  },
  'nord': {
    background: '#2e3440', foreground: '#d8dee9', cursor: '#88c0d0', cursorAccent: '#2e3440',
    selectionBackground: 'rgba(136,192,208,0.25)',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  },
  'monokai': {
    background: '#272822', foreground: '#f8f8f2', cursor: '#f92672', cursorAccent: '#272822',
    selectionBackground: 'rgba(249,38,114,0.25)',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
    blue: '#66d9e8', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75',
    brightBlue: '#66d9e8', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
  },
  'dracula': {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#bd93f9', cursorAccent: '#282a36',
    selectionBackground: 'rgba(189,147,249,0.25)',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#6272a4', magenta: '#bd93f9', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
    brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  'github-dark': {
    background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', cursorAccent: '#0d1117',
    selectionBackground: 'rgba(88,166,255,0.25)',
    black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
    brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341',
    brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
  },
};

/**
 * Returns xterm.js-compatible theme colors for a given theme ID.
 * Falls back to hyscode-dark for unknown themes.
 */
export function getXtermTheme(themeId: string): XtermTheme {
  // Built-in themes
  if (XTERM_THEMES[themeId]) return XTERM_THEMES[themeId];

  // Extension themes — extract terminal.ansi* colors from the ThemeDefinition
  const def = _customThemeDefinitions.get(themeId);
  if (def) {
    const c = def.colors;
    const bg = c['editor.background'] ?? (def.type === 'light' ? '#ffffff' : '#1a1a1a');
    const fg = c['editor.foreground'] ?? (def.type === 'light' ? '#1a1a1a' : '#e8e8e8');
    const cursor = c['editorCursor.foreground'] ?? c['focusBorder'] ?? '#10a37f';
    return {
      background: bg, foreground: fg, cursor, cursorAccent: bg,
      selectionBackground: c['editor.selectionBackground'] ?? 'rgba(168,85,247,0.25)',
      black:        c['terminal.ansiBlack']        ?? '#0d0d0d',
      red:          c['terminal.ansiRed']          ?? '#f87171',
      green:        c['terminal.ansiGreen']        ?? '#4ade80',
      yellow:       c['terminal.ansiYellow']       ?? '#facc15',
      blue:         c['terminal.ansiBlue']         ?? '#60a5fa',
      magenta:      c['terminal.ansiMagenta']      ?? '#10a37f',
      cyan:         c['terminal.ansiCyan']         ?? '#22d3ee',
      white:        c['terminal.ansiWhite']        ?? '#e8e8e8',
      brightBlack:   c['terminal.ansiBrightBlack']   ?? '#888888',
      brightRed:     c['terminal.ansiBrightRed']     ?? '#fca5a5',
      brightGreen:   c['terminal.ansiBrightGreen']   ?? '#86efac',
      brightYellow:  c['terminal.ansiBrightYellow']  ?? '#fde68a',
      brightBlue:    c['terminal.ansiBrightBlue']    ?? '#93c5fd',
      brightMagenta: c['terminal.ansiBrightMagenta'] ?? '#c084fc',
      brightCyan:    c['terminal.ansiBrightCyan']    ?? '#67e8f9',
      brightWhite:   c['terminal.ansiBrightWhite']   ?? '#ffffff',
    };
  }

  return XTERM_THEMES['hyscode-dark'];
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** Maps TextMate-style scope names to Monaco token names. */
const SCOPE_TO_TOKEN: Record<string, string> = {
  'comment': 'comment',
  'comment.line': 'comment',
  'comment.block': 'comment',
  'keyword': 'keyword',
  'keyword.control': 'keyword.control',
  'keyword.operator': 'operator',
  'storage': 'keyword',
  'storage.type': 'type',
  'string': 'string',
  'string.quoted': 'string',
  'constant.numeric': 'number',
  'constant.language': 'number',
  'entity.name.type': 'type',
  'entity.name.class': 'type',
  'entity.name.function': 'function',
  'entity.name.tag': 'tag',
  'entity.other.attribute-name': 'attribute.name',
  'variable': 'variable',
  'variable.parameter': 'variable',
  'variable.other': 'variable',
  'support.function': 'function',
  'support.type': 'type',
  'support.class': 'type',
  'punctuation': 'delimiter',
  'meta.tag': 'tag',
  'string.regexp': 'regexp',
};

function convertTokenColorsToRules(tokenColors: TokenColorRule[]): Monaco.editor.ITokenThemeRule[] {
  const rules: Monaco.editor.ITokenThemeRule[] = [];

  for (const rule of tokenColors) {
    const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
    const fg = rule.settings.foreground?.replace('#', '');
    const fontStyle = rule.settings.fontStyle;

    for (const scope of scopes) {
      // Try direct mapping first, then use scope as-is (Monaco handles many TM scopes)
      const token = SCOPE_TO_TOKEN[scope] ?? scope;
      const entry: Monaco.editor.ITokenThemeRule = { token };
      if (fg) entry.foreground = fg;
      if (fontStyle) entry.fontStyle = fontStyle;
      rules.push(entry);
    }
  }

  return rules;
}

/** Injects a <style> block with CSS variables for `.theme-{id}`. */
function injectThemeCssVars(def: ThemeDefinition): void {
  const id = `hyscode-theme-vars-${def.id}`;
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }

  const c = def.colors;
  const bg = c['editor.background'] ?? c['background'] ?? (def.type === 'light' ? '#ffffff' : '#1a1a1a');
  const fg = c['editor.foreground'] ?? c['foreground'] ?? (def.type === 'light' ? '#1a1a1a' : '#e8e8e8');
  const surface = c['sideBar.background'] ?? c['panel.background'] ?? bg;
  const surfaceRaised = c['editorWidget.background'] ?? c['panel.background'] ?? bg;
  const sidebar = c['activityBar.background'] ?? c['sideBar.background'] ?? bg;
  const accent = c['focusBorder'] ?? c['button.background'] ?? c['editorCursor.foreground'] ?? '#10a37f';
  const muted = c['editorLineNumber.foreground'] ?? c['tab.inactiveForeground'] ?? '#888888';
  const mutedFg = c['tab.inactiveForeground'] ?? muted;
  const border = c['panel.border'] ?? c['sideBar.border'] ?? 'transparent';
  const input = c['input.background'] ?? surfaceRaised;
  const destructive = c['errorForeground'] ?? '#f87171';
  const secondary = c['sideBar.background'] ?? surface;

  style.textContent = `
.theme-${def.id} {
  --background: ${bg};
  --foreground: ${fg};
  --card: ${surface};
  --card-foreground: ${fg};
  --popover: ${surfaceRaised};
  --popover-foreground: ${fg};
  --primary: ${accent};
  --primary-foreground: ${def.type === 'light' ? '#ffffff' : bg};
  --secondary: ${secondary};
  --secondary-foreground: ${fg};
  --muted: ${secondary};
  --muted-foreground: ${mutedFg};
  --accent: ${accent};
  --accent-foreground: ${def.type === 'light' ? '#ffffff' : bg};
  --destructive: ${destructive};
  --border: ${border};
  --input: ${input};
  --ring: ${accent};
  --radius: 0.625rem;
  --sidebar: ${sidebar};
  --sidebar-foreground: ${fg};
  --sidebar-primary: ${accent};
  --sidebar-primary-foreground: ${def.type === 'light' ? '#ffffff' : bg};
  --sidebar-accent: ${secondary};
  --sidebar-accent-foreground: ${fg};
  --sidebar-border: ${border};
  --sidebar-ring: ${accent};
  --color-surface: ${surface};
  --color-surface-raised: ${surfaceRaised};
  --color-accent-muted: ${accent}18;
  --color-success: ${c['terminal.ansiGreen'] ?? '#4ade80'};
  --color-warning: ${c['terminal.ansiYellow'] ?? '#facc15'};
  --color-error: ${destructive};
  --color-border-hover: ${border};
  --color-border-active: ${border};
}`;
}

/** Injects a <style> block with .hljs token overrides for `.theme-{id} .markdown-preview`. */
function injectHljsOverrides(def: ThemeDefinition): void {
  const styleId = `hyscode-theme-hljs-${def.id}`;
  let style = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }

  // Extract representative token colors from tokenColors rules
  const tokenMap: Record<string, string> = {};
  for (const rule of def.tokenColors ?? []) {
    const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
    const fg = rule.settings.foreground;
    if (!fg) continue;
    for (const scope of scopes) {
      tokenMap[scope] = fg;
    }
  }

  const kw = tokenMap['keyword'] ?? tokenMap['keyword.control'] ?? tokenMap['storage'] ?? '';
  const str = tokenMap['string'] ?? tokenMap['string.quoted'] ?? '';
  const num = tokenMap['constant.numeric'] ?? tokenMap['constant.language'] ?? '';
  const type = tokenMap['entity.name.type'] ?? tokenMap['support.type'] ?? tokenMap['storage.type'] ?? '';
  const fn = tokenMap['entity.name.function'] ?? tokenMap['support.function'] ?? '';
  const comment = tokenMap['comment'] ?? tokenMap['comment.line'] ?? tokenMap['comment.block'] ?? '';
  const variable = tokenMap['variable'] ?? tokenMap['variable.other'] ?? '';
  const attr = tokenMap['entity.other.attribute-name'] ?? '';
  const del = tokenMap['markup.deleted'] ?? tokenMap['invalid'] ?? '';
  const regexp = tokenMap['string.regexp'] ?? str;
  const fg = def.colors['editor.foreground'] ?? def.colors['foreground'] ?? '';

  const sel = `.theme-${def.id} .markdown-preview`;
  const rules: string[] = [];

  if (kw) rules.push(`${sel} .hljs-keyword, ${sel} .hljs-selector-tag { color: ${kw}; }`);
  if (str) rules.push(`${sel} .hljs-string, ${sel} .hljs-addition { color: ${str}; }`);
  if (num) rules.push(`${sel} .hljs-number { color: ${num}; }`);
  if (type) rules.push(`${sel} .hljs-type, ${sel} .hljs-built_in { color: ${type}; }`);
  if (fn) rules.push(`${sel} .hljs-function, ${sel} .hljs-title { color: ${fn}; }`);
  if (comment) rules.push(`${sel} .hljs-comment, ${sel} .hljs-quote { color: ${comment}; font-style: italic; }`);
  if (variable || fg) rules.push(`${sel} .hljs-variable, ${sel} .hljs-template-variable { color: ${variable || fg}; }`);
  if (attr) rules.push(`${sel} .hljs-attr { color: ${attr}; }`);
  if (del) rules.push(`${sel} .hljs-deletion { color: ${del}; }`);
  if (regexp) rules.push(`${sel} .hljs-regexp { color: ${regexp}; }`);

  style.textContent = rules.join('\n');
}

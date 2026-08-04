import { describe, expect, it, vi } from 'vitest';

import { defineAllMonacoThemes, getMonacoThemeName, getXtermTheme } from './monaco-themes';

describe('Aura built-in theme', () => {
  it('maps the settings theme id to the registered Monaco theme', () => {
    expect(getMonacoThemeName('aura')).toBe('hyscode-aura');
  });

  it('registers the Aura editor surface with Monaco', () => {
    const defineTheme = vi.fn();

    defineAllMonacoThemes({ editor: { defineTheme } } as unknown as typeof import('monaco-editor'));

    expect(defineTheme).toHaveBeenCalledWith(
      'hyscode-aura',
      expect.objectContaining({
        base: 'vs-dark',
        colors: expect.objectContaining({
          'editor.background': '#15141b',
          'editorCursor.foreground': '#a277ff',
        }),
      }),
    );
  });

  it('keeps the official palette relationship across terminal colors', () => {
    expect(getXtermTheme('aura')).toMatchObject({
      background: '#15141b',
      foreground: '#cdccce',
      cursor: '#a277ff',
      green: '#61ffca',
      yellow: '#ffca85',
      blue: '#a277ff',
      red: '#ff6767',
    });
  });
});

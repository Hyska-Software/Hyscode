import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINAL_FONT_FAMILY, resolveTerminalFontFamily } from './terminal-font';

describe('terminal font family', () => {
  it('adds a reliable monospace fallback to a configured family', () => {
    expect(resolveTerminalFontFamily('Geist Mono')).toBe(
      "Geist Mono, 'Cascadia Mono', Consolas, 'Courier New', monospace",
    );
  });

  it('uses the default monospace stack when the setting is empty', () => {
    expect(resolveTerminalFontFamily('   ')).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
  });

  it('does not duplicate a fallback family already selected by the user', () => {
    expect(resolveTerminalFontFamily('Cascadia Mono')).toBe(
      "Cascadia Mono, Consolas, 'Courier New', monospace",
    );
  });

  it('preserves a complete CSS family list that already has a generic fallback', () => {
    expect(resolveTerminalFontFamily('Fira Code, monospace')).toBe('Fira Code, monospace');
  });
});

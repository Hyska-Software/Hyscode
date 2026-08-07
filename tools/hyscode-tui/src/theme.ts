import { BUILTIN_THEMES, DEFAULT_THEME_ID, type ThemeSummary } from '@hyscode/tui-runtime';

export type AnsiToken = {
  toString: () => string;
  [Symbol.toPrimitive]: (hint: string) => string;
};

export type AnsiTheme = {
  background: string;
  reset: string;
  accent: string;
  muted: string;
  soft: string;
  warning: string;
  success: string;
  error: string;
  panel: string;
};

export function resolveAnsiTheme(themeId: string, themes: readonly ThemeSummary[]): AnsiTheme {
  const theme = themes.find((candidate) => candidate.id === themeId) ?? themes[0];
  const fallback = BUILTIN_THEMES.find((candidate) => candidate.id === DEFAULT_THEME_ID);
  if (!theme && !fallback) throw new Error('The built-in theme catalog is empty.');
  return createAnsiTheme(theme ?? fallback);
}

export function createAnsiTheme(theme: ThemeSummary): AnsiTheme {
  const background = ansiBackground(theme.colors.bg);
  return {
    background,
    reset: `\u001b[0m${background}`,
    accent: ansiForeground(theme.colors.accent),
    muted: ansiForeground(theme.colors.muted),
    soft: ansiForeground(theme.colors.soft),
    warning: ansiForeground(theme.colors.warning),
    success: ansiForeground(theme.colors.success),
    error: ansiForeground(theme.colors.error),
    panel: ansiForeground(theme.colors.panel),
  };
}

export function dynamicAnsiToken(getValue: () => string): AnsiToken {
  return {
    toString: getValue,
    [Symbol.toPrimitive]: () => getValue(),
  };
}

function ansiForeground(value: string): string {
  const rgb = parseHex(value);
  return rgb ? `\u001b[38;2;${rgb.join(';')}m` : '\u001b[39m';
}

function ansiBackground(value: string): string {
  const rgb = parseHex(value);
  return rgb ? `\u001b[48;2;${rgb.join(';')}m` : '\u001b[49m';
}

function parseHex(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    return [
      Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    ];
  }
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

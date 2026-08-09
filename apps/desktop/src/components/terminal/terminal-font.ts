const DEFAULT_TERMINAL_FONT_FAMILY_PARTS = [
  "'Cascadia Mono'",
  'Consolas',
  "'Courier New'",
  'monospace',
] as const;

export const DEFAULT_TERMINAL_FONT_FAMILY = DEFAULT_TERMINAL_FONT_FAMILY_PARTS.join(', ');

const GENERIC_FONT_FAMILIES = new Set([
  'cursive',
  'fantasy',
  'math',
  'monospace',
  'sans-serif',
  'serif',
  'system-ui',
  'ui-monospace',
  'ui-rounded',
  'ui-sans-serif',
  'ui-serif',
]);

function normalizeFontFamilyPart(part: string): string {
  return part.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase();
}

export function resolveTerminalFontFamily(fontFamily: string | null | undefined): string {
  const configuredParts = (fontFamily ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (configuredParts.length === 0) return DEFAULT_TERMINAL_FONT_FAMILY;

  const normalizedParts = new Set(configuredParts.map(normalizeFontFamilyPart));
  if (configuredParts.some((part) => GENERIC_FONT_FAMILIES.has(normalizeFontFamilyPart(part)))) {
    return configuredParts.join(', ');
  }

  const fallbackParts = DEFAULT_TERMINAL_FONT_FAMILY_PARTS.filter(
    (part) => !normalizedParts.has(normalizeFontFamilyPart(part)),
  );
  return [...configuredParts, ...fallbackParts].join(', ');
}

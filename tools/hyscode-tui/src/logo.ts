/**
 * Rasterized from apps/desktop/public/hyscode-logo.svg. The terminal cannot
 * load the desktop SVG from a packaged executable, so the alpha silhouette is
 * kept as a static half-block representation here.
 */
export const CLI_LOGO = [
  '             ▄▄',
  '        ▄▄██▀▀',
  '       ███▀ ▄▄█████▄',
  '      ███  ███▀▀▀▀███▄',
  '     ▀██▀ █▀   ▄▄▄▄ ▀▀█▄',
  '   ▄  ███ ▀ ▄█▄  ▀██▄   ▀',
  '   ▀█  ██▄  ██▀ ▄ ▀███',
  '    ██▄  ▀▀    ▄█  ███',
  '    ▀████▄▄▄▄███▀ ▄██▀',
  '      ▀▀█████▀▀  ▄██▀',
  '              ▄████▀',
  '            ▀▀▀',
] as const;

export const COMPACT_CLI_LOGO = [
  '       ▄',
  '    █▀ ▄▄▄',
  '   █▀█▀██▀▀▄',
  '   ▀▄ █▄ █▄',
  '  █▄▄█▄▄▀██',
  '    ▀▀▀▄▄█',
  '      ▀',
] as const;

export function getCliLogo(maxWidth: number): readonly string[] {
  const safeWidth = Math.max(1, Math.floor(maxWidth));
  return CLI_LOGO.every((line) => line.length <= safeWidth) ? CLI_LOGO : COMPACT_CLI_LOGO;
}

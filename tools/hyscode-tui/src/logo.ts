/**
 * Vortex wordmark rasterized from assets/brand/vortex.png (flat, sem borda).
 * Regenerate with: node scripts/render-cli-logo.mjs --write
 * (28x6 full, 14x4 compact: welcomeIdentityLines shares its panel column with
 * runtime details, so the art must stay short enough to fit the welcome
 * surface at the default 120x32 viewport. The terminal cannot load image
 * assets from a packaged executable, so the alpha silhouette is kept as a
 * static half-block representation here.)
 */
export const CLI_LOGO = [
  '         ▄▄▄▄█ ▄▄▄▄',
  '  ▄▄  ████▀█▄▄██████▀███▄▄',
  '  ██▄ ███  ▀▄▄▄▄ ▀▀▀██████',
  '  █▀███▄▄▄▄▀▀▀▀▀█ ███ ▀███',
  '  ▀▀███████████▀▀▄████ ▀▀▀',
  '        ▀▀▀▀███▀▀▀▀',
] as const;

export const COMPACT_CLI_LOGO = [
  '   ▄▄▄█▄▄▄▄',
  ' █ █▀ ██▀████',
  ' ███▄▄▀█ ████',
  '   ▀▀▀██▀▀▀',
] as const;

export function getCliLogo(maxWidth: number): readonly string[] {
  const safeWidth = Math.max(1, Math.floor(maxWidth));
  return CLI_LOGO.every((line) => line.length <= safeWidth) ? CLI_LOGO : COMPACT_CLI_LOGO;
}

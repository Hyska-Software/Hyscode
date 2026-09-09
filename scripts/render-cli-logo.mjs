#!/usr/bin/env node
// Renders the TUI ASCII logo from the flat (sem borda) brand source.
// Usage: node scripts/render-cli-logo.mjs [--write]
// Prints TS snippet; with --write, rewrites tools/hyscode-tui/src/logo.ts
// keeping the getCliLogo() API intact.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'assets', 'brand', 'vortex.png');
const target = path.join(root, 'tools', 'hyscode-tui', 'src', 'logo.ts');

function alphaGrid(cols, rows) {
  const script = `
from PIL import Image
p = ${JSON.stringify(source)}
cols = ${cols}
rows2 = ${rows} * 2
im = Image.open(p).convert("RGBA")
im = im.resize((cols, rows2), Image.LANCZOS)
px = im.load()
for y in range(rows2):
    print("".join("1" if px[x, y][3] > 128 else "0" for x in range(cols)))
`;
  const out = execFileSync('python', ['-c', script], { encoding: 'utf8', cwd: root });
  return out.trim().split('\n');
}

function toHalfBlock(rows) {
  // rows: 2*height binary strings -> height lines of half-block chars
  const lines = [];
  for (let y = 0; y < rows.length; y += 2) {
    const top = rows[y];
    const bottom = rows[y + 1] ?? ''.padStart(top.length, '0');
    let line = '';
    for (let x = 0; x < top.length; x += 1) {
      const t = top[x] === '1';
      const b = bottom[x] === '1';
      line += t && b ? '█' : t ? '▀' : b ? '▄' : ' ';
    }
    lines.push(line.replace(/\s+$/u, ''));
  }
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines;
}

// Welcome panel budget (120x32 default): header(2) + panel borders/padding(3) +
// composer(~8) + tip(2) leave ~17 rows; identity block must stay <= 12 rows so
// the welcome surface (title + logo + runtime) renders instead of transcript.
const full = toHalfBlock(alphaGrid(28, 6));
const compact = toHalfBlock(alphaGrid(14, 4));

const header = `/**
 * Vortex wordmark rasterized from assets/brand/vortex.png (flat, sem borda).
 * Regenerate with: node scripts/render-cli-logo.mjs --write
 * The terminal cannot load image assets from a packaged executable, so the
 * alpha silhouette is kept as a static half-block representation here.
 */
`;

const body = `${header}export const CLI_LOGO = [
${full.map((line) => `  '${line}',`).join('\n')}
] as const;

export const COMPACT_CLI_LOGO = [
${compact.map((line) => `  '${line}',`).join('\n')}
] as const;

export function getCliLogo(maxWidth: number): readonly string[] {
  const safeWidth = Math.max(1, Math.floor(maxWidth));
  return CLI_LOGO.every((line) => line.length <= safeWidth) ? CLI_LOGO : COMPACT_CLI_LOGO;
}
`;

if (process.argv.includes('--write')) {
  writeFileSync(target, body, 'utf8');
  process.stdout.write(`logo.ts rewritten from ${source}\n`);
} else {
  process.stdout.write(body);
}

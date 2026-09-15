// ─── Verify Frontend Bundle ──────────────────────────────────────────────────
// Guards against the esbuild 0.25.x miscompilation that broke xterm's
// InputHandler.requestMode in production bundles. When the build target forces
// logical assignment operators to be lowered, esbuild could emit:
//
//   requestMode(e,t){ (enumIIFE)(void 0 || (i = {})); ... }
//
// with the enum declaration dropped, causing "ReferenceError: i is not defined"
// the first time a terminal app sends a DECRQM sequence. See
// docs/architecture/FRONTEND.md.
//
// Usage:
//   node scripts/verify-frontend-bundle.mjs [distDir]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const candidates = [
  process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : null,
  path.join(root, 'apps', 'desktop', 'dist'),
  path.resolve(process.cwd(), 'dist'),
].filter((candidate) => candidate !== null);

const distDir = candidates.find((dir) => existsSync(path.join(dir, 'assets')));

if (!distDir) {
  console.error(
    `[verify-frontend-bundle] assets directory not found (tried: ${candidates.join(', ')})`,
  );
  process.exit(1);
}

const assetsDir = path.join(distDir, 'assets');

const BROKEN_ASSIGNMENT = /\)\)+\(void 0\|\|\(/;
const INSPECTION_WINDOW = 512;

function fail(message) {
  console.error(`[verify-frontend-bundle] ${message}`);
  process.exit(1);
}

const bundles = readdirSync(assetsDir).filter(
  (name) => name.startsWith('index-') && name.endsWith('.js'),
);

if (bundles.length === 0) {
  fail(`no index-*.js bundle found in ${assetsDir}`);
}

let checkedMethods = 0;
for (const bundle of bundles) {
  const code = readFileSync(path.join(assetsDir, bundle), 'utf8');
  let index = -1;
  while ((index = code.indexOf('requestMode(', index + 1)) !== -1) {
    // Skip call sites (`this.requestMode(`); only inspect the definition.
    if (code[index - 1] === '.') continue;
    const window = code.slice(index, index + INSPECTION_WINDOW);
    if (BROKEN_ASSIGNMENT.test(window)) {
      fail(
        `${bundle} contains a broken requestMode enum assignment (esbuild lowered ` +
          `"||=" into an undeclared variable). Rebuild with the pinned Vite build.target ` +
          `(dist: ${distDir})`,
      );
    }
    checkedMethods += 1;
  }
}

if (checkedMethods === 0) {
  console.warn('[verify-frontend-bundle] no requestMode definition found; skipped check');
  process.exit(0);
}

console.log(
  `[verify-frontend-bundle] OK — checked ${checkedMethods} requestMode definition(s) in ` +
    `${bundles.length} bundle(s)`,
);

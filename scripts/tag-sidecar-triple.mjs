// ─── Tag Sidecar Binary with Host Target Triple ──────────────────────────────
// Tauri's `bundle.externalBin` requires the binary to be named
// `<name>-<target-triple>` (verified in tauri-utils `external_binaries()`:
// there is NO plain-name fallback). tauri-build strips the triple suffix when
// copying it next to the app executable, so runtime resolution keeps using
// the plain name.
//
// This script copies the freshly built plain binary
// (`binaries/<name>(.exe)`) to the triple-suffixed name
// (`binaries/<name>-<host-triple>(.exe)`) so `tauri dev` / `tauri build`
// can bundle it.
//
// Usage: node scripts/tag-sidecar-triple.mjs <binary-name>

import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const binariesDir = path.resolve(root, 'apps', 'desktop', 'src-tauri', 'binaries');

const HOST_TRIPLES = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

const name = process.argv[2];
if (!name) {
  console.error('Usage: node scripts/tag-sidecar-triple.mjs <binary-name>');
  process.exit(1);
}

const triple = HOST_TRIPLES[`${process.platform}-${process.arch}`];
if (!triple) {
  console.warn(
    `[tag-sidecar-triple] unsupported host ${process.platform}-${process.arch} — skipping.`,
  );
  process.exit(0);
}

const exe = process.platform === 'win32' ? '.exe' : '';
const source = path.join(binariesDir, name + exe);
const target = path.join(binariesDir, `${name}-${triple}${exe}`);

if (!existsSync(source)) {
  console.error(`[tag-sidecar-triple] ${source} not found — run the bun build first.`);
  process.exit(1);
}

copyFileSync(source, target);
console.log(`[tag-sidecar-triple] ${target}`);

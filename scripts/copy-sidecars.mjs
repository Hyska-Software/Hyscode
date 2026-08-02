// ─── Copy Sidecar Binaries for Dev / CI ──────────────────────────────────────
// The Rust commands resolve the sidecar binaries relative to the app
// executable (current_exe()'s parent). In dev (`tauri dev`) that is
// `apps/desktop/src-tauri/target/debug/`; for installers the binaries must
// sit next to the release exe before bundling.
//
// The Codex CLI runtime is NOT copied (the CLI is user-installed).
//
// Usage:
//   node scripts/copy-sidecars.mjs                       # → target/debug dirs
//   node scripts/copy-sidecars.mjs --target <dir>        # → custom dir(s)
//   node scripts/copy-sidecars.mjs --target <a> --target <b>

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const binariesDir = path.resolve(root, 'apps', 'desktop', 'src-tauri', 'binaries');

// Legacy vendored CLI runtime (pre-unbundling builds) — never copied.
const EXCLUDED = new Set(['codex-cli-runtime']);

const DEFAULT_TARGETS = [
  path.resolve(root, 'apps', 'desktop', 'src-tauri', 'target', 'debug'),
  path.resolve(root, 'apps', 'desktop', 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'debug'),
];

function parseArgs(argv) {
  const targets = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target' && argv[i + 1]) {
      targets.push(path.resolve(root, argv[++i]));
    }
  }
  return targets;
}

function copyEntry(source, destDir) {
  const dest = path.join(destDir, path.basename(source));
  if (statSync(source).isDirectory()) {
    cpSync(source, dest, { recursive: true });
  } else {
    copyFileSync(source, dest);
  }
  console.log(`[copy:sidecars] ${source} → ${dest}`);
}

const targets = parseArgs(process.argv.slice(2));
const targetDirs = targets.length > 0 ? targets : DEFAULT_TARGETS;

if (!existsSync(binariesDir)) {
  console.warn('[copy:sidecars] No binaries directory found — run `npm run build:sidecars` first.');
  process.exit(0);
}

let copied = 0;
for (const target of targetDirs) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(binariesDir)) {
    if (EXCLUDED.has(entry)) {
      console.log(`[copy:sidecars] skipping ${entry} (user-installed CLI)`);
      continue;
    }
    copyEntry(path.join(binariesDir, entry), target);
    copied++;
  }
}

if (copied === 0) {
  console.warn('[copy:sidecars] Nothing to copy.');
}

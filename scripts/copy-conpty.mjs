// ─── Stage the modern Windows ConPTY next to the app executable ──────────────
// portable-pty loads a sideloaded `conpty.dll` from the executable directory
// before falling back to the legacy inbox ConPTY. The inbox implementation is a
// known source of terminal hangs with full-screen TUI applications, so the
// desktop app ships the same OpenConsole build used by the VORTEX CLI.
//
// The binaries are vendored by node-pty:
//   node_modules/node-pty/prebuilds/win32-<arch>/conpty/
//   node_modules/node-pty/third_party/conpty/<version>/win10-<arch>/
//
// Usage:
//   node scripts/copy-conpty.mjs                 # → dev target/debug dirs
//   node scripts/copy-conpty.mjs --stage         # → src-tauri/resources/conpty
//   node scripts/copy-conpty.mjs --target <dir>  # → custom dir(s)

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const CONPTY_FILES = ['conpty.dll', 'OpenConsole.exe'];

const ARCH_DIRECTORY = {
  x64: 'win10-x64',
  arm64: 'win10-arm64',
  ia32: 'win10-x86',
};

const DEFAULT_TARGETS = [
  path.resolve(root, 'apps', 'desktop', 'src-tauri', 'target', 'debug'),
  path.resolve(root, 'apps', 'desktop', 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'debug'),
];

const STAGING_DIRECTORY = path.resolve(
  root,
  'apps',
  'desktop',
  'src-tauri',
  'resources',
  'conpty',
);

function parseArgs(argv) {
  const targets = [];
  let stage = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--stage') {
      stage = true;
    } else if (argv[i] === '--target' && argv[i + 1]) {
      targets.push(path.resolve(root, argv[++i]));
    }
  }
  return { targets, stage };
}

function hasConptyBinaries(directory) {
  return CONPTY_FILES.every((name) => existsSync(path.join(directory, name)));
}

function resolveConptySource() {
  const prebuild = path.resolve(
    root,
    'node_modules',
    'node-pty',
    'prebuilds',
    `win32-${process.arch}`,
    'conpty',
  );
  if (hasConptyBinaries(prebuild)) return prebuild;

  const thirdPartyRoot = path.resolve(root, 'node_modules', 'node-pty', 'third_party', 'conpty');
  if (existsSync(thirdPartyRoot)) {
    const versions = readdirSync(thirdPartyRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const candidate = path.join(
        thirdPartyRoot,
        version,
        ARCH_DIRECTORY[process.arch] ?? `win10-${process.arch}`,
      );
      if (hasConptyBinaries(candidate)) return candidate;
    }
  }

  throw new Error(
    `Modern ConPTY binaries for win32-${process.arch} were not found. Reinstall dependencies.`,
  );
}

function copyConpty(sourceDirectory, targetDirectory) {
  mkdirSync(targetDirectory, { recursive: true });
  for (const name of CONPTY_FILES) {
    const destination = path.join(targetDirectory, name);
    copyFileSync(path.join(sourceDirectory, name), destination);
    console.log(`[copy:conpty] ${path.join(sourceDirectory, name)} → ${destination}`);
  }
}

if (process.platform !== 'win32') {
  console.log('[copy:conpty] Not running on Windows — skipping.');
  process.exit(0);
}

const { targets, stage } = parseArgs(process.argv.slice(2));
const sourceDirectory = resolveConptySource();

if (stage) {
  copyConpty(sourceDirectory, STAGING_DIRECTORY);
}

const targetDirectories = targets.length > 0 ? targets : stage ? [] : DEFAULT_TARGETS;
for (const target of targetDirectories) {
  copyConpty(sourceDirectory, target);
}

#!/usr/bin/env node

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tuiPackageRoot = path.join(repositoryRoot, 'tools', 'hyscode-tui');
const codexBinariesRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src-tauri', 'binaries');
const platform = process.platform;
const architecture = process.arch;
const executableSuffix = platform === 'win32' ? '.exe' : '';
const platformArchitecture = `${platform}-${architecture}`;
const npmCommand = platform === 'win32' ? 'npm.cmd' : 'npm';

const SUPPORTED_PLATFORMS = new Set(['win32', 'linux', 'darwin']);
const SUPPORTED_ARCHITECTURES = new Set(['x64', 'arm64']);
const WINDOWS_PATH_ENTRY_ENV = 'VORTEX_PATH_ENTRY_INTERNAL';

function parseArguments(args) {
  const options = {
    install: false,
    skipSidecarBuild: false,
    prepareNative: false,
    outputDirectory: null,
    version: process.env.VORTEX_VERSION ?? '0.1.0',
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--install') {
      options.install = true;
      continue;
    }
    if (argument === '--skip-sidecar-build') {
      options.skipSidecarBuild = true;
      continue;
    }
    if (argument === '--prepare-native') {
      options.prepareNative = true;
      continue;
    }
    if (argument === '--version') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--version requires a release version.');
      options.version = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--version=')) {
      const value = argument.slice('--version='.length);
      if (!value) throw new Error('--version requires a release version.');
      options.version = value;
      continue;
    }
    if (argument === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--output requires a directory path.');
      options.outputDirectory = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--output=')) {
      const value = argument.slice('--output='.length);
      if (!value) throw new Error('--output requires a directory path.');
      options.outputDirectory = value;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    'VORTEX production build',
    '',
    'Usage: node scripts/build-vortex.mjs [options]',
    '',
    'Options:',
    '  --install              Copy the bundle to the user-local bin directory and configure PATH',
    '  --skip-sidecar-build   Reuse the existing Codex sidecar binary',
    '  --output <directory>   Write the production bundle to a custom directory',
    '  --version <version>    Embed the release version in the VORTEX executable',
    '  --prepare-native       Prepare the current node-pty native assets for a source build',
    '  -h, --help             Show this help',
    '',
  ].join('\n'));
}

function commandAvailable(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true });
  return !result.error && result.status === 0;
}

function resolveBun() {
  if (commandAvailable('bun')) return { command: 'bun', directory: null };

  const executableName = platform === 'win32' ? 'bun.exe' : 'bun';
  const candidates = [
    path.join(repositoryRoot, 'node_modules', '.bin', executableName),
    path.join(repositoryRoot, 'node_modules', '@oven', `bun-${platformArchitecture}-baseline`, 'bin', executableName),
    path.join(repositoryRoot, 'node_modules', '@oven', `bun-${platformArchitecture}`, 'bin', executableName),
  ];
  const bundled = candidates.find((candidate) => existsSync(candidate));
  if (bundled) return { command: bundled, directory: path.dirname(bundled) };
  throw new Error('Bun was not found. Install Bun or run npm install before building VORTEX.');
}

function buildEnvironment(bun) {
  const environment = { ...process.env };
  if (bun.directory) {
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    environment[pathKey] = [bun.directory, environment[pathKey] ?? ''].filter(Boolean).join(path.delimiter);
  }
  return environment;
}

function run(command, args, environment) {
  const windowsCommand = platform === 'win32' && (command === 'npm' || command === 'npm.cmd');
  const executable = windowsCommand ? (process.env.ComSpec ?? 'cmd.exe') : command;
  const executableArgs = windowsCommand
    ? ['/d', '/s', '/c', [command, ...args].map(quoteWindowsArgument).join(' ')]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw new Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
}

function quoteWindowsArgument(value) {
  if (!/[\s"&()^|<>]/.test(value)) return value;
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

function copyTree(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(sourcePath, destinationPath);
    else copyFileSync(sourcePath, destinationPath);
  }
}

function resolveNodePtyNativeDirectory() {
  const packageRoot = path.dirname(require.resolve('node-pty/package.json'));
  const prebuildDirectory = path.join(packageRoot, 'prebuilds', platformArchitecture);
  const candidates = [
    prebuildDirectory,
    path.join(packageRoot, 'build', 'Release'),
    path.join(packageRoot, 'build', 'Debug'),
  ];
  const selected = candidates.find((candidate) => existsSync(path.join(candidate, 'pty.node')));
  if (!selected) {
    throw new Error(`node-pty native assets for ${platformArchitecture} were not found. Run npm install on the target platform and retry.`);
  }

  if (path.resolve(selected) !== path.resolve(prebuildDirectory)) copyTree(selected, prebuildDirectory);
  const vortexNativeDirectory = path.join(packageRoot, 'prebuilds', 'vortex');
  copyTree(prebuildDirectory, vortexNativeDirectory);
  const canonical = path.join(prebuildDirectory, 'pty.node');
  if (!existsSync(canonical)) throw new Error(`node-pty native asset was not staged at ${canonical}.`);

  const requiredNames = platform === 'win32'
    ? ['pty.node', 'conpty.node', 'conpty_console_list.node']
    : ['pty.node', 'spawn-helper'];
  for (const name of requiredNames) {
    if (!existsSync(path.join(prebuildDirectory, name))) {
      throw new Error(`node-pty is missing ${name} for ${platformArchitecture}. Reinstall dependencies on the target platform.`);
    }
  }
  return prebuildDirectory;
}

function copyIfPresent(source, destination) {
  if (!existsSync(source)) return false;
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  if (platform !== 'win32') chmodSync(destination, 0o755);
  return true;
}

function stageNodePtyAssets(sourceDirectory, outputDirectory) {
  const stagedDirectory = path.join(outputDirectory, 'node-pty-assets', platformArchitecture);
  mkdirSync(stagedDirectory, { recursive: true });
  const stagedNames = platform === 'win32'
    ? ['pty.node', 'conpty.node', 'conpty_console_list.node']
    : ['pty.node', 'spawn-helper'];
  for (const name of stagedNames) {
    if (!copyIfPresent(path.join(sourceDirectory, name), path.join(stagedDirectory, name))) {
      throw new Error(`Could not stage node-pty asset ${name}.`);
    }
  }

  if (platform === 'win32') {
    for (const name of ['winpty.dll', 'winpty-agent.exe']) {
      copyIfPresent(path.join(sourceDirectory, name), path.join(outputDirectory, name));
    }
    const conptyDirectory = path.join(sourceDirectory, 'conpty');
    for (const name of ['conpty.dll', 'OpenConsole.exe']) {
      copyIfPresent(path.join(conptyDirectory, name), path.join(outputDirectory, name));
    }
  }
}

function resolveLauncherSource() {
  const candidate = path.join(tuiPackageRoot, 'dist', `vortex${executableSuffix}`);
  if (!existsSync(candidate)) throw new Error(`VORTEX executable was not produced at ${candidate}.`);
  return candidate;
}

function resolveCodexSidecarSource() {
  const plain = path.join(codexBinariesRoot, `codex-sidecar${executableSuffix}`);
  if (existsSync(plain)) return plain;
  const tagged = readdirSync(codexBinariesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith('codex-sidecar-') && entry.name.endsWith(executableSuffix))
    .sort((left, right) => left.name.localeCompare(right.name))[0];
  if (tagged) return path.join(codexBinariesRoot, tagged.name);
  throw new Error(`Codex sidecar was not found in ${codexBinariesRoot}. Build it or remove --skip-sidecar-build.`);
}

function resolveOutputDirectory(rawOutput) {
  if (!rawOutput) return path.join(tuiPackageRoot, 'dist', 'vortex-production');
  return path.resolve(repositoryRoot, rawOutput);
}

function buildProductionBundle(options) {
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error(`Unsupported VORTEX platform: ${platform}.`);
  if (!SUPPORTED_ARCHITECTURES.has(architecture)) throw new Error(`Unsupported VORTEX architecture: ${architecture}.`);

  const bun = resolveBun();
  const environment = buildEnvironment(bun);
  const nativeDirectory = resolveNodePtyNativeDirectory();
  process.stdout.write(`Building VORTEX for ${platformArchitecture}...\n`);

  if (!options.skipSidecarBuild) {
    process.stdout.write('Building the Codex sidecar...\n');
    run(npmCommand, ['run', '-w', '@hyscode/codex-sidecar', 'build'], environment);
  }
  process.stdout.write('Building the minified standalone executable...\n');
  run(bun.command, [
    'build',
    '--compile',
    '--minify',
    '--define',
    '__HYSCODE_TUI_VERSION__=' + JSON.stringify(options.version),
    'tools/hyscode-tui/src/main.ts',
    '--outfile',
    'tools/hyscode-tui/dist/vortex',
  ], environment);

  const outputDirectory = resolveOutputDirectory(options.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  const launcherDestination = path.join(outputDirectory, `vortex${executableSuffix}`);
  const sidecarDestination = path.join(outputDirectory, `codex-sidecar${executableSuffix}`);
  copyFileSync(resolveLauncherSource(), launcherDestination);
  copyFileSync(resolveCodexSidecarSource(), sidecarDestination);
  stageNodePtyAssets(nativeDirectory, outputDirectory);
  if (platform !== 'win32') {
    chmodSync(launcherDestination, 0o755);
    chmodSync(sidecarDestination, 0o755);
  }

  process.stdout.write(`Production bundle written to ${outputDirectory}\n`);
  return { outputDirectory, launcherDestination, sidecarDestination };
}

function updateWindowsUserPath(installDirectory) {
  const command = commandAvailable('pwsh') ? 'pwsh' : 'powershell.exe';
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$entry = [System.IO.Path]::GetFullPath($env:VORTEX_PATH_ENTRY_INTERNAL).TrimEnd([char[]]@("\\", "/"))',
    '$userPath = [Environment]::GetEnvironmentVariable("Path", "User")',
    '$entries = if ([string]::IsNullOrWhiteSpace($userPath)) { @() } else { @($userPath -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) }',
    '$normalized = $entry.ToLowerInvariant()',
    '$exists = $false',
    'foreach ($candidate in $entries) { try { if ([System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($candidate.Trim().Trim([char]34))).TrimEnd([char[]]@("\\", "/")).ToLowerInvariant() -eq $normalized) { $exists = $true } } catch { } }',
    'if (-not $exists) { [Environment]::SetEnvironmentVariable("Path", (@($entries + $entry) -join ";"), "User") }',
  ].join('\n');
  const environment = { ...process.env, [WINDOWS_PATH_ENTRY_ENV]: installDirectory };
  const result = spawnSync(command, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error(`Could not update the Windows user PATH: ${result.error?.message ?? result.status}`);
}

function shellConfigurationFiles() {
  const userHome = os.homedir();
  const shellName = path.basename(process.env.SHELL ?? '');
  if (shellName === 'fish') return [path.join(userHome, '.config', 'fish', 'config.fish')];
  if (shellName === 'zsh') return [path.join(userHome, '.zshrc')];
  if (shellName === 'bash') {
    return platform === 'darwin'
      ? [path.join(userHome, '.bash_profile'), path.join(userHome, '.bashrc')].filter((filePath) => existsSync(filePath) || filePath.endsWith('.bash_profile'))
      : [path.join(userHome, '.bashrc')];
  }
  return [path.join(userHome, '.profile')];
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function configureUnixPath(installDirectory) {
  const marker = '# VORTEX user-local bin';
  const shellName = path.basename(process.env.SHELL ?? '');
  const escapedPath = installDirectory.replace(/(["\\$`])/g, '\\$1');
  const line = shellName === 'fish'
    ? `fish_add_path -g -- ${shellQuote(installDirectory)} ${marker}`
    : `export PATH="${escapedPath}:$PATH" ${marker}`;
  for (const configurationFile of shellConfigurationFiles()) {
    const existing = existsSync(configurationFile) ? readFileSync(configurationFile, 'utf8') : '';
    if (existing.includes(marker) || existing.includes(installDirectory)) continue;
    mkdirSync(path.dirname(configurationFile), { recursive: true });
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(configurationFile, `${existing}${prefix}${line}\n`, 'utf8');
    process.stdout.write(`Added VORTEX to ${configurationFile}.\n`);
  }
}

function resolveInstallDirectory() {
  if (process.env.VORTEX_BIN_DIR) return path.resolve(process.env.VORTEX_BIN_DIR);
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Vortex', 'bin');
  }
  return path.resolve(process.env.XDG_BIN_HOME || path.join(os.homedir(), '.local', 'bin'));
}

function installBundle(bundle) {
  const installDirectory = resolveInstallDirectory();
  mkdirSync(installDirectory, { recursive: true });
  if (path.resolve(bundle.outputDirectory) !== path.resolve(installDirectory)) copyTree(bundle.outputDirectory, installDirectory);

  if (platform === 'win32') updateWindowsUserPath(installDirectory);
  else configureUnixPath(installDirectory);
  process.stdout.write(`VORTEX installed at ${installDirectory}.\n`);
  process.stdout.write('Open a new terminal, then run: vortex.\n');
  return installDirectory;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.prepareNative) {
    const nativeDirectory = resolveNodePtyNativeDirectory();
    process.stdout.write(`Prepared node-pty native assets for ${platformArchitecture} from ${nativeDirectory}.\n`);
    return;
  }
  const bundle = buildProductionBundle(options);
  if (options.install) installBundle(bundle);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

#!/usr/bin/env node

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const platformNames = new Map([
  ['win32', 'windows'],
  ['linux', 'linux'],
  ['darwin', 'macos'],
]);
const supportedPlatforms = new Set(platformNames.keys());
const supportedArchitectures = new Set(['x64', 'arm64']);

function parseArguments(args) {
  const options = {
    bundle: null,
    outputDirectory: null,
    version: null,
    platform: process.platform,
    architecture: process.arch,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--bundle' || argument === '--output-dir' || argument === '--version' || argument === '--platform' || argument === '--arch') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error(argument + ' requires a value.');
      if (argument === '--bundle') options.bundle = value;
      if (argument === '--output-dir') options.outputDirectory = value;
      if (argument === '--version') options.version = value;
      if (argument === '--platform') options.platform = value;
      if (argument === '--arch') options.architecture = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--bundle=')) options.bundle = argument.slice('--bundle='.length);
    else if (argument.startsWith('--output-dir=')) options.outputDirectory = argument.slice('--output-dir='.length);
    else if (argument.startsWith('--version=')) options.version = argument.slice('--version='.length);
    else if (argument.startsWith('--platform=')) options.platform = argument.slice('--platform='.length);
    else if (argument.startsWith('--arch=')) options.architecture = argument.slice('--arch='.length);
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error('Unknown option: ' + argument);
  }

  return options;
}

function printHelp() {
  process.stdout.write([
    'VORTEX CLI archive packager',
    '',
    'Usage: node scripts/package-vortex-cli.mjs --bundle <directory> --output-dir <directory> --version <version>',
    '',
    'Options:',
    '  --bundle <directory>      Production VORTEX bundle to package',
    '  --output-dir <directory> Output directory for the archive',
    '  --version <version>      Release version embedded in the asset name',
    '  --platform <platform>    win32, linux, or darwin (defaults to the host)',
    '  --arch <arch>            x64 or arm64 (defaults to the host)',
    '  -h, --help               Show this help',
    '',
  ].join('\n'));
}

function resolveRequiredPath(rawPath, name) {
  if (!rawPath) throw new Error('--' + name + ' is required.');
  return path.resolve(process.cwd(), rawPath);
}

function validateOptions(options) {
  if (!supportedPlatforms.has(options.platform)) {
    throw new Error('Unsupported VORTEX package platform: ' + options.platform + '.');
  }
  if (!supportedArchitectures.has(options.architecture)) {
    throw new Error('Unsupported VORTEX package architecture: ' + options.architecture + '.');
  }
  if (!options.version || /[\\/\s]/u.test(options.version)) {
    throw new Error('--version must be a non-empty release version without spaces or path separators.');
  }
  options.bundle = resolveRequiredPath(options.bundle, 'bundle');
  options.outputDirectory = resolveRequiredPath(options.outputDirectory, 'output-dir');
  if (!existsSync(options.bundle)) throw new Error('VORTEX bundle not found: ' + options.bundle);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw new Error('Could not start ' + command + ': ' + result.error.message);
  if (result.status !== 0) throw new Error(command + ' failed with exit code ' + result.status + '.');
}

function writeWindowsInstaller(directory) {
  writeFileSync(path.join(directory, 'install.ps1'), [
    '$ErrorActionPreference = "Stop"',
    '$source = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$target = Join-Path $env:LOCALAPPDATA "Vortex\\bin"',
    'New-Item -ItemType Directory -Force -Path $target | Out-Null',
    'Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -ne "install.ps1" } | Copy-Item -Destination $target -Recurse -Force',
    '$userPath = [Environment]::GetEnvironmentVariable("Path", "User")',
    '$entries = if ([string]::IsNullOrWhiteSpace($userPath)) { @() } else { @($userPath -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) }',
    '$normalizedTarget = [System.IO.Path]::GetFullPath($target).TrimEnd([char[]]@("\\", "/")).ToLowerInvariant()',
    '$hasTarget = $false',
    'foreach ($entry in $entries) { try { if ([System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($entry.Trim())).TrimEnd([char[]]@("\\", "/")).ToLowerInvariant() -eq $normalizedTarget) { $hasTarget = $true } } catch { } }',
    'if (-not $hasTarget) { [Environment]::SetEnvironmentVariable("Path", (@($entries + $target) -join ";"), "User") }',
    'Write-Host "VORTEX installed at $target"',
    'Write-Host "Open a new terminal, then run: vortex"',
  ].join('\r\n'), 'utf8');
}

function writePosixInstaller(directory) {
  writeFileSync(path.join(directory, 'install.sh'), [
    '#!/usr/bin/env sh',
    'set -eu',
    'SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'TARGET_DIR="\${XDG_DATA_HOME:-$HOME/.local}/vortex"',
    'BIN_DIR="\${XDG_BIN_HOME:-$HOME/.local/bin}"',
    'mkdir -p "$TARGET_DIR" "$BIN_DIR"',
    'cp -R "$SOURCE_DIR"/. "$TARGET_DIR"/',
    'chmod +x "$TARGET_DIR/vortex"',
    'ln -sfn "$TARGET_DIR/vortex" "$BIN_DIR/vortex"',
    'MARKER="# VORTEX user-local bin"',
    'PATH_LINE=\'export PATH="$HOME/.local/bin:$PATH" # VORTEX user-local bin\'',
    'for PROFILE in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do',
    '  if [ -f "$PROFILE" ] && grep -Fq "$MARKER" "$PROFILE"; then continue; fi',
    '  printf "\\n%s\\n" "$PATH_LINE" >> "$PROFILE"',
    'done',
    'echo "VORTEX installed at $TARGET_DIR"',
    'echo "Open a new terminal, then run: vortex"',
  ].join('\n'), 'utf8');
  chmodSync(path.join(directory, 'install.sh'), 0o755);
}

function writePackageMetadata(directory, options, platformName) {
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
    name: 'vortex-cli',
    version: options.version,
    platform: platformName,
    architecture: options.architecture,
    executable: platformName === 'windows' ? 'vortex.exe' : 'vortex',
    sidecar: platformName === 'windows' ? 'codex-sidecar.exe' : 'codex-sidecar',
  }, null, 2) + '\n', 'utf8');
  writeFileSync(path.join(directory, 'README.txt'), [
    'VORTEX CLI ' + options.version,
    '',
    'This archive contains the complete VORTEX CLI runtime, including the',
    'Codex sidecar and the native node-pty assets required for terminal tools.',
    '',
    platformName === 'windows'
      ? 'Install for the current user by running install.ps1 in PowerShell.'
      : 'Install for the current user by running: sh install.sh',
    '',
    'After installation, open a new terminal and run: vortex --help',
  ].join('\n') + '\n', 'utf8');
}

function assertBundleContents(bundle, platformName) {
  const suffix = platformName === 'windows' ? '.exe' : '';
  const requiredFiles = ['vortex' + suffix, 'codex-sidecar' + suffix];
  for (const fileName of requiredFiles) {
    if (!existsSync(path.join(bundle, fileName))) {
      throw new Error('VORTEX bundle is missing ' + fileName + ': ' + bundle);
    }
  }
}

function createArchive(options) {
  const platformName = platformNames.get(options.platform);
  const archiveBaseName = 'vortex-cli-' + options.version + '-' + platformName + '-' + options.architecture;
  const stagingRoot = path.join(options.outputDirectory, 'staging');
  const stagingDirectory = path.join(stagingRoot, archiveBaseName);
  mkdirSync(options.outputDirectory, { recursive: true });
  rmSync(stagingDirectory, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  cpSync(options.bundle, stagingDirectory, { recursive: true });
  assertBundleContents(stagingDirectory, platformName);
  if (platformName === 'windows') writeWindowsInstaller(stagingDirectory);
  else writePosixInstaller(stagingDirectory);
  writePackageMetadata(stagingDirectory, options, platformName);

  const archivePath = path.join(
    options.outputDirectory,
    archiveBaseName + (platformName === 'windows' ? '.zip' : '.tar.gz'),
  );
  rmSync(archivePath, { force: true });
  if (platformName === 'windows') {
    run('tar', ['-a', '-c', '-f', archivePath, '-C', stagingRoot, archiveBaseName], options.outputDirectory);
  } else {
    run('tar', ['-czf', archivePath, '-C', stagingRoot, archiveBaseName], options.outputDirectory);
  }
  if (!existsSync(archivePath)) throw new Error('VORTEX archive was not produced: ' + archivePath);
  process.stdout.write('VORTEX CLI archive written to ' + archivePath + '\n');
  return archivePath;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  validateOptions(options);
  createArchive(options);
}

try {
  main();
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + os.EOL);
  process.exitCode = 1;
}

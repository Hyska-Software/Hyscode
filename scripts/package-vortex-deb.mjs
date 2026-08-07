#!/usr/bin/env node

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const debianArchitectures = new Map([
  ['x64', 'amd64'],
  ['amd64', 'amd64'],
  ['arm64', 'arm64'],
]);

function parseArguments(args) {
  const options = {
    mode: 'standalone',
    bundle: null,
    desktopDeb: null,
    outputDirectory: null,
    version: null,
    architecture: process.arch,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--mode' || argument === '--bundle' || argument === '--desktop-deb' || argument === '--output-dir' || argument === '--version' || argument === '--arch') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error(argument + ' requires a value.');
      if (argument === '--mode') options.mode = value;
      if (argument === '--bundle') options.bundle = value;
      if (argument === '--desktop-deb') options.desktopDeb = value;
      if (argument === '--output-dir') options.outputDirectory = value;
      if (argument === '--version') options.version = value;
      if (argument === '--arch') options.architecture = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--mode=')) options.mode = argument.slice('--mode='.length);
    else if (argument.startsWith('--bundle=')) options.bundle = argument.slice('--bundle='.length);
    else if (argument.startsWith('--desktop-deb=')) options.desktopDeb = argument.slice('--desktop-deb='.length);
    else if (argument.startsWith('--output-dir=')) options.outputDirectory = argument.slice('--output-dir='.length);
    else if (argument.startsWith('--version=')) options.version = argument.slice('--version='.length);
    else if (argument.startsWith('--arch=')) options.architecture = argument.slice('--arch='.length);
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error('Unknown option: ' + argument);
  }

  return options;
}

function printHelp() {
  process.stdout.write([
    'VORTEX Debian package builder',
    '',
    'Usage: node scripts/package-vortex-deb.mjs --mode standalone|desktop-with-cli --bundle <directory> --output-dir <directory> --version <version>',
    '',
    'Options:',
    '  --mode <mode>             standalone or desktop-with-cli',
    '  --bundle <directory>      Production VORTEX bundle',
    '  --desktop-deb <file>      Desktop .deb for desktop-with-cli mode',
    '  --output-dir <directory> Output directory for the .deb',
    '  --version <version>       Release version',
    '  --arch <arch>             x64 or arm64 (defaults to the host)',
    '  -h, --help                Show this help',
    '',
  ].join('\n'));
}

function resolvePath(rawPath, name) {
  if (!rawPath) throw new Error('--' + name + ' is required.');
  return path.resolve(process.cwd(), rawPath);
}

function validateOptions(options) {
  if (options.mode !== 'standalone' && options.mode !== 'desktop-with-cli') {
    throw new Error('Unsupported Debian package mode: ' + options.mode + '.');
  }
  if (!options.version || /[\\/\s]/u.test(options.version)) {
    throw new Error('--version must be a non-empty release version without spaces or path separators.');
  }
  options.bundle = resolvePath(options.bundle, 'bundle');
  options.outputDirectory = resolvePath(options.outputDirectory, 'output-dir');
  if (options.mode === 'desktop-with-cli') options.desktopDeb = resolvePath(options.desktopDeb, 'desktop-deb');
  if (!existsSync(options.bundle)) throw new Error('VORTEX bundle not found: ' + options.bundle);
  if (options.mode === 'desktop-with-cli' && !existsSync(options.desktopDeb)) {
    throw new Error('Desktop Debian package not found: ' + options.desktopDeb);
  }
  if (!debianArchitectures.has(options.architecture)) {
    throw new Error('Unsupported Debian architecture: ' + options.architecture + '.');
  }
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

function writeFile(directory, name, content, executable = false) {
  const filePath = path.join(directory, name);
  writeFileSync(filePath, content, 'utf8');
  if (executable) chmodSync(filePath, 0o755);
  return filePath;
}

function assertBundle(bundle) {
  for (const fileName of ['vortex', 'codex-sidecar']) {
    if (!existsSync(path.join(bundle, fileName))) {
      throw new Error('VORTEX bundle is missing ' + fileName + ': ' + bundle);
    }
  }
}

function createStandaloneRoot(options, root) {
  const debianDirectory = path.join(root, 'DEBIAN');
  mkdirSync(debianDirectory, { recursive: true });
  mkdirSync(path.join(root, 'opt', 'vortex-cli'), { recursive: true });
  mkdirSync(path.join(root, 'usr', 'bin'), { recursive: true });
  cpSync(options.bundle, path.join(root, 'opt', 'vortex-cli'), { recursive: true, force: true });
  symlinkSync('/opt/vortex-cli/vortex', path.join(root, 'usr', 'bin', 'vortex'), 'file');
  writeFile(debianDirectory, 'control', [
    'Package: vortex-cli',
    'Version: ' + options.version,
    'Section: devel',
    'Priority: optional',
    'Architecture: ' + debianArchitectures.get(options.architecture),
    'Maintainer: HysCode <support@hyscode.dev>',
    'Description: VORTEX command-line agent',
    ' Complete VORTEX CLI runtime with the Codex sidecar and terminal support.',
    '',
  ].join('\n'));
}

function stripShebang(script) {
  const lines = script.trim().split(/\r?\n/u);
  return lines[0].startsWith('#!') ? lines.slice(1).join('\n') : lines.join('\n');
}

function optionalCliPostinst(originalPostinst) {
  const header = [
    '#!/bin/sh',
    'set -e',
    'INSTALL_VORTEX_CLI=false',
    'if [ -f /usr/share/debconf/confmodule ]; then',
    '  . /usr/share/debconf/confmodule',
    '  RET=false',
    '  db_get hyscode/install-vortex-cli || true',
    '  if [ "$RET" = "true" ]; then INSTALL_VORTEX_CLI=true; fi',
    'fi',
    'if [ "$INSTALL_VORTEX_CLI" = "true" ]; then',
    '  install -d /usr/local/lib/vortex /usr/local/bin',
    '  cp -a /opt/hyscode/vortex-cli/. /usr/local/lib/vortex/',
    '  ln -sfn /usr/local/lib/vortex/vortex /usr/local/bin/vortex',
    'elif [ -L /usr/local/bin/vortex ] && [ "$(readlink /usr/local/bin/vortex)" = "/usr/local/lib/vortex/vortex" ]; then',
    '  rm -f /usr/local/bin/vortex',
    '  rm -rf /usr/local/lib/vortex',
    'fi',
  ].join('\n');
  const original = originalPostinst ? stripShebang(originalPostinst) : '';
  return header + (original ? '\n' + original : '') + '\n';
}

function optionalCliPostrm(originalPostrm) {
  const header = [
    '#!/bin/sh',
    'set -e',
    'if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then',
    '  if [ -L /usr/local/bin/vortex ] && [ "$(readlink /usr/local/bin/vortex)" = "/usr/local/lib/vortex/vortex" ]; then',
    '    rm -f /usr/local/bin/vortex',
    '    rm -rf /usr/local/lib/vortex',
    '  fi',
    'fi',
  ].join('\n');
  const original = originalPostrm ? stripShebang(originalPostrm) : '';
  return header + (original ? '\n' + original : '') + '\n';
}

function createCombinedRoot(options, root) {
  run('dpkg-deb', ['--raw-extract', options.desktopDeb, root], process.cwd());
  const debianDirectory = path.join(root, 'DEBIAN');
  const originalPostinstPath = path.join(debianDirectory, 'postinst');
  const originalPostrmPath = path.join(debianDirectory, 'postrm');
  const originalPostinst = existsSync(originalPostinstPath) ? readFileSync(originalPostinstPath, 'utf8') : '';
  const originalPostrm = existsSync(originalPostrmPath) ? readFileSync(originalPostrmPath, 'utf8') : '';
  mkdirSync(path.join(root, 'opt', 'hyscode', 'vortex-cli'), { recursive: true });
  cpSync(options.bundle, path.join(root, 'opt', 'hyscode', 'vortex-cli'), { recursive: true, force: true });
  const controlPath = path.join(debianDirectory, 'control');
  const control = readFileSync(controlPath, 'utf8')
    .replace(/^Version:.*$/mu, 'Version: ' + options.version);
  writeFileSync(controlPath, control, 'utf8');
  writeFile(debianDirectory, 'templates', [
    'Template: hyscode/install-vortex-cli',
    'Type: boolean',
    'Default: false',
    'Description: Install the VORTEX command-line agent?',
    ' The desktop installer can also install the complete VORTEX CLI.',
    ' This adds the vortex command to /usr/local/bin.',
    '',
  ].join('\n'));
  writeFile(debianDirectory, 'config', [
    '#!/bin/sh',
    'set -e',
    'if [ -f /usr/share/debconf/confmodule ]; then',
    '  . /usr/share/debconf/confmodule',
    '  db_input medium hyscode/install-vortex-cli || true',
    '  db_go || true',
    'fi',
    '',
  ].join('\n'), true);
  writeFile(debianDirectory, 'postinst', optionalCliPostinst(originalPostinst), true);
  writeFile(debianDirectory, 'postrm', optionalCliPostrm(originalPostrm), true);
}

function buildPackage(options) {
  assertBundle(options.bundle);
  mkdirSync(options.outputDirectory, { recursive: true });
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'hyscode-vortex-deb-'));
  const outputName = options.mode === 'standalone'
    ? 'vortex-cli-' + options.version + '-linux-' + options.architecture + '.deb'
    : 'HysCode-Setup-' + options.version + '-linux-' + options.architecture + '-with-vortex-cli.deb';
  const outputPath = path.join(options.outputDirectory, outputName);
  try {
    if (options.mode === 'standalone') createStandaloneRoot(options, temporaryRoot);
    else createCombinedRoot(options, temporaryRoot);
    rmSync(outputPath, { force: true });
    run('dpkg-deb', ['--build', '--root-owner-group', temporaryRoot, outputPath], process.cwd());
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  if (!existsSync(outputPath)) throw new Error('Debian package was not produced: ' + outputPath);
  process.stdout.write('VORTEX Debian package written to ' + outputPath + '\n');
  return outputPath;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  validateOptions(options);
  buildPackage(options);
}

try {
  main();
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + os.EOL);
  process.exitCode = 1;
}

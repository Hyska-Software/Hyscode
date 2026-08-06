#!/usr/bin/env node

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const supportedArchitectures = new Set(['x64', 'arm64', 'universal']);

function parseArguments(args) {
  const options = {
    bundle: null,
    app: null,
    outputDirectory: null,
    version: null,
    architecture: process.arch,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--bundle' || argument === '--app' || argument === '--output-dir' || argument === '--version' || argument === '--arch') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error(argument + ' requires a value.');
      if (argument === '--bundle') options.bundle = value;
      if (argument === '--app') options.app = value;
      if (argument === '--output-dir') options.outputDirectory = value;
      if (argument === '--version') options.version = value;
      if (argument === '--arch') options.architecture = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--bundle=')) options.bundle = argument.slice('--bundle='.length);
    else if (argument.startsWith('--app=')) options.app = argument.slice('--app='.length);
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
    'VORTEX macOS package builder',
    '',
    'Usage: node scripts/package-vortex-macos.mjs --bundle <directory> --app <HysCode.app> --output-dir <directory> --version <version>',
    '',
    'Options:',
    '  --bundle <directory>      Production VORTEX bundle',
    '  --app <HysCode.app>      Built HysCode application bundle',
    '  --output-dir <directory> Output directory for .pkg assets',
    '  --version <version>       Release version',
    '  --arch <arch>             x64, arm64, or universal',
    '  -h, --help                Show this help',
    '',
  ].join('\n'));
}

function resolvePath(rawPath, name) {
  if (!rawPath) throw new Error('--' + name + ' is required.');
  return path.resolve(process.cwd(), rawPath);
}

function validateOptions(options) {
  if (!options.version || /[\\/\s]/u.test(options.version)) {
    throw new Error('--version must be a non-empty release version without spaces or path separators.');
  }
  if (!supportedArchitectures.has(options.architecture)) {
    throw new Error('Unsupported macOS architecture: ' + options.architecture + '.');
  }
  options.bundle = resolvePath(options.bundle, 'bundle');
  options.app = resolvePath(options.app, 'app');
  options.outputDirectory = resolvePath(options.outputDirectory, 'output-dir');
  options.packageVersion = options.version.match(/^\d+(?:\.\d+)*/u)?.[0] ?? '0.0.0';
  if (!existsSync(options.bundle)) throw new Error('VORTEX bundle not found: ' + options.bundle);
  if (!existsSync(path.join(options.bundle, 'vortex'))) throw new Error('VORTEX bundle is missing vortex: ' + options.bundle);
  if (!existsSync(path.join(options.bundle, 'codex-sidecar'))) throw new Error('VORTEX bundle is missing codex-sidecar: ' + options.bundle);
  if (!existsSync(options.app)) throw new Error('HysCode application bundle not found: ' + options.app);
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

function createStandalonePackage(options, temporaryRoot, outputPath) {
  const payloadRoot = path.join(temporaryRoot, 'payload');
  const scriptsRoot = path.join(temporaryRoot, 'scripts');
  mkdirSync(path.join(payloadRoot, 'usr', 'local', 'lib', 'vortex'), { recursive: true });
  mkdirSync(scriptsRoot, { recursive: true });
  cpSync(options.bundle, path.join(payloadRoot, 'usr', 'local', 'lib', 'vortex'), { recursive: true, force: true });
  writeFile(scriptsRoot, 'postinstall', [
    '#!/bin/sh',
    'set -e',
    'install -d /usr/local/bin',
    'ln -sfn /usr/local/lib/vortex/vortex /usr/local/bin/vortex',
    '',
  ].join('\n'), true);
  run('pkgbuild', [
    '--root', payloadRoot,
    '--identifier', 'com.hyscode.vortex.cli',
    '--version', options.packageVersion,
    '--scripts', scriptsRoot,
    '--install-location', '/',
    outputPath,
  ], process.cwd());
}

function createDistribution(options, directory) {
  const desktopPackage = 'HysCode-Desktop.pkg';
  const cliPackage = 'Vortex-CLI.pkg';
  writeFile(directory, 'distribution.xml', [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<installer-gui-script minSpecVersion="1">',
    '  <title>HysCode</title>',
    '  <options customize="always" require-scripts="false" />',
    '  <domains enable_localSystem="true" enable_currentUserHome="false" />',
    '  <choices-outline>',
    '    <line choice="com.hyscode.desktop" />',
    '    <line choice="com.hyscode.vortex.cli" />',
    '  </choices-outline>',
    '  <choice id="com.hyscode.desktop" title="HysCode" start_selected="true" start_enabled="false">',
    '    <pkg-ref id="com.hyscode.desktop" />',
    '  </choice>',
    '  <choice id="com.hyscode.vortex.cli" title="VORTEX CLI" description="Install the VORTEX command-line agent." start_selected="false">',
    '    <pkg-ref id="com.hyscode.vortex.cli" />',
    '  </choice>',
    '  <pkg-ref id="com.hyscode.desktop" version="' + options.packageVersion + '" onConclusion="none">' + desktopPackage + '</pkg-ref>',
    '  <pkg-ref id="com.hyscode.vortex.cli" version="' + options.packageVersion + '" onConclusion="none">' + cliPackage + '</pkg-ref>',
    '</installer-gui-script>',
    '',
  ].join('\n'));
}

function createCombinedPackage(options, temporaryRoot, outputPath) {
  const componentsRoot = path.join(temporaryRoot, 'components');
  const desktopPackage = path.join(componentsRoot, 'HysCode-Desktop.pkg');
  const cliPackage = path.join(componentsRoot, 'Vortex-CLI.pkg');
  const distributionRoot = path.join(temporaryRoot, 'distribution');
  mkdirSync(componentsRoot, { recursive: true });
  mkdirSync(distributionRoot, { recursive: true });
  run('pkgbuild', [
    '--component', options.app,
    '--identifier', 'com.hyscode.desktop',
    '--version', options.packageVersion,
    desktopPackage,
  ], process.cwd());
  createStandalonePackage(options, temporaryRoot, cliPackage);
  createDistribution(options, distributionRoot);
  run('productbuild', [
    '--distribution', path.join(distributionRoot, 'distribution.xml'),
    '--package-path', componentsRoot,
    outputPath,
  ], process.cwd());
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  validateOptions(options);
  mkdirSync(options.outputDirectory, { recursive: true });
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'hyscode-vortex-macos-'));
  const standalonePath = path.join(
    options.outputDirectory,
    'Vortex-CLI-Setup-' + options.version + '-macos-' + options.architecture + '.pkg',
  );
  const combinedPath = path.join(
    options.outputDirectory,
    'HysCode-Setup-' + options.version + '-macos-' + options.architecture + '-with-vortex-cli.pkg',
  );
  try {
    rmSync(standalonePath, { force: true });
    rmSync(combinedPath, { force: true });
    createStandalonePackage(options, temporaryRoot, standalonePath);
    createCombinedPackage(options, temporaryRoot, combinedPath);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  if (!existsSync(standalonePath) || !existsSync(combinedPath)) {
    throw new Error('macOS VORTEX packages were not produced.');
  }
  process.stdout.write('VORTEX macOS packages written to ' + options.outputDirectory + '\n');
}

try {
  main();
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + os.EOL);
  process.exitCode = 1;
}

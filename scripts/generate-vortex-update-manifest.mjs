#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPOSITORY = 'Hyska-Software/Hyscode';
const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const ALL_TARGETS = [
  ['windows', 'x64'],
  ['windows', 'arm64'],
  ['linux', 'x64'],
  ['linux', 'arm64'],
  ['macos', 'x64'],
  ['macos', 'arm64'],
];
const X64_TARGETS = ALL_TARGETS.filter(([, architecture]) => architecture === 'x64');

function parseArguments(args) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY,
    tag: null,
    releaseId: process.env.GITHUB_RELEASE_ID ?? null,
    version: null,
    output: null,
    assetDirectory: null,
    targets: 'all',
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--repository' || argument === '--tag' || argument === '--release-id' || argument === '--version' || argument === '--output' || argument === '--asset-dir' || argument === '--targets') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error(argument + ' requires a value.');
      if (argument === '--repository') options.repository = value;
      if (argument === '--tag') options.tag = value;
      if (argument === '--release-id') options.releaseId = value;
      if (argument === '--version') options.version = value;
      if (argument === '--output') options.output = value;
      if (argument === '--asset-dir') options.assetDirectory = value;
      if (argument === '--targets') options.targets = value.toLowerCase();
      index += 1;
      continue;
    }
    if (argument.startsWith('--repository=')) options.repository = argument.slice('--repository='.length);
    else if (argument.startsWith('--tag=')) options.tag = argument.slice('--tag='.length);
    else if (argument.startsWith('--release-id=')) options.releaseId = argument.slice('--release-id='.length);
    else if (argument.startsWith('--version=')) options.version = argument.slice('--version='.length);
    else if (argument.startsWith('--output=')) options.output = argument.slice('--output='.length);
    else if (argument.startsWith('--asset-dir=')) options.assetDirectory = argument.slice('--asset-dir='.length);
    else if (argument.startsWith('--targets=')) options.targets = argument.slice('--targets='.length).toLowerCase();
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error('Unknown option: ' + argument);
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    'VORTEX CLI release manifest generator',
    '',
    'Usage: node scripts/generate-vortex-update-manifest.mjs --tag <tag> --output <file>',
    '',
    'The release mode reads the GitHub release assets, downloads every standalone',
    'VORTEX asset, calculates SHA-256, and writes a manifest. By default it requires',
    'all twelve assets (archive + installer for x64 and arm64); --targets x64 limits',
    'the manifest to the six x64 assets used by the automatic release workflow.',
    '--asset-dir is available for local validation.',
    '',
    'Options:',
    '  --repository <owner/name> GitHub repository (defaults to GITHUB_REPOSITORY)',
    '  --tag <tag>              Release tag, for example v0.9.0',
    '  --release-id <id>        Numeric GitHub release id (works for draft releases)',
    '  --version <version>      Release version without the leading v',
    '  --output <file>          Manifest output path',
    '  --asset-dir <directory>  Read local release assets instead of GitHub',
    '  --targets <all|x64>      Required architecture set (defaults to all)',
    '  -h, --help               Show this help',
    '',
  ].join('\n'));
}

function normalizeVersion(value) {
  const version = value.replace(/^v/iu, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error('Release version must use semantic version syntax: ' + value);
  }
  return version;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCliAsset(name, version) {
  const escapedVersion = escapeRegExp(version);
  let match = name.match(new RegExp('^vortex-cli-' + escapedVersion + '-(windows|linux|macos)-(x64|arm64)\\.(zip|tar\\.gz)$', 'iu'));
  if (match) {
    return {
      platform: match[1].toLowerCase(),
      architecture: match[2].toLowerCase(),
      kind: 'archive',
    };
  }

  match = name.match(new RegExp('^Vortex-CLI-Setup-' + escapedVersion + '-(x64|arm64)\\.exe$', 'iu'));
  if (match) return { platform: 'windows', architecture: match[1].toLowerCase(), kind: 'installer' };

  match = name.match(new RegExp('^vortex-cli-' + escapedVersion + '-linux-(x64|arm64)\\.deb$', 'iu'));
  if (match) return { platform: 'linux', architecture: match[1].toLowerCase(), kind: 'installer' };

  match = name.match(new RegExp('^Vortex-CLI-Setup-' + escapedVersion + '-macos-(x64|arm64)\\.pkg$', 'iu'));
  if (match) return { platform: 'macos', architecture: match[1].toLowerCase(), kind: 'installer' };

  return null;
}

function assertAssetSize(size, name) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_ASSET_BYTES) {
    throw new Error('Standalone VORTEX asset has an invalid size: ' + name);
  }
}

function resolveExpectedTargets(mode) {
  if (mode === 'all') return ALL_TARGETS;
  if (mode === 'x64') return X64_TARGETS;
  throw new Error(`Unsupported VORTEX manifest target set: ${mode}. Use all or x64.`);
}

function assertCompleteAssetSet(assets, expectedTargets = ALL_TARGETS) {
  const expected = new Set(expectedTargets.map(([platform, architecture]) => `${platform}:${architecture}`));
  const actual = new Set();
  for (const asset of assets) {
    const key = `${asset.platform}:${asset.architecture}`;
    if (!expected.has(key)) throw new Error('Unsupported VORTEX manifest target: ' + key);
    const identity = `${key}:${asset.kind}`;
    if (actual.has(identity)) throw new Error('Duplicate VORTEX manifest asset: ' + identity);
    actual.add(identity);
  }
  for (const [platform, architecture] of expectedTargets) {
    for (const kind of ['archive', 'installer']) {
      const identity = `${platform}:${architecture}:${kind}`;
      if (!actual.has(identity)) throw new Error('Release is missing VORTEX asset ' + identity + '.');
    }
  }
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function hashFile(filePath) {
  const buffer = readFileSync(filePath);
  return { size: buffer.byteLength, sha256: hashBuffer(buffer) };
}

async function fetchRelease(repository, tag, releaseId = null, fetchImplementation = fetch) {
  const apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const releasePath = releaseId
    ? `/repos/${repository}/releases/${encodeURIComponent(releaseId)}`
    : `/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`;
  const url = `${apiBase}${releasePath}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VORTEX-CLI-Manifest-Generator',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetchImplementation(url, {
    headers,
  });
  if (!response.ok) {
    const lookup = releaseId ? `release id ${releaseId}` : `tag ${tag}`;
    throw new Error(`GitHub release lookup failed with HTTP ${response.status} for ${repository} ${lookup}.`);
  }
  return response.json();
}

async function downloadAsset(asset) {
  const headers = { 'User-Agent': 'VORTEX-CLI-Manifest-Generator' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(asset.browser_download_url, {
    headers,
  });
  if (!response.ok) throw new Error(`Could not download ${asset.name}: HTTP ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength !== asset.size) {
    throw new Error(`Downloaded size for ${asset.name} does not match GitHub metadata.`);
  }
  return { size: buffer.byteLength, sha256: hashBuffer(buffer) };
}

function buildManifest(version, assets, expectedTargets = ALL_TARGETS) {
  assertCompleteAssetSet(assets, expectedTargets);
  return {
    schemaVersion: 1,
    version,
    assets: assets.sort((left, right) => {
      const leftKey = `${left.platform}:${left.architecture}:${left.kind}`;
      const rightKey = `${right.platform}:${right.architecture}:${right.kind}`;
      return leftKey.localeCompare(rightKey);
    }),
  };
}

async function generateFromRelease(options, version, expectedTargets) {
  const release = await fetchRelease(options.repository, options.tag, options.releaseId);
  if (!release || !Array.isArray(release.assets)) throw new Error('GitHub returned an invalid release asset list.');
  const selected = [];
  for (const asset of release.assets) {
    if (!asset || typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') continue;
    const parsed = parseCliAsset(asset.name, version);
    if (!parsed) continue;
    assertAssetSize(asset.size, asset.name);
    process.stdout.write(`Hashing ${asset.name}...\n`);
    const digest = await downloadAsset(asset);
    selected.push({ ...parsed, name: asset.name, size: digest.size, sha256: digest.sha256 });
  }
  return buildManifest(version, selected, expectedTargets);
}

function generateFromDirectory(options, version, expectedTargets) {
  const directory = path.resolve(process.cwd(), options.assetDirectory);
  const selected = [];
  for (const name of readFileNames(directory)) {
    const parsed = parseCliAsset(name, version);
    if (!parsed) continue;
    const filePath = path.join(directory, name);
    const digest = hashFile(filePath);
    assertAssetSize(digest.size, name);
    selected.push({ ...parsed, name, size: digest.size, sha256: digest.sha256 });
  }
  return buildManifest(version, selected, expectedTargets);
}

function readFileNames(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.output) throw new Error('--output is required.');
  if (options.assetDirectory === null && !options.tag && !options.releaseId) throw new Error('--tag or --release-id is required unless --asset-dir is used.');
  const expectedTargets = resolveExpectedTargets(options.targets);
  const version = normalizeVersion(options.version ?? options.tag ?? '');
  const manifest = options.assetDirectory
    ? generateFromDirectory(options, version, expectedTargets)
    : await generateFromRelease(options, version, expectedTargets);
  const outputPath = path.resolve(process.cwd(), options.output);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`VORTEX update manifest written to ${outputPath}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export { ALL_TARGETS, X64_TARGETS, assertCompleteAssetSet, buildManifest, fetchRelease, parseCliAsset, resolveExpectedTargets };

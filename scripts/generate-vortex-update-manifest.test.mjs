import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { X64_TARGETS, buildManifest, fetchRelease, parseCliAsset } from './generate-vortex-update-manifest.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('./generate-vortex-update-manifest.mjs', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const version = '0.9.0';
const x64AssetNames = [
  'vortex-cli-0.9.0-windows-x64.zip',
  'Vortex-CLI-Setup-0.9.0-x64.exe',
  'vortex-cli-0.9.0-linux-x64.tar.gz',
  'vortex-cli-0.9.0-linux-x64.deb',
  'vortex-cli-0.9.0-macos-x64.tar.gz',
  'Vortex-CLI-Setup-0.9.0-macos-x64.pkg',
];

async function runGenerator(assetDirectory, outputPath) {
  try {
    const result = await execFileAsync(process.execPath, [
      scriptPath,
      '--asset-dir',
      assetDirectory,
      '--version',
      version,
      '--targets',
      'x64',
      '--output',
      outputPath,
    ], { cwd: repositoryRoot });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      status: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'hyscode-vortex-manifest-'));
  const assetDirectory = path.join(root, 'assets');
  mkdirSync(assetDirectory);
  for (const name of x64AssetNames) {
    writeFileSync(path.join(assetDirectory, name), Buffer.from(`fixture:${name}`, 'utf8'));
  }
  return { root, assetDirectory, outputPath: path.join(root, 'manifest.json') };
}

test('generates a manifest from the six x64 VORTEX fixture assets', async () => {
  const fixture = createFixture();
  try {
    const result = await runGenerator(fixture.assetDirectory, fixture.outputPath);
    assert.equal(result.status, 0, result.stderr);

    const manifest = JSON.parse(readFileSync(fixture.outputPath, 'utf8'));
    assert.equal(manifest.version, version);
    assert.equal(manifest.assets.length, 6);
    assert.deepEqual(
      manifest.assets.map((asset) => `${asset.platform}:${asset.architecture}:${asset.kind}`),
      [
        'linux:x64:archive',
        'linux:x64:installer',
        'macos:x64:archive',
        'macos:x64:installer',
        'windows:x64:archive',
        'windows:x64:installer',
      ],
    );
    for (const asset of manifest.assets) {
      assert.equal(asset.size, Buffer.byteLength(`fixture:${asset.name}`, 'utf8'));
      assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects a manifest when an expected x64 asset is missing', async () => {
  const fixture = createFixture();
  try {
    unlinkSync(path.join(fixture.assetDirectory, 'vortex-cli-0.9.0-linux-x64.deb'));
    const result = await runGenerator(fixture.assetDirectory, fixture.outputPath);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /missing VORTEX asset linux:x64:installer/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects duplicate assets for the same platform, architecture, and kind', () => {
  const assets = x64AssetNames.map((name) => ({
    ...parseCliAsset(name, version),
    name,
    size: 1,
    sha256: '0'.repeat(64),
  }));
  assert.throws(
    () => buildManifest(version, [...assets, { ...assets[0], name: 'duplicate-vortex-asset.zip' }], X64_TARGETS),
    /Duplicate VORTEX manifest asset: windows:x64:archive/u,
  );
});

test('looks up a draft release by its numeric release id', async () => {
  const requests = [];
  const fetchImplementation = async (url, init) => {
    requests.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: 367495683, tag_name: 'v0.9.0', draft: true, assets: [] };
      },
    };
  };

  const release = await fetchRelease('Hyska-Software/Hyscode', 'v0.9.0', '367495683', fetchImplementation);
  assert.equal(release.draft, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.github.com/repos/Hyska-Software/Hyscode/releases/367495683');
});

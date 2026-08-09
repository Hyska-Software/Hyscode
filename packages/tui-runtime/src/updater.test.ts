import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { CliUpdater, CliUpdaterError, compareReleaseVersions, resolveTarget, runUpdateHelper } from './updater';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryExecutableDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vortex-updater-test-'));
  temporaryDirectories.push(directory);
  await writeFile(path.join(directory, 'vortex.exe'), 'current', 'utf8');
  await mkdir(path.join(directory, 'node-pty-assets'), { recursive: true });
  return directory;
}

async function temporaryPosixBundle(directory: string, version: string): Promise<string> {
  const bundle = path.join(directory, `vortex-cli-${version}-linux-x64`);
  await mkdir(path.join(bundle, 'node-pty-assets', 'linux-x64'), { recursive: true });
  await writeFile(path.join(bundle, 'vortex'), `#!/usr/bin/env sh\nprintf 'vortex ${version}\\n'\n`, 'utf8');
  await chmod(path.join(bundle, 'vortex'), 0o755);
  await writeFile(path.join(bundle, 'codex-sidecar'), 'sidecar', 'utf8');
  await writeFile(path.join(bundle, 'node-pty-assets', 'linux-x64', 'pty.node'), 'pty', 'utf8');
  await writeFile(path.join(bundle, 'node-pty-assets', 'linux-x64', 'spawn-helper'), 'helper', 'utf8');
  return bundle;
}

function jsonResponse(value: unknown, url = ''): Response {
  const response = new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function binaryResponse(value: Uint8Array, url = ''): Response {
  const response = new Response(Buffer.from(value), {
    status: 200,
    headers: { 'content-length': String(value.byteLength) },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('VORTEX updater', () => {
  it('compares stable and prerelease versions according to semantic ordering', () => {
    expect(compareReleaseVersions('v1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareReleaseVersions('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareReleaseVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareReleaseVersions('1.0.0-beta.1', '1.0.0-beta.1')).toBe(0);
  });

  it('rejects unsupported operating system and architecture pairs', () => {
    expect(resolveTarget('win32', 'x64')).toEqual({ platform: 'windows', architecture: 'x64' });
    expect(() => resolveTarget('freebsd' as NodeJS.Platform, 'x64')).toThrow(CliUpdaterError);
    expect(() => resolveTarget('linux', 'ia32')).toThrow('not available');
  });

  it('selects the exact platform archive from a validated release manifest', async () => {
    const installRoot = await temporaryExecutableDirectory();
    const manifestUrl = 'https://objects.githubusercontent.com/vortex-cli-manifest-0.9.0.json';
    const archiveUrl = 'https://objects.githubusercontent.com/vortex-cli-0.9.0-windows-x64.zip';
    const manifest = {
      schemaVersion: 1,
      version: '0.9.0',
      assets: [
        {
          platform: 'windows',
          architecture: 'x64',
          kind: 'archive',
          name: 'vortex-cli-0.9.0-windows-x64.zip',
          size: 1234,
          sha256: 'a'.repeat(64),
        },
        {
          platform: 'linux',
          architecture: 'x64',
          kind: 'archive',
          name: 'vortex-cli-0.9.0-linux-x64.tar.gz',
          size: 1234,
          sha256: 'b'.repeat(64),
        },
      ],
    };
    const release = {
      tag_name: 'v0.9.0',
      html_url: 'https://github.com/Hyska-Software/Hyscode/releases/tag/v0.9.0',
      body: 'Update notes',
      published_at: '2026-08-06T12:00:00Z',
      assets: [
        { name: 'vortex-cli-manifest-0.9.0.json', browser_download_url: manifestUrl, size: JSON.stringify(manifest).length },
        { name: 'vortex-cli-0.9.0-windows-x64.zip', browser_download_url: archiveUrl, size: 1234 },
        { name: 'vortex-cli-0.9.0-linux-x64.tar.gz', browser_download_url: 'https://objects.githubusercontent.com/vortex-cli-0.9.0-linux-x64.tar.gz', size: 1234 },
      ],
    };
    const updater = new CliUpdater({
      version: '0.8.2',
      executablePath: path.join(installRoot, 'vortex.exe'),
      platform: 'win32',
      architecture: 'x64',
      fetchImpl: async (url) => url === manifestUrl
        ? jsonResponse(manifest, url)
        : jsonResponse(release, 'https://api.github.com/repos/Hyska-Software/Hyscode/releases/latest'),
    });

    const result = await updater.check('stable');

    expect(result).toMatchObject({ version: '0.9.0', manifestAvailable: true });
    expect(result?.asset).toMatchObject({
      platform: 'windows',
      architecture: 'x64',
      kind: 'archive',
      name: 'vortex-cli-0.9.0-windows-x64.zip',
    });

    const arm64Updater = new CliUpdater({
      version: '0.8.2',
      executablePath: path.join(installRoot, 'vortex.exe'),
      platform: 'linux',
      architecture: 'arm64',
      fetchImpl: async (url) => url === manifestUrl
        ? jsonResponse(manifest, url)
        : jsonResponse(release, 'https://api.github.com/repos/Hyska-Software/Hyscode/releases/latest'),
    });

    expect(await arm64Updater.check('stable')).toBeNull();
  });

  it('requires manual installation when a release has no integrity manifest', async () => {
    const installRoot = await temporaryExecutableDirectory();
    const release = {
      tag_name: 'v0.9.0',
      assets: [{ name: 'vortex-cli-0.9.0-windows-x64.zip', browser_download_url: 'https://objects.githubusercontent.com/update.zip', size: 10 }],
    };
    const updater = new CliUpdater({
      version: '0.8.2',
      executablePath: path.join(installRoot, 'vortex.exe'),
      platform: 'win32',
      architecture: 'x64',
      fetchImpl: async () => jsonResponse(release, 'https://api.github.com/repos/Hyska-Software/Hyscode/releases/latest'),
    });

    const result = await updater.check('stable');

    expect(result?.manifestAvailable).toBe(false);
    expect(result?.asset).toBeNull();
    expect(result?.manualReason).toContain('manifest');
  });

  it('rejects untrusted manifest URLs and asset names before downloading', async () => {
    const installRoot = await temporaryExecutableDirectory();
    const release = {
      tag_name: 'v0.9.0',
      assets: [
        { name: 'vortex-cli-manifest-0.9.0.json', browser_download_url: 'https://evil.example/update.json', size: 10 },
        { name: 'vortex-cli-0.9.0-windows-x64.zip', browser_download_url: 'https://objects.githubusercontent.com/update.zip', size: 10 },
      ],
    };
    const updater = new CliUpdater({
      version: '0.8.2',
      executablePath: path.join(installRoot, 'vortex.exe'),
      platform: 'win32',
      architecture: 'x64',
      fetchImpl: async () => jsonResponse(release, 'https://api.github.com/repos/Hyska-Software/Hyscode/releases/latest'),
    });

    await expect(updater.check('stable')).rejects.toMatchObject({ code: 'network' });
  });

  it('downloads and validates installer bytes using the manifest checksum', async () => {
    const installRoot = await temporaryExecutableDirectory();
    const payload = new TextEncoder().encode('installer-payload');
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const release = {
      version: '0.9.0',
      tagName: 'v0.9.0',
      body: '',
      publishedAt: '',
      releaseUrl: 'https://github.com/Hyska-Software/Hyscode/releases/tag/v0.9.0',
      currentVersion: '0.8.2',
      manifestAvailable: true,
      asset: {
        platform: 'windows' as const,
        architecture: 'x64' as const,
        kind: 'installer' as const,
        name: 'Vortex-CLI-Setup-0.9.0-x64.exe',
        url: 'https://objects.githubusercontent.com/Vortex-CLI-Setup-0.9.0-x64.exe',
        size: payload.byteLength,
        sha256,
      },
      assets: [],
      installation: {
        kind: 'user-local' as const,
        mode: 'installer' as const,
        executablePath: path.join(installRoot, 'vortex.exe'),
        installRoot,
        writable: true,
      },
    };
    const updater = new CliUpdater({
      version: '0.8.2',
      executablePath: path.join(installRoot, 'vortex.exe'),
      platform: 'win32',
      architecture: 'x64',
      fetchImpl: async () => binaryResponse(payload, release.asset?.url),
    });

    const update = await updater.download(release);

    expect(update.asset.sha256).toBe(sha256);
    expect(update.stagedBundlePath).toBeNull();
  });

  it('fails before installation when the downloaded bytes do not match SHA-256', async () => {
    const installRoot = await temporaryExecutableDirectory();
    const payload = new TextEncoder().encode('tampered');
    const release = {
      version: '0.9.0',
      tagName: 'v0.9.0',
      body: '',
      publishedAt: '',
      releaseUrl: 'https://github.com/Hyska-Software/Hyscode/releases/tag/v0.9.0',
      currentVersion: '0.8.2',
      manifestAvailable: true,
      asset: {
        platform: 'windows' as const,
        architecture: 'x64' as const,
        kind: 'installer' as const,
        name: 'Vortex-CLI-Setup-0.9.0-x64.exe',
        url: 'https://objects.githubusercontent.com/Vortex-CLI-Setup-0.9.0-x64.exe',
        size: payload.byteLength,
        sha256: '0'.repeat(64),
      },
      assets: [],
      installation: {
        kind: 'user-local' as const,
        mode: 'installer' as const,
        executablePath: path.join(installRoot, 'vortex.exe'),
        installRoot,
        writable: true,
      },
    };
    const updater = new CliUpdater({ version: '0.8.2', executablePath: path.join(installRoot, 'vortex.exe'), platform: 'win32', architecture: 'x64', fetchImpl: async () => binaryResponse(payload, release.asset?.url) });

    await expect(updater.download(release)).rejects.toMatchObject({ code: 'integrity' });
  });

  it.skipIf(process.platform === 'win32')('stages and validates a complete native archive before applying it', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'vortex-updater-archive-test-'));
    temporaryDirectories.push(directory);
    const bundle = await temporaryPosixBundle(directory, '0.9.0');
    const archivePath = path.join(directory, 'vortex-cli-0.9.0-linux-x64.tar.gz');
    const archiveResult = spawnSync('tar', ['-czf', archivePath, '-C', directory, path.basename(bundle)], { windowsHide: true });
    expect(archiveResult.status).toBe(0);
    const payload = await readFile(archivePath);
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const installRoot = path.join(directory, 'current');
    await mkdir(path.join(installRoot, 'node-pty-assets'), { recursive: true });
    await writeFile(path.join(installRoot, 'vortex'), 'current', 'utf8');

    const release = {
      version: '0.9.0',
      tagName: 'v0.9.0',
      body: '',
      publishedAt: '',
      releaseUrl: 'https://github.com/Hyska-Software/Hyscode/releases/tag/v0.9.0',
      currentVersion: '0.8.2',
      manifestAvailable: true,
      asset: {
        platform: 'linux' as const,
        architecture: 'x64' as const,
        kind: 'archive' as const,
        name: 'vortex-cli-0.9.0-linux-x64.tar.gz',
        url: 'https://objects.githubusercontent.com/vortex-cli-0.9.0-linux-x64.tar.gz',
        size: payload.byteLength,
        sha256,
      },
      assets: [],
      installation: {
        kind: 'user-local' as const,
        mode: 'direct' as const,
        executablePath: path.join(installRoot, 'vortex'),
        installRoot,
        writable: true,
      },
    };
    const updater = new CliUpdater({
      version: '0.8.2',
      executablePath: path.join(installRoot, 'vortex'),
      platform: 'linux',
      architecture: 'x64',
      fetchImpl: async () => binaryResponse(payload, release.asset?.url),
    });

    const update = await updater.download(release);

    expect(update.stagedBundlePath).toContain('vortex-cli-0.9.0-linux-x64');
    expect(await readFile(path.join(update.stagedBundlePath!, 'vortex'), 'utf8')).toContain('vortex 0.9.0');
  });

  it.skipIf(process.platform === 'win32')('restores the previous installation after staged bundle validation fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'vortex-updater-rollback-test-'));
    temporaryDirectories.push(directory);
    const targetRoot = await temporaryPosixBundle(directory, '0.8.2');
    const stagedRoot = path.join(directory, 'staged');
    await mkdir(path.join(stagedRoot, 'node-pty-assets', 'linux-x64'), { recursive: true });
    await writeFile(path.join(stagedRoot, 'vortex'), '#!/usr/bin/env sh\nprintf "vortex 0.8.2\\n"\n', 'utf8');
    await chmod(path.join(stagedRoot, 'vortex'), 0o755);
    await writeFile(path.join(stagedRoot, 'codex-sidecar'), 'sidecar', 'utf8');
    await writeFile(path.join(stagedRoot, 'node-pty-assets', 'linux-x64', 'pty.node'), 'pty', 'utf8');
    await writeFile(path.join(stagedRoot, 'node-pty-assets', 'linux-x64', 'spawn-helper'), 'helper', 'utf8');
    const helperDirectory = path.join(directory, 'helper');
    const temporaryRoot = path.join(directory, 'temporary');
    await mkdir(helperDirectory, { recursive: true });
    await mkdir(temporaryRoot, { recursive: true });
    const statePath = path.join(helperDirectory, 'state.json');
    await writeFile(statePath, JSON.stringify({
      parentPid: process.pid,
      targetRoot,
      stagedBundlePath: stagedRoot,
      expectedVersion: '0.9.0',
      architecture: 'x64',
      temporaryRoot,
      helperDirectory,
    }), 'utf8');

    await expect(runUpdateHelper(statePath)).rejects.toMatchObject({ code: 'apply-failed' });
    expect(await readFile(path.join(targetRoot, 'vortex'), 'utf8')).toContain('vortex 0.8.2');
  });
});

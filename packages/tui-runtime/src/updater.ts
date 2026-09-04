import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  access,
  appendFile,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import type { UpdateChannel } from './config';

export type CliUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'applying'
  | 'error'
  | 'unsupported';

export type CliUpdatePlatform = 'windows' | 'linux' | 'macos';
export type CliUpdateArchitecture = 'x64' | 'arm64';
export type CliUpdateAssetKind = 'archive' | 'installer';
export type CliInstallMode = 'direct' | 'installer' | 'manual';
export type CliInstallationKind = 'user-local' | 'system' | 'desktop-bundled' | 'unknown';

export type CliUpdateProgress = {
  downloaded: number;
  total: number;
  percent: number;
};

export type CliUpdateAsset = {
  platform: CliUpdatePlatform;
  architecture: CliUpdateArchitecture;
  kind: CliUpdateAssetKind;
  name: string;
  url: string;
  size: number;
  sha256: string;
};

export type CliInstallation = {
  kind: CliInstallationKind;
  mode: CliInstallMode;
  executablePath: string;
  installRoot: string;
  writable: boolean;
  reason?: string;
};

export type ReleaseInfo = {
  version: string;
  tagName: string;
  body: string;
  publishedAt: string;
  releaseUrl: string;
  currentVersion: string;
  manifestAvailable: boolean;
  asset: CliUpdateAsset | null;
  assets: CliUpdateAsset[];
  installation: CliInstallation;
  manualReason?: string;
};

export type DownloadedUpdate = {
  release: ReleaseInfo;
  asset: CliUpdateAsset;
  archivePath: string;
  stagedBundlePath: string | null;
  temporaryRoot: string;
};

export type CliUpdaterErrorCode =
  | 'network'
  | 'invalid-release'
  | 'integrity'
  | 'unsupported'
  | 'manual-install-required'
  | 'permission'
  | 'apply-failed'
  | 'installer-failed';

export class CliUpdaterError extends Error {
  constructor(
    readonly code: CliUpdaterErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CliUpdaterError';
  }
}

export type CliUpdaterOptions = {
  version: string;
  executablePath?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: CliUpdateProgress) => void;
};

type GitHubAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

type GitHubRelease = {
  tag_name: string;
  html_url?: string;
  body?: string | null;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: GitHubAsset[];
};

type ManifestAsset = {
  platform: CliUpdatePlatform;
  architecture: CliUpdateArchitecture;
  kind: CliUpdateAssetKind;
  name: string;
  size: number;
  sha256: string;
};

type ReleaseManifest = {
  schemaVersion: 1;
  version: string;
  assets: ManifestAsset[];
};

type InstallationLayout = CliInstallation & {
  archiveDirectory: string;
};

type ApplyUpdateState = {
  parentPid: number;
  targetRoot: string;
  stagedBundlePath: string;
  expectedVersion: string;
  architecture: CliUpdateArchitecture;
  temporaryRoot: string;
  helperDirectory: string;
  createdAt: number;
};

const GITHUB_API_BASE = 'https://api.github.com/repos/Hyska-Software/Hyscode/releases';
const GITHUB_RELEASES_PAGE_SIZE = 20;
const USER_AGENT = 'VORTEX-CLI-Updater';
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const DOWNLOAD_PROGRESS_INTERVAL = 1;
const HELPER_WAIT_INTERVAL_MS = 100;
const HELPER_MAX_WAIT_MS = 30_000;
const HELPER_STATE_MAX_AGE_MS = 10 * 60 * 1_000;
const RUN_COMMAND_DEFAULT_TIMEOUT_MS = 30_000;
const WINDOWS_RENAME_ATTEMPTS = 10;
const WINDOWS_RENAME_RETRY_MS = 500;
const WINDOWS_RETRY_ERRORS: Record<string, true> = { EPERM: true, EBUSY: true, ENOTEMPTY: true, EACCES: true };
let lastInstallerTemporaryRoot: string | null = null;

const PLATFORM_NAMES: Record<string, CliUpdatePlatform> = {
  win32: 'windows',
  linux: 'linux',
  darwin: 'macos',
};

const ARCHITECTURE_NAMES: Record<string, CliUpdateArchitecture> = {
  x64: 'x64',
  arm64: 'arm64',
};

const TRUSTED_API_HOSTS = new Set(['api.github.com']);
const TRUSTED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

export class CliUpdater {
  private readonly fetchImpl: typeof fetch;
  private readonly currentVersion: string;
  private readonly executablePathOverride?: string;
  private readonly platform: NodeJS.Platform;
  private readonly architecture: string;
  private onProgress?: (progress: CliUpdateProgress) => void;
  private readonly activeControllers = new Set<AbortController>();
  private pendingTemporaryRoot: string | null = null;

  constructor(options: CliUpdaterOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.currentVersion = normalizeVersion(options.version);
    this.executablePathOverride = options.executablePath;
    this.platform = options.platform ?? process.platform;
    this.architecture = options.architecture ?? process.arch;
    this.onProgress = options.onProgress;
  }

  setProgressListener(listener: ((progress: CliUpdateProgress) => void) | undefined): void {
    this.onProgress = listener;
  }

  cancel(): void {
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
  }

  async cancelPending(): Promise<void> {
    this.cancel();
    if (this.pendingTemporaryRoot) {
      const root = this.pendingTemporaryRoot;
      this.pendingTemporaryRoot = null;
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async check(channel: UpdateChannel = 'stable'): Promise<ReleaseInfo | null> {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    try {
      return await this.checkRelease(channel, controller.signal);
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  private async checkRelease(channel: UpdateChannel, signal: AbortSignal): Promise<ReleaseInfo | null> {
    const target = resolveTarget(this.platform, this.architecture);
    const installation = await detectInstallation(this.executablePathOverride, target.platform);
    const releases = (await this.fetchReleases(channel, signal)).filter((release) => release.draft !== true);
    const candidate = releases
      .map((release) => ({ release, version: parseVersion(release.tag_name) }))
      .filter((entry): entry is { release: GitHubRelease; version: ParsedVersion } => entry.version !== null)
      .filter(({ version }) => compareVersions(version, parseVersion(this.currentVersion) as ParsedVersion) > 0)
      .filter(({ release }) => releaseHasCliAsset(release.assets, target.platform, target.architecture))
      .sort((left, right) => compareVersions(right.version, left.version))[0];

    if (!candidate) return null;

    const release = candidate.release;
    const version = formatParsedVersion(candidate.version);
    const baseInfo: Omit<ReleaseInfo, 'manifestAvailable' | 'asset' | 'assets' | 'manualReason'> = {
      version,
      tagName: release.tag_name,
      body: typeof release.body === 'string' ? release.body : '',
      publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
      releaseUrl: release.html_url ?? `https://github.com/Hyska-Software/Hyscode/releases/tag/${encodeURIComponent(release.tag_name)}`,
      currentVersion: this.currentVersion,
      installation,
    };

    const manifestAsset = release.assets.find((asset) => asset.name.toLowerCase() === `vortex-cli-manifest-${version}.json`);
    if (!manifestAsset) {
      return {
        ...baseInfo,
        manifestAvailable: false,
        asset: null,
        assets: [],
        manualReason: 'This release does not publish a VORTEX integrity manifest. Update it manually from the release page.',
      };
    }

    const manifest = await this.fetchManifest(manifestAsset, version, signal);
    const assets = resolveManifestAssets(manifest, release.assets, target.platform, target.architecture);
    const preferredKind = installation.mode === 'direct' ? 'archive' : 'installer';
    const selectedAsset = assets.find((asset) => asset.kind === preferredKind) ?? null;

    if (!selectedAsset) {
      const reason = installation.mode === 'manual'
        ? installation.reason ?? 'This installation must be updated through the HysCode Desktop installer.'
        : `No ${preferredKind} asset is available for ${target.platform}-${target.architecture}.`;
      return {
        ...baseInfo,
        manifestAvailable: true,
        asset: null,
        assets,
        manualReason: reason,
      };
    }

    return {
      ...baseInfo,
      manifestAvailable: true,
      asset: selectedAsset,
      assets,
    };
  }

  async download(release: ReleaseInfo): Promise<DownloadedUpdate> {
    if (!release.manifestAvailable) {
      throw new CliUpdaterError('manual-install-required', release.manualReason ?? 'Manual installation is required for this release.');
    }
    if (!release.asset) {
      throw new CliUpdaterError('unsupported', release.manualReason ?? 'No compatible VORTEX asset is available.');
    }
    validateAsset(release.asset);
    if (lastInstallerTemporaryRoot) {
      const stale = lastInstallerTemporaryRoot;
      lastInstallerTemporaryRoot = null;
      await rm(stale, { recursive: true, force: true }).catch(() => undefined);
    }
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'vortex-update-'));
    this.pendingTemporaryRoot = temporaryRoot;
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const archivePath = path.join(temporaryRoot, release.asset.name);
    try {
      await this.downloadFile(release.asset, archivePath, controller.signal);
      const actualHash = await sha256File(archivePath);
      if (actualHash !== release.asset.sha256.toLowerCase()) {
        throw new CliUpdaterError(
          'integrity',
          `SHA-256 mismatch for ${release.asset.name}. Expected ${release.asset.sha256}, got ${actualHash}.`,
        );
      }
      if (release.asset.kind === 'installer') {
        this.pendingTemporaryRoot = null;
        return { release, asset: release.asset, archivePath, stagedBundlePath: null, temporaryRoot };
      }
      const extractionRoot = path.join(temporaryRoot, 'extracted');
      await mkdir(extractionRoot, { recursive: true });
      await extractArchive(archivePath, extractionRoot, release.asset.platform === 'windows');
      if (release.asset.platform === 'macos') {
        await runCommand('xattr', ['-dr', 'com.apple.quarantine', extractionRoot], { cwd: extractionRoot, allowFailure: true });
      }
      const stagedBundlePath = await locateBundle(extractionRoot, release.asset.platform);
      await validateBundle(stagedBundlePath, release.version, release.asset.platform, release.asset.architecture);
      this.pendingTemporaryRoot = null;
      return { release, asset: release.asset, archivePath, stagedBundlePath, temporaryRoot };
    } catch (error) {
      this.pendingTemporaryRoot = null;
      await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof CliUpdaterError) throw error;
      throw new CliUpdaterError('network', `Could not prepare the VORTEX update: ${errorMessage(error)}`, { cause: error });
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  async apply(update: DownloadedUpdate, options?: { silent?: boolean }): Promise<void> {
    if (update.asset.kind === 'installer') {
      const silent = options?.silent === true;
      await launchInstaller(update.archivePath, update.asset.platform, silent);
      lastInstallerTemporaryRoot = update.temporaryRoot;
      return;
    }
    if (!update.stagedBundlePath) {
      throw new CliUpdaterError('apply-failed', 'The staged VORTEX bundle is missing.');
    }
    const layout = await detectInstallation(this.executablePathOverride, update.asset.platform);
    if (layout.mode !== 'direct' || !layout.writable) {
      throw new CliUpdaterError(
        layout.kind === 'desktop-bundled' ? 'manual-install-required' : 'permission',
        layout.reason ?? 'The current VORTEX installation is not writable.',
      );
    }
    const stagingBundlePath = path.join(
      path.dirname(layout.installRoot),
      `.${path.basename(layout.installRoot)}-update-${randomUUID()}`,
    );
    let helperDirectory: string | null = null;
    try {
      await cp(update.stagedBundlePath, stagingBundlePath, { recursive: true, force: true });
      helperDirectory = await mkdtemp(path.join(os.tmpdir(), 'vortex-update-helper-'));
      if (update.asset.platform !== 'windows') await chmod(helperDirectory, 0o700).catch(() => undefined);
      const helperExecutable = path.join(helperDirectory, `vortex-update-helper${update.asset.platform === 'windows' ? '.exe' : ''}`);
      const executablePath = await resolveExecutablePath(this.executablePathOverride);
      const helperBase = path.basename(executablePath).toLowerCase();
      if (helperBase !== 'vortex' && helperBase !== 'vortex.exe') {
        throw new CliUpdaterError('apply-failed', `Cannot locate the VORTEX executable (resolved to ${executablePath}). Reinstall VORTEX and retry.`);
      }
      await cp(executablePath, helperExecutable, { force: true });
      if (update.asset.platform !== 'windows') await chmod(helperExecutable, 0o755);
      const statePath = path.join(helperDirectory, 'state.json');
      const state: ApplyUpdateState = {
        parentPid: process.pid,
        targetRoot: layout.installRoot,
        stagedBundlePath: stagingBundlePath,
        expectedVersion: update.release.version,
        architecture: update.asset.architecture,
        temporaryRoot: update.temporaryRoot,
        helperDirectory,
        createdAt: Date.now(),
      };
      await writeFile(statePath, `${JSON.stringify(state)}\n`, 'utf8');
      await writeFile(path.join(helperDirectory, 'update.log'), `VORTEX update helper started for ${update.release.version}\n`, 'utf8').catch(() => undefined);
      const child = spawn(helperExecutable, ['--apply-update', statePath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      await once(child, 'spawn');
      child.unref();
    } catch (error) {
      await rm(stagingBundlePath, { recursive: true, force: true }).catch(() => undefined);
      if (helperDirectory) await rm(helperDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof CliUpdaterError) throw error;
      throw new CliUpdaterError('apply-failed', `Could not start the VORTEX update helper: ${errorMessage(error)}`, { cause: error });
    }
  }

  private async fetchReleases(channel: UpdateChannel, signal: AbortSignal): Promise<GitHubRelease[]> {
    if (channel !== 'pre-release') {
      const payload = await this.fetchJson(`${GITHUB_API_BASE}/latest`, false, signal);
      if (!isGitHubRelease(payload)) throw new CliUpdaterError('invalid-release', 'GitHub returned an invalid release.');
      return [payload];
    }
    const collected: GitHubRelease[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const payload = await this.fetchJson(`${GITHUB_API_BASE}?per_page=${GITHUB_RELEASES_PAGE_SIZE}&page=${page}`, false, signal);
      if (!Array.isArray(payload)) throw new CliUpdaterError('invalid-release', 'GitHub returned an invalid release list.');
      const pageReleases = payload.filter(isGitHubRelease).filter((release) => release.draft !== true);
      collected.push(...pageReleases);
      if (pageReleases.length === 0) break;
      const hasCandidate = pageReleases.some((release) => parseVersion(release.tag_name) !== null);
      if (hasCandidate) break;
    }
    return collected;
  }

  private async fetchManifest(asset: GitHubAsset, releaseVersion: string, signal: AbortSignal): Promise<ReleaseManifest> {
    assertSafeDownloadUrl(asset.browser_download_url);
    const payload = await this.fetchJson(asset.browser_download_url, true, signal);
    if (!isRecord(payload) || payload.schemaVersion !== 1 || typeof payload.version !== 'string' || !Array.isArray(payload.assets)) {
      throw new CliUpdaterError('invalid-release', 'The VORTEX release manifest is invalid.');
    }
    let manifestVersion: string;
    try {
      manifestVersion = normalizeVersion(payload.version);
    } catch (error) {
      throw new CliUpdaterError('invalid-release', `The VORTEX release manifest has an invalid version: ${errorMessage(error)}.`, { cause: error });
    }
    if (manifestVersion !== releaseVersion) {
      throw new CliUpdaterError('invalid-release', 'The VORTEX release manifest version does not match the release tag.');
    }
    const manifestAssets = payload.assets.filter(isManifestAsset);
    if (manifestAssets.length !== payload.assets.length || manifestAssets.length === 0) {
      throw new CliUpdaterError('invalid-release', 'The VORTEX release manifest contains invalid assets.');
    }
    if (!manifestAssets.some((asset) => isReleaseAssetName(asset.name, releaseVersion))) {
      throw new CliUpdaterError('invalid-release', 'The VORTEX release manifest contains invalid assets.');
    }
    const identities = new Set<string>();
    for (const asset of manifestAssets) {
      const identity = `${asset.platform}:${asset.architecture}:${asset.kind}`;
      if (identities.has(identity)) throw new CliUpdaterError('invalid-release', `The VORTEX release manifest contains duplicate asset ${identity}.`);
      identities.add(identity);
    }
    return { schemaVersion: 1, version: releaseVersion, assets: manifestAssets };
  }

  private async fetchJson(url: string, downloadUrl: boolean, signal?: AbortSignal): Promise<unknown> {
    if (downloadUrl) assertSafeDownloadUrl(url);
    else assertSafeApiUrl(url);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': USER_AGENT,
        },
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new CliUpdaterError('network', `Could not reach GitHub: ${errorMessage(error)}`, { cause: error });
    }
    if (!response.ok) throw new CliUpdaterError('network', `GitHub returned HTTP ${response.status}.`);
    if (!downloadUrl && response.url) assertSafeApiUrl(response.url);
    if (downloadUrl && response.url) assertSafeDownloadUrl(response.url);
    try {
      return await response.json() as unknown;
    } catch (error) {
      throw new CliUpdaterError('invalid-release', `Could not parse the GitHub response: ${errorMessage(error)}`, { cause: error });
    }
  }

  private async downloadFile(asset: CliUpdateAsset, destination: string, signal: AbortSignal): Promise<void> {
    assertSafeDownloadUrl(asset.url);
    if (asset.size <= 0 || asset.size > MAX_DOWNLOAD_BYTES) {
      throw new CliUpdaterError('invalid-release', `The VORTEX asset has an invalid size: ${asset.size}.`);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(asset.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal,
      });
    } catch (error) {
      throw new CliUpdaterError('network', `Could not download ${asset.name}: ${errorMessage(error)}`, { cause: error });
    }
    if (!response.ok) throw new CliUpdaterError('network', `Download failed with HTTP ${response.status}.`);
    if (response.url) assertSafeDownloadUrl(response.url);
    if (!response.body) throw new CliUpdaterError('network', `GitHub returned an empty download for ${asset.name}.`);

    const total = Number(response.headers.get('content-length') ?? asset.size);
    if (!Number.isFinite(total) || total <= 0 || total > MAX_DOWNLOAD_BYTES) {
      throw new CliUpdaterError('invalid-release', `The VORTEX download size is invalid: ${total}.`);
    }
    const file = await open(destination, 'w');
    let downloaded = 0;
    let lastPercent = -1;
    try {
      const reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value.byteLength === 0) continue;
        downloaded += chunk.value.byteLength;
        if (downloaded > MAX_DOWNLOAD_BYTES || downloaded > asset.size) {
          throw new CliUpdaterError('integrity', `The downloaded VORTEX asset exceeds its declared size.`);
        }
        await file.write(chunk.value);
        const percent = Math.min(100, (downloaded / asset.size) * 100);
        const rounded = Math.floor(percent);
        if (rounded >= lastPercent + DOWNLOAD_PROGRESS_INTERVAL) {
          lastPercent = rounded;
          this.onProgress?.({ downloaded, total: asset.size, percent });
        }
      }
    } finally {
      await file.close();
    }
    if (downloaded !== asset.size) {
      throw new CliUpdaterError('integrity', `Downloaded ${downloaded} bytes, expected ${asset.size}.`);
    }
    this.onProgress?.({ downloaded, total: asset.size, percent: 100 });
  }
}

export async function runUpdateHelper(statePath: string): Promise<void> {
  const state = await readApplyUpdateState(statePath);
  const logPath = path.join(state.helperDirectory, 'update.log');
  await appendFile(logPath, `wait-parent pid=${state.parentPid}\n`, 'utf8').catch(() => undefined);
  try {
    await waitForProcessToExit(state.parentPid);
    await appendFile(logPath, `parent-exited\n`, 'utf8').catch(() => undefined);
    await applyStagedUpdate(state);
  } catch (error) {
    await appendFile(logPath, `helper-failed: ${errorMessage(error)}\n`, 'utf8').catch(() => undefined);
    throw error;
  }
}

export function resolveTarget(platform: NodeJS.Platform, architecture: string): { platform: CliUpdatePlatform; architecture: CliUpdateArchitecture } {
  const platformName = PLATFORM_NAMES[platform];
  const architectureName = ARCHITECTURE_NAMES[architecture];
  if (!platformName || !architectureName) {
    throw new CliUpdaterError('unsupported', `VORTEX updates are not available for ${platform}-${architecture}.`);
  }
  return { platform: platformName, architecture: architectureName };
}

export function compareReleaseVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) throw new CliUpdaterError('invalid-release', `Invalid semantic version comparison: ${left} and ${right}.`);
  return compareVersions(leftVersion, rightVersion);
}

async function detectInstallation(executableOverride: string | undefined, platform: CliUpdatePlatform): Promise<InstallationLayout> {
  const executablePath = await resolveExecutablePath(executableOverride);
  const installRoot = path.dirname(executablePath);
  const writable = await canWrite(installRoot);
  const desktopBundled = await isDesktopBundledInstallation(installRoot, platform);
  const systemInstallation = isSystemInstallation(installRoot, platform);
  if (desktopBundled && !writable) {
    return {
      kind: 'desktop-bundled',
      mode: 'manual',
      executablePath,
      installRoot,
      archiveDirectory: path.dirname(installRoot),
      writable,
      reason: 'This VORTEX CLI is bundled inside a protected HysCode Desktop installation. Update HysCode Desktop to update it.',
    };
  }
  if (writable) {
    return {
      kind: systemInstallation ? 'system' : 'user-local',
      mode: 'direct',
      executablePath,
      installRoot,
      archiveDirectory: path.dirname(installRoot),
      writable,
    };
  }
  return {
    kind: desktopBundled ? 'desktop-bundled' : systemInstallation ? 'system' : 'unknown',
    mode: 'installer',
    executablePath,
    installRoot,
    archiveDirectory: path.dirname(installRoot),
    writable,
    reason: systemInstallation
      ? 'The VORTEX installation is protected by the operating system and must be updated through its installer.'
      : 'The VORTEX installation directory is not writable by the current user.',
  };
}

async function resolveExecutablePath(override?: string): Promise<string> {
  const candidate = override || process.argv[0] || process.execPath;
  try {
    return await realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

async function canWrite(directory: string): Promise<boolean> {
  try {
    await access(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function isDesktopBundledInstallation(installRoot: string, platform: CliUpdatePlatform): Promise<boolean> {
  if (platform === 'macos') {
    let current: string | null = path.resolve(installRoot);
    for (let depth = 0; depth < 4 && current; depth += 1) {
      if (current.toLowerCase().endsWith('hyscode.app')) return true;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  if (path.basename(installRoot).toLowerCase() !== 'vortex-cli') return false;
  const parent = path.dirname(installRoot);
  const desktopExecutable = platform === 'windows' ? 'HysCode.exe' : platform === 'macos' ? 'HysCode.app' : 'hyscode';
  try {
    await access(path.join(parent, desktopExecutable), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isSystemInstallation(installRoot: string, platform: CliUpdatePlatform): boolean {
  const normalized = path.resolve(installRoot).toLowerCase();
  const prefixMatch = (root: string): boolean => {
    const resolved = path.resolve(root).toLowerCase();
    return normalized === resolved || normalized.startsWith(`${resolved}${path.sep}`);
  };
  if (platform === 'windows') {
    const candidates = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.ProgramW6432,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : undefined,
      'C:\\Windows',
      'C:\\ProgramData',
    ].filter((value): value is string => Boolean(value));
    return candidates.some(prefixMatch);
  }
  if (platform === 'macos') {
    const home = process.env.HOME ?? os.homedir();
    const candidates = ['/Applications', '/Library', '/System/Applications', path.join(home, 'Applications')];
    return candidates.some((root) => prefixMatch(root));
  }
  return ['/usr', '/opt', '/snap', '/flatpak', '/nix', '/applications'].some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function releaseHasCliAsset(assets: GitHubAsset[], platform: CliUpdatePlatform, architecture: CliUpdateArchitecture): boolean {
  const platformName = platform === 'macos' ? 'macos' : platform;
  const suffix = `-${platformName}-${architecture}`;
  return assets.some((asset) => {
    const name = asset.name.toLowerCase();
    return name.startsWith('vortex-cli-') && name.includes(suffix);
  });
}

function resolveManifestAssets(
  manifest: ReleaseManifest,
  releaseAssets: GitHubAsset[],
  platform: CliUpdatePlatform,
  architecture: CliUpdateArchitecture,
): CliUpdateAsset[] {
  const selected: CliUpdateAsset[] = [];
  for (const entry of manifest.assets) {
    if (entry.platform !== platform || entry.architecture !== architecture) continue;
    const releaseAsset = releaseAssets.find((asset) => asset.name === entry.name);
    if (!releaseAsset || releaseAsset.size !== entry.size) {
      throw new CliUpdaterError('invalid-release', `The manifest does not match release asset ${entry.name}.`);
    }
    const url = releaseAsset.browser_download_url;
    assertSafeDownloadUrl(url);
    selected.push({ ...entry, url });
  }
  return selected;
}

function validateAsset(asset: CliUpdateAsset): void {
  if (!isSafeFileName(asset.name)
    || !isCompatibleAssetName(asset.name, asset.platform, asset.architecture, asset.kind)
    || !/^[a-f0-9]{64}$/iu.test(asset.sha256)) {
    throw new CliUpdaterError('invalid-release', `The VORTEX asset metadata is invalid: ${asset.name}.`);
  }
  if (asset.size <= 0 || asset.size > MAX_DOWNLOAD_BYTES) {
    throw new CliUpdaterError('invalid-release', `The VORTEX asset size is invalid: ${asset.size}.`);
  }
  assertSafeDownloadUrl(asset.url);
}

async function extractArchive(archivePath: string, extractionRoot: string, windowsArchive: boolean): Promise<void> {
  const unsafeEntries = listArchiveEntries(archivePath, windowsArchive).filter((entry) => !isSafeArchiveEntry(entry));
  if (unsafeEntries.length > 0) throw new CliUpdaterError('integrity', `The VORTEX archive contains unsafe paths: ${unsafeEntries[0]}.`);
  if (windowsArchive) {
    try {
      await runCommand('tar', ['-xf', archivePath, '-C', extractionRoot], { cwd: extractionRoot });
      return;
    } catch (error) {
      if (!isMissingToolError(error)) throw error;
    }
    try {
      await runCommand('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${extractionRoot}' -Force`], { cwd: extractionRoot });
      return;
    } catch (fallbackError) {
      throw new CliUpdaterError('unsupported', 'System tar/Expand-Archive unavailable: cannot extract the VORTEX archive on Windows.', { cause: fallbackError });
    }
  }
  try {
    await runCommand('tar', ['-xzf', archivePath, '-C', extractionRoot], { cwd: extractionRoot });
  } catch (error) {
    if (isMissingToolError(error)) {
      throw new CliUpdaterError('unsupported', 'System tar is required to stage the VORTEX archive (package: tar).', { cause: error });
    }
    throw error;
  }
}

function listArchiveEntries(archivePath: string, windowsArchive: boolean): string[] {
  const result = spawnSync('tar', windowsArchive ? ['-tf', archivePath] : ['-tzf', archivePath], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (!result.error && result.status === 0) {
    return result.stdout.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
  }
  if (!windowsArchive) {
    throw new CliUpdaterError('unsupported', 'System tar is required to inspect the VORTEX archive (package: tar).');
  }
  try {
    const fallback = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `$entries = @(); try { Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead('${archivePath}'); foreach ($e in $zip.Entries) { $entries += $e.FullName }; $zip.Dispose() } catch { exit 1 }; $entries -join "\n"`],
      { encoding: 'utf8', windowsHide: true },
    );
    if (!fallback.error && fallback.status === 0 && fallback.stdout.trim()) {
      return fallback.stdout.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
    }
  } catch {
  }
  if (result.error && isMissingToolCode((result.error as NodeJS.ErrnoException).code)) {
    throw new CliUpdaterError('unsupported', 'System tar/Expand-Archive unavailable: cannot inspect the VORTEX archive on Windows.');
  }
  throw new CliUpdaterError('unsupported', 'System tar/Expand-Archive unavailable: cannot inspect the VORTEX archive on Windows.');
}

async function locateBundle(extractionRoot: string, platform: CliUpdatePlatform): Promise<string> {
  const entries = await readdir(extractionRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(extractionRoot, entry.name));
  if (directories.length === 1) return directories[0];
  const executableName = platform === 'windows' ? 'vortex.exe' : 'vortex';
  if (await fileExists(path.join(extractionRoot, executableName))) return extractionRoot;
  throw new CliUpdaterError('integrity', 'The VORTEX archive does not contain exactly one installable bundle.');
}

async function validateBundle(
  bundlePath: string,
  expectedVersion: string,
  platform: CliUpdatePlatform,
  architecture: CliUpdateArchitecture,
): Promise<void> {
  const executableName = platform === 'windows' ? 'vortex.exe' : 'vortex';
  const sidecarName = platform === 'windows' ? 'codex-sidecar.exe' : 'codex-sidecar';
  const nativePlatform = platform === 'windows' ? 'win32' : platform === 'macos' ? 'darwin' : 'linux';
  const nativeDirectory = path.join(bundlePath, 'node-pty-assets', `${nativePlatform}-${architecture}`);
  const nativeFiles = platform === 'windows'
    ? ['pty.node', 'conpty.node', 'conpty_console_list.node']
    : platform === 'macos'
      ? ['pty.node', 'spawn-helper']
      : ['pty.node'];
  const requiredPaths = [
    { label: executableName, path: path.join(bundlePath, executableName) },
    { label: sidecarName, path: path.join(bundlePath, sidecarName) },
    { label: 'node-pty-assets', path: path.join(bundlePath, 'node-pty-assets') },
    { label: path.relative(bundlePath, nativeDirectory), path: nativeDirectory },
    ...nativeFiles.map((file) => ({ label: path.join(path.relative(bundlePath, nativeDirectory), file), path: path.join(nativeDirectory, file) })),
  ];
  for (const required of requiredPaths) {
    if (!(await fileExists(required.path))) {
      throw new CliUpdaterError('integrity', `The VORTEX bundle is missing ${required.label}.`);
    }
  }
  if (platform !== 'windows') {
    await chmod(path.join(bundlePath, executableName), 0o755);
    await chmod(path.join(bundlePath, sidecarName), 0o755).catch(() => undefined);
    if (platform === 'macos') await chmod(path.join(nativeDirectory, 'spawn-helper'), 0o755).catch(() => undefined);
  }
  const output = await runCommand(path.join(bundlePath, executableName), ['--version'], { cwd: bundlePath, allowFailure: true });
  if (output.exitCode !== 0 || output.stdout.trim() !== `vortex ${normalizeVersion(expectedVersion)}`) {
    throw new CliUpdaterError('integrity', `The staged VORTEX bundle reported an unexpected version: ${output.stdout.trim()}.`);
  }
  if (platform === 'macos') {
    await runCommand('codesign', ['-v', path.join(bundlePath, 'vortex')], { cwd: bundlePath, allowFailure: true });
    await runCommand('spctl', ['-a', '-t', 'exec', path.join(bundlePath, 'vortex')], { cwd: bundlePath, allowFailure: true });
  }
}
async function launchInstaller(installerPath: string, platform: CliUpdatePlatform, silent = false): Promise<void> {
  if (platform === 'macos') {
    await runCommand('pkgutil', ['--check-signature', installerPath], { cwd: path.dirname(installerPath), allowFailure: true });
    if (silent) {
      try {
        await runCommand('installer', ['-pkg', installerPath, '-target', '/'], { cwd: path.dirname(installerPath) });
        return;
      } catch (error) {
        throw new CliUpdaterError('permission', `The macOS installer requires elevation. Re-run with sudo: sudo installer -pkg ${installerPath} -target /`, { cause: error });
      }
    }
    try {
      const child = spawn('open', [installerPath], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      await once(child, 'spawn');
    } catch (error) {
      throw new CliUpdaterError('installer-failed', `Could not launch the VORTEX installer: ${errorMessage(error)}`, { cause: error });
    }
    return;
  }
  if (platform === 'linux') {
    const headless = silent || !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
    if (!headless) {
      try {
        const child = spawn('xdg-open', [installerPath], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
        await once(child, 'spawn');
        return;
      } catch (error) {
        throw new CliUpdaterError('installer-failed', `Could not launch the VORTEX installer: ${errorMessage(error)}`, { cause: error });
      }
    }
    try {
      await runCommand('pkexec', ['dpkg', '-i', installerPath], { cwd: path.dirname(installerPath) });
      await runCommand('pkexec', ['apt-get', 'install', '-f', '-y'], { cwd: path.dirname(installerPath), allowFailure: true });
      return;
    } catch (error) {
      throw new CliUpdaterError('permission', `The Linux installer requires elevation. Run 'sudo dpkg -i ${installerPath}'.`, { cause: error });
    }
  }
  try {
    const args = silent ? ['/SILENT', '/NORESTART'] : [];
    const child = spawn(installerPath, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    await once(child, 'spawn');
  } catch (error) {
    throw new CliUpdaterError('installer-failed', `Could not launch the VORTEX installer: ${errorMessage(error)}`, { cause: error });
  }
}

function isMissingToolCode(code: unknown): boolean {
  return code === 'ENOENT';
}

function isMissingToolError(error: unknown): boolean {
  if (error instanceof CliUpdaterError && error.code === 'integrity' && /Command .* failed/u.test(error.message)) return false;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code && isMissingToolCode(code)) return true;
  const message = errorMessage(error);
  return /ENOENT|not found|not recognized|command not found/iu.test(message);
}

async function applyStagedUpdate(state: ApplyUpdateState): Promise<void> {
  const backupRoot = `${state.targetRoot}.backup-${randomUUID()}`;
  let backupCreated = false;
  let newInstallCreated = false;
  const logPath = path.join(state.helperDirectory, 'update.log');
  const log = async (line: string): Promise<void> => {
    await appendFile(logPath, `${line}\n`, 'utf8').catch(() => undefined);
  };
  try {
    await log(`wait-parent done pid=${state.parentPid}`);
    await retryRename(state.targetRoot, backupRoot);
    backupCreated = true;
    await log(`rename target->backup ok`);
    await retryRename(state.stagedBundlePath, state.targetRoot);
    newInstallCreated = true;
    await log(`rename staged->target ok`);
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
    await validateBundle(state.targetRoot, state.expectedVersion, platform, state.architecture);
    await log(`validate ok ${state.expectedVersion}`);
  } catch (error) {
    await log(`failed: ${errorMessage(error)}`);
    if (newInstallCreated) await rm(state.targetRoot, { recursive: true, force: true }).catch(() => undefined);
    if (backupCreated) {
      try {
        await retryRename(backupRoot, state.targetRoot);
        await log(`restored backup`);
      } catch (restoreError) {
        await cleanupUpdateFiles(state, true);
        throw new CliUpdaterError('apply-failed', `VORTEX update failed (${errorMessage(error)}); restore also failed (${errorMessage(restoreError)}).`, { cause: error });
      }
    }
    await cleanupUpdateFiles(state, true);
    throw new CliUpdaterError('apply-failed', `The VORTEX installation was restored after update failure: ${errorMessage(error)}`, { cause: error });
  }
  try {
    await rm(backupRoot, { recursive: true, force: true });
    await log(`cleanup backup ok`);
  } catch (error) {
    await cleanupUpdateFiles(state, false);
    throw new CliUpdaterError('apply-failed', `VORTEX update succeeded but backup cleanup failed: ${errorMessage(error)}. The new version is installed at ${state.targetRoot}.`, { cause: error });
  }
  await cleanupUpdateFiles(state, false);
  await log(`done ${state.expectedVersion}`);
}

async function retryRename(from: string, to: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= WINDOWS_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (!code || !WINDOWS_RETRY_ERRORS[code] || attempt === WINDOWS_RENAME_ATTEMPTS) throw error;
      await delay(WINDOWS_RENAME_RETRY_MS);
    }
  }
  throw lastError;
}

async function cleanupUpdateFiles(state: ApplyUpdateState, preserveHelper: boolean): Promise<void> {
  await rm(state.stagedBundlePath, { recursive: true, force: true }).catch(() => undefined);
  await rm(state.temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  if (!preserveHelper) await rm(state.helperDirectory, { recursive: true, force: true }).catch(() => undefined);
}

async function readApplyUpdateState(statePath: string): Promise<ApplyUpdateState> {
  const resolvedStatePath = path.resolve(statePath);
  if (!isPathInside(os.tmpdir(), resolvedStatePath)) {
    throw new CliUpdaterError('apply-failed', 'The VORTEX update state must be stored in the system temporary directory.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolvedStatePath, 'utf8')) as unknown;
  } catch (error) {
    throw new CliUpdaterError('apply-failed', `Could not read the VORTEX update state: ${errorMessage(error)}`, { cause: error });
  }
  if (!isRecord(raw)
    || typeof raw.parentPid !== 'number'
    || !Number.isInteger(raw.parentPid)
    || raw.parentPid <= 0
    || typeof raw.targetRoot !== 'string'
    || typeof raw.stagedBundlePath !== 'string'
    || typeof raw.expectedVersion !== 'string'
    || parseVersion(raw.expectedVersion) === null
    || (raw.architecture !== 'x64' && raw.architecture !== 'arm64')
    || typeof raw.temporaryRoot !== 'string'
    || typeof raw.helperDirectory !== 'string'
    || typeof raw.createdAt !== 'number'
    || !Number.isFinite(raw.createdAt)) {
    throw new CliUpdaterError('apply-failed', 'The VORTEX update state is invalid.');
  }
  if (Date.now() - raw.createdAt > HELPER_STATE_MAX_AGE_MS) {
    throw new CliUpdaterError('apply-failed', 'The VORTEX update state has expired.');
  }
  const targetRoot = path.resolve(raw.targetRoot);
  const stagedBundlePath = path.resolve(raw.stagedBundlePath);
  const temporaryRoot = path.resolve(raw.temporaryRoot);
  const helperDirectory = path.resolve(raw.helperDirectory);
  if (path.dirname(resolvedStatePath) !== helperDirectory) {
    throw new CliUpdaterError('apply-failed', 'The VORTEX update state must live inside its helper directory.');
  }
  if (!path.isAbsolute(raw.targetRoot)
    || !path.isAbsolute(raw.stagedBundlePath)
    || !path.isAbsolute(raw.temporaryRoot)
    || !path.isAbsolute(raw.helperDirectory)
    || path.dirname(targetRoot) !== path.dirname(stagedBundlePath)
    || !isPathInside(os.tmpdir(), temporaryRoot)
    || !isPathInside(os.tmpdir(), helperDirectory)) {
    throw new CliUpdaterError('apply-failed', 'The VORTEX update state contains unsafe paths.');
  }
  const loweredTarget = targetRoot.toLowerCase();
  const home = (process.env.HOME ?? os.homedir()).toLowerCase();
  const tmp = path.resolve(os.tmpdir()).toLowerCase();
  const dangerous = new Set([path.parse(targetRoot).root.toLowerCase(), home, tmp, path.resolve(os.tmpdir(), 'vortex-update-helper').toLowerCase()]);
  if (dangerous.has(loweredTarget) || loweredTarget === '/' || /^[a-z]:\\$/u.test(loweredTarget)) {
    throw new CliUpdaterError('apply-failed', 'The VORTEX update state contains unsafe paths.');
  }
  return {
    parentPid: raw.parentPid,
    targetRoot,
    stagedBundlePath,
    expectedVersion: raw.expectedVersion,
    architecture: raw.architecture,
    temporaryRoot,
    helperDirectory,
    createdAt: raw.createdAt,
  };
}

function isPathInside(parent: string, candidate: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedParent || resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`);
}

async function waitForProcessToExit(pid: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HELPER_MAX_WAIT_MS) {
    if (!isProcessAlive(pid)) return;
    await delay(HELPER_WAIT_INTERVAL_MS);
  }
  throw new CliUpdaterError('apply-failed', 'The previous VORTEX process did not exit in time.');
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; allowFailure?: boolean; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeoutMs = options.timeoutMs ?? RUN_COMMAND_DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new CliUpdaterError('invalid-release', `Command ${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.allowFailure) resolve({ stdout, stderr: errorMessage(error), exitCode: 1 });
      else reject(error);
    });
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const exitCode = typeof code === 'number' ? code : 1;
      if (exitCode !== 0 && !options.allowFailure) {
        reject(new CliUpdaterError('integrity', `Command ${command} failed: ${stderr || stdout}`));
      } else {
        resolve({ stdout, stderr, exitCode });
      }
    });
  });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function isGitHubRelease(value: unknown): value is GitHubRelease {
  return isRecord(value)
    && typeof value.tag_name === 'string'
    && Array.isArray(value.assets)
    && value.assets.every(isGitHubAsset);
}

function isGitHubAsset(value: unknown): value is GitHubAsset {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.browser_download_url === 'string'
    && typeof value.size === 'number';
}

function isManifestAsset(value: unknown): value is ManifestAsset {
  return isRecord(value)
    && (value.platform === 'windows' || value.platform === 'linux' || value.platform === 'macos')
    && (value.architecture === 'x64' || value.architecture === 'arm64')
    && (value.kind === 'archive' || value.kind === 'installer')
    && typeof value.name === 'string'
    && isSafeFileName(value.name)
    && isCompatibleAssetName(value.name, value.platform, value.architecture, value.kind)
    && typeof value.size === 'number'
    && Number.isSafeInteger(value.size)
    && value.size > 0
    && value.size <= MAX_DOWNLOAD_BYTES
    && typeof value.sha256 === 'string'
    && /^[a-f0-9]{64}$/iu.test(value.sha256);
}

function isCompatibleAssetName(
  name: string,
  platform: CliUpdatePlatform,
  architecture: CliUpdateArchitecture,
  kind: CliUpdateAssetKind,
): boolean {
  const normalized = name.toLowerCase();
  if (kind === 'archive') {
    const extension = platform === 'windows' ? '.zip' : '.tar.gz';
    return normalized.startsWith(`vortex-cli-`)
      && normalized.endsWith(`-${platform}-${architecture}${extension}`);
  }
  if (platform === 'windows') return normalized.startsWith('vortex-cli-setup-') && normalized.endsWith(`-${architecture}.exe`);
  if (platform === 'linux') return normalized.startsWith('vortex-cli-') && normalized.endsWith(`-linux-${architecture}.deb`);
  return normalized.startsWith('vortex-cli-setup-') && normalized.endsWith(`-macos-${architecture}.pkg`);
}

function isReleaseAssetName(name: string, version: string): boolean {
  const normalized = name.toLowerCase();
  const releasePrefix = `vortex-cli-${version.toLowerCase()}-`;
  const installerPrefix = `vortex-cli-setup-${version.toLowerCase()}-`;
  return normalized.startsWith(releasePrefix) || normalized.startsWith(installerPrefix);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeApiUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliUpdaterError('network', `Invalid GitHub API URL: ${value}.`);
  }
  if (parsed.protocol !== 'https:' || !TRUSTED_API_HOSTS.has(parsed.hostname)) {
    throw new CliUpdaterError('network', 'The VORTEX updater rejected an untrusted GitHub API URL.');
  }
}

function assertSafeDownloadUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliUpdaterError('network', `Invalid VORTEX download URL: ${value}.`);
  }
  if (parsed.protocol !== 'https:' || !TRUSTED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new CliUpdaterError('network', 'The VORTEX updater rejected an untrusted download URL.');
  }
}

function isSafeFileName(value: string): boolean {
  return value.length > 0
    && value.length <= 240
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('..');
}

function isSafeArchiveEntry(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  return !normalized.startsWith('/')
    && !/^[a-z]:/iu.test(normalized)
    && !normalized.split('/').some((segment) => segment === '..');
}

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function normalizeVersion(value: string): string {
  const parsed = parseVersion(value);
  if (!parsed) throw new CliUpdaterError('invalid-release', `Invalid VORTEX version: ${value}.`);
  return formatParsedVersion(parsed);
}

function formatParsedVersion(value: ParsedVersion): string {
  return `${value.major}.${value.minor}.${value.patch}${value.prerelease.length ? `-${value.prerelease.join('.')}` : ''}`;
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (const field of ['major', 'minor', 'patch'] as const) {
    if (left[field] !== right[field]) return left[field] > right[field] ? 1 : -1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

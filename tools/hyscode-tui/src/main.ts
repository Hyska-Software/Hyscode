import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';
import { CliUpdater, CliUpdaterError, runUpdateHelper, SharedConfigStore, TuiBridge } from '@hyscode/tui-runtime';
import { parseCliArgs, VORTEX_UPDATE_EXIT_CODES } from './commands';
import { TuiController } from './controller';
import { enterAlternateScreen, leaveAlternateScreen, TerminalInput } from './input';
import { TerminalRenderer } from './renderer';
import type { CliUpdateOptions } from './types';

declare const __HYSCODE_TUI_VERSION__: string | undefined;

const VERSION = typeof __HYSCODE_TUI_VERSION__ === 'string'
  ? __HYSCODE_TUI_VERSION__
  : process.env.HYSCODE_TUI_VERSION ?? '0.1.0';

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2), process.cwd(), VERSION);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }
  if (parsed.kind === 'apply-update') {
    try {
      await runUpdateHelper(parsed.statePath);
    } catch (error) {
      process.stderr.write(`VORTEX update helper failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }
  if (parsed.kind === 'update') {
    await runUpdateCommand(parsed.options);
    return;
  }
  if (parsed.kind !== 'run') {
    process.stdout.write(`${parsed.text}\n`);
    return;
  }

  try {
    await access(parsed.options.workspace);
  } catch {
    process.stderr.write(`Workspace path does not exist: ${parsed.options.workspace}\n`);
    process.exitCode = 2;
    return;
  }

  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const updater = interactive ? new CliUpdater({
    version: VERSION,
    executablePath: currentCliExecutablePath(),
  }) : undefined;
  let controller: TuiController;
  const bridge = new TuiBridge((message) => controller.handleRuntimeMessage(message));
  controller = new TuiController(parsed.options, bridge, { updater, interactive });
  const renderer = new TerminalRenderer();

  try {
    await controller.start();
    if (!interactive) {
      process.stdout.write(`VORTEX runtime ready for ${controller.state.workspace}\n`);
      await controller.shutdown();
      return;
    }

    const repaint = (): void => {
      controller.setViewport(process.stdout.columns ?? 120, process.stdout.rows ?? 32);
      process.stdout.write(renderer.render(controller.state));
    };
    const input = new TerminalInput({
      stdin: process.stdin,
      stdout: process.stdout,
      onKey: (key) => { void controller.handleKey(key).catch((error: unknown) => process.stderr.write(`${String(error)}\n`)); },
      onResize: (width, height) => controller.setViewport(width, height),
    });
    enterAlternateScreen(process.stdout);
    input.start();
    repaint();
    const repaintTimer = setInterval(repaint, 80);
    const gitRefreshTimer = setInterval(() => { void controller.refreshGitSummary(); }, 2000);
    while (!controller.state.shouldQuit) await delay(80);
    clearInterval(repaintTimer);
    clearInterval(gitRefreshTimer);
    input.stop();
    leaveAlternateScreen(process.stdout);
    await controller.shutdown();
  } catch (error) {
    if (interactive) leaveAlternateScreen(process.stdout);
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
    try {
      await controller.shutdown();
    } catch {
      // The process is already unwinding; the original error is more useful.
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void main();

async function runUpdateCommand(options: CliUpdateOptions): Promise<void> {
  const configStore = new SharedConfigStore(options.configPath);
  const settings = await configStore.load();
  const channel = options.channel ?? settings.updateChannel;
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const updater = new CliUpdater({
    version: VERSION,
    executablePath: currentCliExecutablePath(),
    onProgress: (progress) => {
      if (!process.stdout.isTTY) return;
      process.stdout.write(`\rDownloading VORTEX ${Math.round(progress.percent)}%`);
    },
  });

  try {
    const release = await updater.check(channel);
    if (!release) {
      process.stdout.write(`VORTEX ${VERSION} is up to date.\n`);
      process.exitCode = VORTEX_UPDATE_EXIT_CODES.upToDate;
      return;
    }
    process.stdout.write(`VORTEX ${VERSION} → ${release.version} (${channel})\n`);
    if (release.body) process.stdout.write(`${release.body.trim()}\n`);
    if (options.checkOnly) {
      if (!release.asset) {
        process.stdout.write(`${release.manualReason ?? 'Manual installation is required for this release.'}\n`);
        process.stdout.write(`Release: ${release.releaseUrl}\n`);
      }
      process.exitCode = VORTEX_UPDATE_EXIT_CODES.available;
      return;
    }
    if (!release.asset) {
      process.stdout.write(`${release.manualReason ?? 'Manual installation is required for this release.'}\n`);
      process.stdout.write(`Release: ${release.releaseUrl}\n`);
      process.exitCode = release.installation.mode === 'manual'
        ? VORTEX_UPDATE_EXIT_CODES.manualInstallRequired
        : VORTEX_UPDATE_EXIT_CODES.unsupportedPlatform;
      return;
    }
    if (!options.assumeYes) {
      if (!interactive) {
        process.stderr.write('VORTEX update requires confirmation. Re-run with --yes.\n');
        process.exitCode = 6;
        return;
      }
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await readline.question(`Download and install VORTEX ${release.version}? [y/N] `);
      readline.close();
      if (!/^y(es)?$/iu.test(answer.trim())) {
        process.stdout.write('VORTEX update cancelled.\n');
        return;
      }
    }
    const update = await updater.download(release);
    if (process.stdout.isTTY) process.stdout.write('\n');
    await updater.apply(update);
    process.stdout.write(`VORTEX update to ${release.version} scheduled. Restart VORTEX to use the new version.\n`);
    process.exitCode = VORTEX_UPDATE_EXIT_CODES.installed;
  } catch (error) {
    if (process.stdout.isTTY) process.stdout.write('\n');
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`VORTEX update failed: ${message}\n`);
    process.exitCode = updateExitCode(error);
  }
}

function currentCliExecutablePath(): string | undefined {
  const candidate = process.argv[0];
  return candidate && /vortex(?:\.exe)?$/iu.test(candidate) ? candidate : undefined;
}

function updateExitCode(error: unknown): number {
  if (!(error instanceof CliUpdaterError)) return VORTEX_UPDATE_EXIT_CODES.networkError;
  if (error.code === 'integrity' || error.code === 'invalid-release') return VORTEX_UPDATE_EXIT_CODES.integrityFailure;
  if (error.code === 'unsupported') return VORTEX_UPDATE_EXIT_CODES.unsupportedPlatform;
  if (error.code === 'manual-install-required' || error.code === 'permission') return VORTEX_UPDATE_EXIT_CODES.manualInstallRequired;
  return VORTEX_UPDATE_EXIT_CODES.networkError;
}

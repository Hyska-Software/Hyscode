import { access, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import process from 'node:process';
import { CliUpdater, CliUpdaterError, runNdjsonBridge, runUpdateHelper, SharedConfigStore, TuiBridge } from '@hyscode/tui-runtime';
import { parseCliArgs, VORTEX_UPDATE_EXIT_CODES } from './commands';
import { TuiController } from './controller';
import { enterAlternateScreen, leaveAlternateScreen, TerminalInput } from './input';
import { TerminalRenderer } from './renderer';
import { runTerminalHandoff, type TerminalHandoffOutcome } from './terminal-handoff';
import type { CliUpdateOptions } from './types';

declare const __HYSCODE_TUI_VERSION__: string | undefined;

const VERSION = typeof __HYSCODE_TUI_VERSION__ === 'string'
  ? __HYSCODE_TUI_VERSION__
  : process.env.HYSCODE_TUI_VERSION ?? '0.13.0';

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
      const message = error instanceof Error ? error.message : String(error);
      try {
        await appendFile(path.join(path.dirname(parsed.statePath), 'update.log'), `helper-failed: ${message}\n`, 'utf8');
      } catch {
      }
      process.stderr.write(`VORTEX update helper failed: ${message}\n`);
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

  if (parsed.options.protocol === 'ndjson') {
    await runNdjsonBridge({
      initializeDefaults: {
        workspacePath: parsed.options.workspace,
        projectId: parsed.options.workspace,
        ...(parsed.options.provider ? { providerId: parsed.options.provider } : {}),
        ...(parsed.options.model ? { modelId: parsed.options.model } : {}),
        ...(parsed.options.mode ? { agentType: parsed.options.mode } : {}),
        ...(parsed.options.configPath ? { configPath: parsed.options.configPath } : {}),
      },
    });
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
  let input: TerminalInput | null = null;
  let repaintTimer: ReturnType<typeof setInterval> | null = null;
  let gitRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let outerScreenActive = false;
  let outerLoopActive = false;
  const bridge = new TuiBridge((message) => controller.handleRuntimeMessage(message));
  const renderer = new TerminalRenderer();

  const repaint = (): void => {
    controller.setViewport(process.stdout.columns ?? 120, process.stdout.rows ?? 32);
    const frame = renderer.render(controller.state);
    if (frame) process.stdout.write(frame);
  };
  const pauseOuter = (): void => {
    if (repaintTimer) clearInterval(repaintTimer);
    if (gitRefreshTimer) clearInterval(gitRefreshTimer);
    repaintTimer = null;
    gitRefreshTimer = null;
    input?.stop();
    outerLoopActive = false;
  };
  const resumeOuter = (): void => {
    if (!input || outerLoopActive) return;
    input.start();
    renderer.invalidate();
    repaint();
    repaintTimer = setInterval(repaint, 80);
    gitRefreshTimer = setInterval(() => { void controller.refreshGitSummary(); }, 2000);
    outerLoopActive = true;
    outerScreenActive = true;
  };
  const startOuter = (): void => {
    if (outerScreenActive) return;
    enterAlternateScreen(process.stdout);
    outerScreenActive = true;
    resumeOuter();
  };
  const stopOuter = (): void => {
    pauseOuter();
    if (outerScreenActive) {
      leaveAlternateScreen(process.stdout);
      outerScreenActive = false;
    }
  };
  const attachTerminal = async (terminalId: string): Promise<TerminalHandoffOutcome> => {
    if (!interactive) throw new Error('Interactive terminal attach requires a TTY.');
    const handoff = await bridge.openUserTerminalHandoff(terminalId);
    return runTerminalHandoff(handoff, {
      stdin: process.stdin,
      stdout: process.stdout,
      pauseOuter,
      resumeOuter,
    });
  };
  controller = new TuiController(parsed.options, bridge, {
    updater,
    interactive,
    onTerminalAttach: attachTerminal,
  });

  try {
    await controller.start();
    if (!interactive) {
      process.stdout.write(`VORTEX runtime ready for ${controller.state.workspace}\n`);
      await controller.shutdown();
      return;
    }

    input = new TerminalInput({
      stdin: process.stdin,
      stdout: process.stdout,
      onKey: (key) => { void controller.handleKey(key).catch((error: unknown) => process.stderr.write(`${String(error)}\n`)); },
      onResize: (width, height) => { void controller.resizeActiveTerminal(width, height); },
    });
    startOuter();
    while (!controller.state.shouldQuit) await delay(80);
    stopOuter();
    await controller.shutdown();
  } catch (error) {
    if (interactive) stopOuter();
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
  if (options.persistChannel && options.channel) {
    await configStore.save({ updateChannel: options.channel });
  }
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
        process.exitCode = VORTEX_UPDATE_EXIT_CODES.confirmationRequired;
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
    await updater.apply(update, { silent: options.silent });
    if (release.asset.kind === 'installer') {
      process.stdout.write(`VORTEX installer launched for ${release.version}. Complete the installer to finish. Temp files under the system temp directory (vortex-update-*) can be removed manually.\n`);
    } else {
      process.stdout.write(`VORTEX update to ${release.version} scheduled. Restart VORTEX to use the new version.\n`);
    }
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
  if (candidate && /vortex(?:\.exe)?$/iu.test(candidate)) return candidate;
  const pathEnv = process.env.PATH ?? '';
  const suffix = process.platform === 'win32' ? 'vortex.exe' : 'vortex';
  for (const entry of pathEnv.split(path.delimiter)) {
    if (!entry) continue;
    const full = path.join(entry, suffix);
    try {
      if (existsSync(full)) return full;
    } catch {
    }
  }
  return undefined;
}

function updateExitCode(error: unknown): number {
  if (!(error instanceof CliUpdaterError)) return VORTEX_UPDATE_EXIT_CODES.networkError;
  if (error.code === 'integrity' || error.code === 'invalid-release') return VORTEX_UPDATE_EXIT_CODES.integrityFailure;
  if (error.code === 'unsupported') return VORTEX_UPDATE_EXIT_CODES.unsupportedPlatform;
  if (error.code === 'manual-install-required' || error.code === 'permission') return VORTEX_UPDATE_EXIT_CODES.manualInstallRequired;
  return VORTEX_UPDATE_EXIT_CODES.networkError;
}

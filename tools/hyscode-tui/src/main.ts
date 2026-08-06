import { access } from 'node:fs/promises';
import process from 'node:process';
import { TuiBridge } from '@hyscode/tui-runtime';
import { parseCliArgs } from './commands';
import { TuiController } from './controller';
import { enterAlternateScreen, leaveAlternateScreen, TerminalInput } from './input';
import { TerminalRenderer } from './renderer';

const VERSION = '0.1.0';

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2), process.cwd(), VERSION);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
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

  let controller: TuiController;
  const bridge = new TuiBridge((message) => controller.handleRuntimeMessage(message));
  controller = new TuiController(parsed.options, bridge);
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const renderer = new TerminalRenderer();

  try {
    await controller.start();
    if (!interactive) {
      process.stdout.write(`HysCode TUI runtime ready for ${controller.state.workspace}\n`);
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

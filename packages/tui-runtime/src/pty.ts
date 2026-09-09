import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { TerminalRuntimeFailure } from '@hyscode/agent-harness';
import type * as nodePtyTypes from 'node-pty';
declare const require: NodeRequire;

declare global {
  interface ImportMeta {
    require: NodeRequire;
  }
}

type NativeModule = Record<string, unknown>;
type NodePtyUtils = {
  loadNativeModule: (name: string) => { dir: string; module: NativeModule };
};
type NodePtyModule = typeof nodePtyTypes;

type BunTerminal = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  readonly closed: boolean;
};

type BunSpawnedProcess = {
  pid?: number;
  exited: Promise<number>;
  kill: () => void;
};

type BunGlobal = {
  Terminal: new (options: { cols: number; rows: number; data: (terminal: BunTerminal, chunk: string) => void }) => BunTerminal;
  spawn: (command: string[], options: { cwd?: string; env?: Record<string, string | undefined>; terminal?: BunTerminal }) => BunSpawnedProcess;
};

declare const Bun: BunGlobal;

const nativeModules = new Map<string, NativeModule>();
let sourceNativeDirectory = '';

// Windows ConPTY dlopens three linked natives; Unix only needs pty.node
// (macOS spawn-helper is resolved through the module directory instead).
const NATIVE_MODULE_NAMES: readonly string[] = process.platform === 'win32'
  ? ['pty', 'conpty', 'conpty_console_list']
  : ['pty'];

function registerNativeModule(name: string, module: NativeModule, resolvedPath: string): void {
  nativeModules.set(name, module);
  if (!sourceNativeDirectory) sourceNativeDirectory = path.dirname(resolvedPath);
}

function bundledNativeDirectory(): string {
  return path.join(path.dirname(process.execPath), 'node-pty-assets', `${process.platform}-${process.arch}`);
}

function packagedNativeDirectory(): string {
  const candidate = bundledNativeDirectory();
  if (existsSync(candidate)) return candidate;
  return sourceNativeDirectory;
}

function registerBundledNativeModules(): boolean {
  const directory = bundledNativeDirectory();
  if (!existsSync(path.join(directory, 'pty.node'))) return false;
  try {
    for (const name of NATIVE_MODULE_NAMES) {
      const assetPath = path.join(directory, `${name}.node`);
      registerNativeModule(name, import.meta.require(assetPath), assetPath);
    }
  } catch {
    return false;
  }
  return true;
}

function registerModuleRelativeNativeModules(root: string): boolean {
  try {
    for (const name of NATIVE_MODULE_NAMES) {
      const assetPath = `${root}/${name}.node`;
      registerNativeModule(name, require(assetPath), require.resolve(assetPath));
    }
  } catch {
    return false;
  }
  return true;
}

async function loadNodePty(): Promise<NodePtyModule> {
  if (!process.versions.bun) return import('node-pty');

  // Resolution order: staging inside node_modules (dev/CI builds), assets
  // installed next to the compiled executable (installers, release archives),
  // then the stock node-pty prebuild layout.
  const loaded = registerModuleRelativeNativeModules('node-pty/prebuilds/vortex')
    || registerBundledNativeModules()
    || registerModuleRelativeNativeModules(`node-pty/prebuilds/${process.platform}-${process.arch}`);
  if (!loaded) {
    throw new Error(
      `node-pty native assets for ${process.platform}-${process.arch} were not found. `
        + `Expected staged assets in ${bundledNativeDirectory()}, next to the executable.`,
    );
  }

  const nodePtyUtils = require('node-pty/lib/utils') as NodePtyUtils;
  nodePtyUtils.loadNativeModule = (name) => {
    const module = nativeModules.get(name);
    if (!module) throw new Error(`Native node-pty module was not preloaded: ${name}`);
    return { dir: packagedNativeDirectory(), module };
  };

  return import('node-pty');
}

// Bun's node-pty compatibility breaks the ConPTY conout named-pipe bridge on
// Windows (ERR_SOCKET_CLOSED on first write), so compiled TUI binaries drive
// ConPTY through Bun's native Terminal API instead. Node keeps node-pty, and
// non-Windows Bun keeps the unix node-pty path.
const useBunTerminal = Boolean(process.versions.bun) && process.platform === 'win32';
const nodePty: NodePtyModule | null = useBunTerminal ? null : await loadNodePty();

type PtySpawn = (file: string, args: string[], options: nodePtyTypes.IPtyForkOptions) => nodePtyTypes.IPty;

function spawnBunConPty(file: string, args: string[], options: nodePtyTypes.IPtyForkOptions): nodePtyTypes.IPty {
  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: { exitCode: number | null; signal?: number; failure?: TerminalRuntimeFailure | null }) => void) | null = null;
  const terminal = new Bun.Terminal({
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
    data: (_terminal, chunk) => dataListener?.(chunk),
  });
  const environment = options.env ?? processEnvironmentSnapshot();
  const child = Bun.spawn([file, ...args], {
    cwd: options.cwd,
    env: environment,
    terminal,
  });
  void child.exited.then(
    (exitCode) => exitListener?.({ exitCode, failure: null }),
    (error: unknown) => exitListener?.({
      exitCode: null,
      failure: {
        operation: 'wait',
        message: error instanceof Error ? error.message : String(error),
      },
    }),
  );
  return {
    pid: child.pid ?? 0,
    write: (data: string | Buffer) => terminal.write(typeof data === 'string' ? data : data.toString()),
    kill: () => child.kill(),
    resize: (cols: number, rows: number) => terminal.resize(cols, rows),
    onData: (listener: (data: string) => void) => {
      dataListener = listener;
      return { dispose: () => { if (dataListener === listener) dataListener = null; } };
    },
    onExit: (listener: (event: { exitCode: number | null; signal?: number; failure?: TerminalRuntimeFailure | null }) => void) => {
      exitListener = listener;
      return { dispose: () => { if (exitListener === listener) exitListener = null; } };
    },
  } as unknown as nodePtyTypes.IPty;
}

function processEnvironmentSnapshot(): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) snapshot[key] = value;
  }
  return snapshot;
}

export const spawn: PtySpawn = nodePty ? nodePty.spawn : spawnBunConPty;
export type { IDisposable, IPty } from 'node-pty';

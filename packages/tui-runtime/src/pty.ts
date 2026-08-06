import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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

const nativeModules = new Map<string, NativeModule>();
let sourceNativeDirectory = '';

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

function registerFallbackNativeModule(name: string, assetPath: string): void {
  const resolvedPath = require.resolve(assetPath);
  registerNativeModule(name, import.meta.require(assetPath), resolvedPath);
}

async function loadNodePty(): Promise<typeof import('node-pty')> {
  if (!process.versions.bun) return import('node-pty');

  if (process.platform === 'win32') {
    try {
      registerNativeModule('pty', require('node-pty/prebuilds/vortex/pty.node'), require.resolve('node-pty/prebuilds/vortex/pty.node'));
      registerNativeModule('conpty', require('node-pty/prebuilds/vortex/conpty.node'), require.resolve('node-pty/prebuilds/vortex/conpty.node'));
      registerNativeModule('conpty_console_list', require('node-pty/prebuilds/vortex/conpty_console_list.node'), require.resolve('node-pty/prebuilds/vortex/conpty_console_list.node'));
    } catch {
      const fallbackRoot = `node-pty/prebuilds/${process.platform}-${process.arch}`;
      registerFallbackNativeModule('pty', `${fallbackRoot}/pty.node`);
      registerFallbackNativeModule('conpty', `${fallbackRoot}/conpty.node`);
      registerFallbackNativeModule('conpty_console_list', `${fallbackRoot}/conpty_console_list.node`);
    }
  } else if (process.platform === 'darwin' || process.platform === 'linux') {
    try {
      registerNativeModule('pty', require('node-pty/prebuilds/vortex/pty.node'), require.resolve('node-pty/prebuilds/vortex/pty.node'));
    } catch {
      const fallbackPath = `node-pty/prebuilds/${process.platform}-${process.arch}/pty.node`;
      registerFallbackNativeModule('pty', fallbackPath);
    }
  } else {
    throw new Error(`Unsupported VORTEX terminal platform: ${process.platform}/${process.arch}`);
  }

  const nodePtyUtils = require('node-pty/lib/utils') as NodePtyUtils;
  nodePtyUtils.loadNativeModule = (name) => {
    const module = nativeModules.get(name);
    if (!module) throw new Error(`Native node-pty module was not preloaded: ${name}`);
    return { dir: packagedNativeDirectory(), module };
  };

  return import('node-pty');
}

const nodePty = await loadNodePty();

export const spawn = nodePty.spawn;
export type { IDisposable, IPty } from 'node-pty';

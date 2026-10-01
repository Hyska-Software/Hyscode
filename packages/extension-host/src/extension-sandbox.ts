import type {
  ExtensionManifest,
  ExtensionModule,
  ExtensionContext,
  HyscodeAPI,
} from '@hyscode/extension-api';
import { createExtensionContext, disposeContext } from './extension-context';

interface ActiveExtension {
  manifest: ExtensionManifest;
  module: ExtensionModule;
  context: ExtensionContext;
}

const KNOWN_PERMISSIONS = new Set([
  'commands',
  'settings',
  'workspace',
  'terminal',
  'process',
  'network',
  'ui',
]);

export class ExtensionSandbox {
  private active = new Map<string, ActiveExtension>();

  async activate(
    manifest: ExtensionManifest,
    extensionPath: string,
    mainSource: string,
    api: HyscodeAPI,
  ): Promise<void> {
    if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      throw new Error(
        `Invalid extension name "${manifest.name}": must match /^[a-z0-9-]+$/`,
      );
    }
    if (this.active.has(manifest.name)) {
      console.warn(`[ExtensionSandbox] Extension "${manifest.name}" already active.`);
      return;
    }
    for (const permission of manifest.permissions ?? []) {
      if (!KNOWN_PERMISSIONS.has(permission)) {
        console.warn(
          `[ExtensionSandbox] Extension "${manifest.name}" declares unknown permission "${permission}".`,
        );
      }
    }

    // SECURITY: no isolation — extension code runs in the host JS realm with
    // full access to the passed `api` object. Execute only trusted extensions.
    // Mitigations (not a sandbox): activation timeout + error containment so
    // a hanging/failing extension can't wedge the host.
    const ACTIVATION_TIMEOUT_MS = 10_000;
    const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(
            `Extension "${manifest.name}" ${label} timed out after ${ACTIVATION_TIMEOUT_MS}ms`,
          )), ACTIVATION_TIMEOUT_MS),
        ),
      ]);

    try {
      const blob = new Blob([mainSource], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);

      let mod: ExtensionModule;
      try {
        console.log(`[ExtensionSandbox] Importing blob for "${manifest.name}"...`);
        mod = await withTimeout(import(/* @vite-ignore */ blobUrl), 'import');
        console.log(`[ExtensionSandbox] Blob imported — exports:`, Object.keys(mod));
      } catch (err) {
        console.error(`[ExtensionSandbox] Failed to import "${manifest.name}":`, err);
        throw err;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      if (typeof mod.activate !== 'function') {
        throw new Error(`Extension "${manifest.name}" does not export an activate() function.`);
      }

      const context = createExtensionContext(manifest.name, extensionPath, api);
      Object.freeze(context);

      console.log(`[ExtensionSandbox] Calling activate() for "${manifest.name}"...`);
      try {
        await withTimeout(Promise.resolve(mod.activate(context, api)), 'activate()');
      } catch (err) {
        console.error(`[ExtensionSandbox] activate() failed for "${manifest.name}":`, err);
        try {
          disposeContext(context);
        } catch (disposeErr) {
          console.error(`[ExtensionSandbox] Context cleanup failed for "${manifest.name}":`, disposeErr);
        }
        throw err;
      }
      console.log(`[ExtensionSandbox] activate() returned for "${manifest.name}"`);

      this.active.set(manifest.name, { manifest, module: mod, context });
      console.log(`[ExtensionSandbox] Activated "${manifest.displayName}" v${manifest.version}`);
    } catch (err) {
      console.error(`[ExtensionSandbox] Failed to activate "${manifest.name}":`, err);
      throw err;
    }
  }

  async deactivate(name: string): Promise<void> {
    const ext = this.active.get(name);
    if (!ext) return;

    try {
      await Promise.race([
        Promise.resolve(ext.module.deactivate?.()),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`deactivate() timed out after 5000ms`)), 5_000),
        ),
      ]);
    } catch (err) {
      console.error(`[ExtensionSandbox] Error in deactivate() for "${name}":`, err);
    }

    disposeContext(ext.context);
    this.active.delete(name);
    console.log(`[ExtensionSandbox] Deactivated "${name}"`);
  }

  async deactivateAll(): Promise<void> {
    const names = Array.from(this.active.keys());
    for (const name of names) {
      await this.deactivate(name);
    }
  }

  isActive(name: string): boolean {
    return this.active.has(name);
  }

  getActiveNames(): string[] {
    return Array.from(this.active.keys());
  }
}

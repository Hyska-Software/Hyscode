import type { ExtensionManifest, Disposable } from '@hyscode/extension-api';

export interface InstalledExtension {
  manifest: ExtensionManifest;
  path: string;
  enabled: boolean;
  installedAt: string;
}

type RegistryChangeHandler = (extensions: InstalledExtension[]) => void;

/** Host engine version extensions declare compatibility against.
 *  Kept in sync with the root `package.json` version. */
export const HOST_VERSION = '0.15.0';

export class ExtensionRegistry {
  private extensions = new Map<string, InstalledExtension>();
  private listeners = new Set<RegistryChangeHandler>();

  /** Storage key: `${publisher}.${name}` when a publisher exists, else `name`. */
  static keyFor(manifest: Pick<ExtensionManifest, 'name' | 'publisher'>): string {
    return manifest.publisher ? `${manifest.publisher}.${manifest.name}` : manifest.name;
  }

  /** Warn when the extension's required engine doesn't satisfy the host.
   *  Supports exact versions and caret ranges (`^0.15.0`); anything
   *  unparseable warns instead of blocking. */
  static checkEngineCompat(manifest: ExtensionManifest, hostVersion: string): boolean {
    const required = manifest.engines?.hyscode;
    if (!required) return true;
    const clean = (v: string): [number, number, number] | null => {
      const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim().replace(/^\^|^[~>=<]+/, ''));
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const want = clean(required);
    const have = clean(hostVersion);
    if (!want || !have) {
      console.warn(
        `[ExtensionRegistry] Extension "${manifest.name}" requires hyscode "${required}" — cannot verify against host "${hostVersion}".`,
      );
      return true;
    }
    const caret = required.trim().startsWith('^');
    const compatible = caret
      ? (want[0] === 0
          ? have[0] === 0 && have[1] === want[1] && have[2] >= want[2]
          : have[0] === want[0] && (have[1] > want[1] || (have[1] === want[1] && have[2] >= want[2])))
      : have[0] === want[0] && have[1] === want[1] && have[2] === want[2];
    if (!compatible) {
      console.warn(
        `[ExtensionRegistry] Extension "${manifest.name}" requires hyscode "${required}" but host is "${hostVersion}" — may be incompatible.`,
      );
    }
    return compatible;
  }

  load(entries: InstalledExtension[]) {
    this.extensions.clear();
    for (const ext of entries) {
      ExtensionRegistry.checkEngineCompat(ext.manifest, HOST_VERSION);
      this.extensions.set(ExtensionRegistry.keyFor(ext.manifest), ext);
    }
    this.notify();
  }

  add(ext: InstalledExtension) {
    ExtensionRegistry.checkEngineCompat(ext.manifest, HOST_VERSION);
    this.extensions.set(ExtensionRegistry.keyFor(ext.manifest), ext);
    this.notify();
  }

  remove(name: string) {
    // Accept both qualified (`publisher.name`) and bare keys.
    if (this.extensions.delete(name)) {
      this.notify();
      return;
    }
    for (const [key, ext] of this.extensions) {
      if (ext.manifest.name === name) {
        this.extensions.delete(key);
        this.notify();
        return;
      }
    }
  }

  get(name: string): InstalledExtension | undefined {
    const direct = this.extensions.get(name);
    if (direct) return direct;
    for (const ext of this.extensions.values()) {
      if (ext.manifest.name === name) return ext;
    }
    return undefined;
  }

  getAll(): InstalledExtension[] {
    return Array.from(this.extensions.values());
  }

  getEnabled(): InstalledExtension[] {
    return this.getAll().filter((e) => e.enabled);
  }

  getEnabledManifests(): ExtensionManifest[] {
    return this.getEnabled().map((e) => e.manifest);
  }

  setEnabled(name: string, enabled: boolean) {
    const ext = this.get(name);
    if (ext) {
      ext.enabled = enabled;
      this.notify();
    }
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  onChange(handler: RegistryChangeHandler): Disposable {
    this.listeners.add(handler);
    return {
      dispose: () => {
        this.listeners.delete(handler);
      },
    };
  }

  private notify() {
    const list = this.getAll();
    for (const listener of this.listeners) {
      listener(list);
    }
  }
}

import type { ExtensionManifest, Disposable } from '@hyscode/extension-api';

export interface InstalledExtension {
  manifest: ExtensionManifest;
  path: string;
  enabled: boolean;
  installedAt: string;
}

type RegistryChangeHandler = (extensions: InstalledExtension[]) => void;

export class ExtensionRegistry {
  private extensions = new Map<string, InstalledExtension>();
  private listeners = new Set<RegistryChangeHandler>();

  load(entries: InstalledExtension[]) {
    this.extensions.clear();
    for (const ext of entries) {
      this.extensions.set(ext.manifest.name, ext);
    }
    this.notify();
  }

  add(ext: InstalledExtension) {
    this.extensions.set(ext.manifest.name, ext);
    this.notify();
  }

  remove(name: string) {
    this.extensions.delete(name);
    this.notify();
  }

  get(name: string): InstalledExtension | undefined {
    return this.extensions.get(name);
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
    const ext = this.extensions.get(name);
    if (ext) {
      ext.enabled = enabled;
      this.notify();
    }
  }

  has(name: string): boolean {
    return this.extensions.has(name);
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

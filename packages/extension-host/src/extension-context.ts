import type {
  ExtensionContext,
  ExtensionMemento,
  HyscodeAPI,
} from '@hyscode/extension-api';

class InMemoryMemento implements ExtensionMemento {
  private store = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.store.has(key)) return this.store.get(key) as T;
    return defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }

  keys(): readonly string[] {
    return Array.from(this.store.keys());
  }
}

export function createExtensionContext(
  extensionName: string,
  extensionPath: string,
  api: HyscodeAPI,
): ExtensionContext {
  return {
    extensionName,
    extensionPath,
    subscriptions: [],
    globalState: new InMemoryMemento(),
    workspaceState: new InMemoryMemento(),
    _api: api,
  } as ExtensionContext & { _api: HyscodeAPI };
}

export function disposeContext(context: ExtensionContext) {
  for (const sub of context.subscriptions) {
    try {
      sub.dispose();
    } catch (err) {
      console.error(`[ExtensionContext] Error disposing subscription for "${context.extensionName}":`, err);
    }
  }
  context.subscriptions.length = 0;
}

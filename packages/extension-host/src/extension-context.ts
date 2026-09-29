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
  _api: HyscodeAPI,
): ExtensionContext {
  // NOTE: the full host `api` is intentionally NOT exposed on the context
  // object (`_api` escape hatch removed) — extensions receive only the
  // scoped `api` argument passed to `activate(context, api)`. `_api` is kept
  // as an unused parameter for signature compatibility; it lives only in
  // this closure and is never attached to the returned object.
  void _api;
  return {
    extensionName,
    extensionPath,
    subscriptions: [],
    globalState: new InMemoryMemento(),
    workspaceState: new InMemoryMemento(),
  };
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

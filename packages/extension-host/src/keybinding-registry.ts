import type { Disposable, KeybindingContribution } from '@hyscode/extension-api';

interface RegisteredKeybinding {
  command: string;
  key: string;
  mac?: string;
  when?: string;
  extensionName?: string;
}

export class KeybindingRegistry {
  private bindings: RegisteredKeybinding[] = [];
  private listeners = new Set<() => void>();

  register(binding: RegisteredKeybinding): Disposable {
    this.bindings.push(binding);
    this.notify();
    return {
      dispose: () => {
        const idx = this.bindings.indexOf(binding);
        if (idx !== -1) {
          this.bindings.splice(idx, 1);
          this.notify();
        }
      },
    };
  }

  registerContributions(keybindings: KeybindingContribution[], extensionName: string): Disposable[] {
    return keybindings.map((kb) =>
      this.register({
        command: kb.command,
        key: kb.key,
        mac: kb.mac,
        when: kb.when,
        extensionName,
      }),
    );
  }

  getAll(): RegisteredKeybinding[] {
    return [...this.bindings];
  }

  findByCommand(commandId: string): RegisteredKeybinding | undefined {
    return this.bindings.find((b) => b.command === commandId);
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

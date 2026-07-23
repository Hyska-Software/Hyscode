import type { CommandContribution, Disposable } from '@hyscode/extension-api';

type CommandHandler = (...args: unknown[]) => unknown;

interface RegisteredCommand {
  id: string;
  handler: CommandHandler;
  title?: string;
  category?: string;
  extensionName?: string;
}

export class CommandRegistry {
  private commands = new Map<string, RegisteredCommand>();
  private listeners = new Set<() => void>();

  registerCommand(
    id: string,
    handler: CommandHandler,
    meta?: { title?: string; category?: string; extensionName?: string },
  ): Disposable {
    if (this.commands.has(id)) {
      console.warn(`[CommandRegistry] Command "${id}" already registered, overwriting.`);
    }

    this.commands.set(id, {
      id,
      handler,
      title: meta?.title,
      category: meta?.category,
      extensionName: meta?.extensionName,
    });

    this.notify();

    return {
      dispose: () => {
        this.commands.delete(id);
        this.notify();
      },
    };
  }

  async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const cmd = this.commands.get(id);
    if (!cmd) {
      throw new Error(`Command "${id}" not found.`);
    }
    return (await cmd.handler(...args)) as T;
  }

  hasCommand(id: string): boolean {
    return this.commands.has(id);
  }

  getCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  getAllCommandsMeta(): RegisteredCommand[] {
    return Array.from(this.commands.values());
  }

  registerContributions(contributions: CommandContribution[], extensionName: string): Disposable[] {
    return contributions.map((cmd) =>
      this.registerCommand(cmd.id, () => {}, {
        title: cmd.title,
        category: cmd.category,
        extensionName,
      }),
    );
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

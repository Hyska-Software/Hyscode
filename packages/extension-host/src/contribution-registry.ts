import type {
  ThemeContribution,
  LanguageContribution,
  LspContribution,
  CommandContribution,
  KeybindingContribution,
  ViewContribution,
  StatusBarItemContribution,
  ConfigurationContribution,
  SnippetContribution,
  IconThemeContribution,
  MenuItem,
  Disposable,
  ExtensionManifest,
  ViewProvider,
  SettingsTabContribution,
} from '@hyscode/extension-api';

export interface MergedContributions {
  themes: Array<ThemeContribution & { extensionName: string }>;
  languages: Array<LanguageContribution & { extensionName: string }>;
  languageServers: Array<LspContribution & { extensionName: string }>;
  commands: Array<CommandContribution & { extensionName: string }>;
  keybindings: Array<KeybindingContribution & { extensionName: string }>;
  views: Array<ViewContribution & { extensionName: string }>;
  statusBarItems: Array<StatusBarItemContribution & { extensionName: string }>;
  configurations: Array<{ extensionName: string; config: ConfigurationContribution }>;
  snippets: Array<SnippetContribution & { extensionName: string }>;
  iconThemes: Array<IconThemeContribution & { extensionName: string }>;
  settingsTabs: Array<SettingsTabContribution & { extensionName: string }>;
  menus: {
    'editor/context': Array<MenuItem & { extensionName: string }>;
    'editor/title': Array<MenuItem & { extensionName: string }>;
    'explorer/context': Array<MenuItem & { extensionName: string }>;
    commandPalette: Array<MenuItem & { extensionName: string }>;
  };
}

export function emptyContributions(): MergedContributions {
  return {
    themes: [],
    languages: [],
    languageServers: [],
    commands: [],
    keybindings: [],
    views: [],
    statusBarItems: [],
    configurations: [],
    snippets: [],
    iconThemes: [],
    settingsTabs: [],
    menus: {
      'editor/context': [],
      'editor/title': [],
      'explorer/context': [],
      commandPalette: [],
    },
  };
}

type ContributionChangeHandler = (contributions: MergedContributions) => void;

export class ContributionRegistry {
  private merged: MergedContributions = emptyContributions();
  private viewProviders = new Map<string, ViewProvider>();
  private listeners = new Set<ContributionChangeHandler>();

  /** Reject `..` segments and absolute paths so contributions can't escape
   *  the extension directory. Returns false (and warns) when invalid. */
  private static isSafeRelativePath(path: string, what: string, extName: string): boolean {
    const normalized = path.replace(/\\/g, '/');
    if (
      normalized.includes('..') ||
      normalized.startsWith('/') ||
      /^[a-zA-Z]:\//.test(normalized)
    ) {
      console.warn(
        `[ContributionRegistry] Extension "${extName}" ${what} has unsafe path "${path}" — skipped.`,
      );
      return false;
    }
    return true;
  }

  rebuild(enabledManifests: ExtensionManifest[]): MergedContributions {
    const next = emptyContributions();
    // Unique-id tracking per section: first manifest wins, duplicates warn+skip.
    const seenCommandIds = new Set<string>();
    const seenViewIds = new Set<string>();
    const seenThemeIds = new Set<string>();
    const seenLanguageIds = new Set<string>();

    const claimId = (set: Set<string>, id: string, what: string, extName: string): boolean => {
      if (set.has(id)) {
        console.warn(
          `[ContributionRegistry] Duplicate ${what} id "${id}" from "${extName}" — skipped (first wins).`,
        );
        return false;
      }
      set.add(id);
      return true;
    };

    for (const manifest of enabledManifests) {
      const c = manifest.contributes;
      if (!c) continue;
      const extName = manifest.name;

      if (c.themes) {
        for (const t of c.themes) {
          if (!claimId(seenThemeIds, t.id, 'theme', extName)) continue;
          if (!ContributionRegistry.isSafeRelativePath(t.path, `theme "${t.id}"`, extName)) continue;
          next.themes.push({ ...t, extensionName: extName });
        }
      }
      if (c.languages) {
        for (const l of c.languages) {
          if (!claimId(seenLanguageIds, l.id, 'language', extName)) continue;
          next.languages.push({ ...l, extensionName: extName });
        }
      }
      if (c.languageServers) {
        for (const ls of c.languageServers) next.languageServers.push({ ...ls, extensionName: extName });
      }
      if (c.commands) {
        for (const cmd of c.commands) {
          if (!claimId(seenCommandIds, cmd.id, 'command', extName)) continue;
          next.commands.push({ ...cmd, extensionName: extName });
        }
      }
      if (c.keybindings) {
        for (const kb of c.keybindings) {
          // Core (built-in) commands aren't contributed by any manifest, so an
          // unknown id is only a warning — the command may still exist at runtime.
          if (!seenCommandIds.has(kb.command)) {
            console.warn(
              `[ContributionRegistry] Extension "${extName}" keybinding references uncontributed command "${kb.command}" (may be a core command).`,
            );
          }
          next.keybindings.push({ ...kb, extensionName: extName });
        }
      }
      if (c.views) {
        for (const v of c.views) {
          if (!claimId(seenViewIds, v.id, 'view', extName)) continue;
          next.views.push({ ...v, extensionName: extName });
        }
      }
      if (c.statusBarItems) {
        for (const si of c.statusBarItems) {
          if (si.command && !seenCommandIds.has(si.command)) {
            console.warn(
              `[ContributionRegistry] Extension "${extName}" statusBarItem "${si.id}" references uncontributed command "${si.command}" (may be a core command).`,
            );
          }
          next.statusBarItems.push({ ...si, extensionName: extName });
        }
      }
      if (c.configuration) {
        next.configurations.push({ extensionName: extName, config: c.configuration });
      }
      if (c.snippets) {
        for (const s of c.snippets) {
          if (!ContributionRegistry.isSafeRelativePath(s.path, `snippet (${s.language})`, extName)) continue;
          next.snippets.push({ ...s, extensionName: extName });
        }
      }
      if (c.iconThemes) {
        for (const it of c.iconThemes) {
          if (!ContributionRegistry.isSafeRelativePath(it.path, `iconTheme "${it.id}"`, extName)) continue;
          next.iconThemes.push({ ...it, extensionName: extName });
        }
      }
      if (c.settingsTabs) {
        for (const st of c.settingsTabs) next.settingsTabs.push({ ...st, extensionName: extName });
      }
      if (c.menus) {
        const menuKeys = ['editor/context', 'editor/title', 'explorer/context', 'commandPalette'] as const;
        for (const key of menuKeys) {
          const items = c.menus[key];
          if (items) {
            for (const item of items) {
              if (!seenCommandIds.has(item.command)) {
                console.warn(
                  `[ContributionRegistry] Extension "${extName}" menu "${key}" references uncontributed command "${item.command}" (may be a core command).`,
                );
              }
              next.menus[key].push({ ...item, extensionName: extName });
            }
          }
        }
      }
    }

    this.merged = next;
    this.notify();
    return next;
  }

  getCurrent(): MergedContributions {
    return this.merged;
  }

  registerViewProvider(viewId: string, provider: ViewProvider): Disposable {
    this.viewProviders.set(viewId, provider);
    return {
      dispose: () => {
        this.viewProviders.delete(viewId);
      },
    };
  }

  getViewProvider(viewId: string): ViewProvider | undefined {
    return this.viewProviders.get(viewId);
  }

  onChange(handler: ContributionChangeHandler): Disposable {
    this.listeners.add(handler);
    return {
      dispose: () => {
        this.listeners.delete(handler);
      },
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.merged);
    }
  }
}

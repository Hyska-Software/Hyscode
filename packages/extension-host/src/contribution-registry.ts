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

  rebuild(enabledManifests: ExtensionManifest[]): MergedContributions {
    const next = emptyContributions();

    for (const manifest of enabledManifests) {
      const c = manifest.contributes;
      if (!c) continue;
      const extName = manifest.name;

      if (c.themes) {
        for (const t of c.themes) next.themes.push({ ...t, extensionName: extName });
      }
      if (c.languages) {
        for (const l of c.languages) next.languages.push({ ...l, extensionName: extName });
      }
      if (c.languageServers) {
        for (const ls of c.languageServers) next.languageServers.push({ ...ls, extensionName: extName });
      }
      if (c.commands) {
        for (const cmd of c.commands) next.commands.push({ ...cmd, extensionName: extName });
      }
      if (c.keybindings) {
        for (const kb of c.keybindings) next.keybindings.push({ ...kb, extensionName: extName });
      }
      if (c.views) {
        for (const v of c.views) next.views.push({ ...v, extensionName: extName });
      }
      if (c.statusBarItems) {
        for (const si of c.statusBarItems) next.statusBarItems.push({ ...si, extensionName: extName });
      }
      if (c.configuration) {
        next.configurations.push({ extensionName: extName, config: c.configuration });
      }
      if (c.snippets) {
        for (const s of c.snippets) next.snippets.push({ ...s, extensionName: extName });
      }
      if (c.iconThemes) {
        for (const it of c.iconThemes) next.iconThemes.push({ ...it, extensionName: extName });
      }
      if (c.settingsTabs) {
        for (const st of c.settingsTabs) next.settingsTabs.push({ ...st, extensionName: extName });
      }
      if (c.menus) {
        const menuKeys = ['editor/context', 'editor/title', 'explorer/context', 'commandPalette'] as const;
        for (const key of menuKeys) {
          const items = c.menus[key];
          if (items) {
            for (const item of items) next.menus[key].push({ ...item, extensionName: extName });
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

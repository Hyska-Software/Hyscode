import { useEffect, useState, type ReactNode } from 'react';
import {
  X,
  Code2,
  Palette,
  Terminal,
  GitBranch,
  Settings2,
  BrainCircuit,
  Braces,
  Smartphone,
  Container,
  Info,
  Blocks,
  BookText,
  type LucideIcon,
} from 'lucide-react';
import { useSettingsStore } from '../../stores';
import { useExtensionStore } from '../../stores/extension-store';
import { notifyTabVisible } from '../../lib/extension-loader';
import { EditorTab } from './tabs/editor-tab';
import { ThemeTab } from './tabs/theme-tab';
import { TerminalTab } from './tabs/terminal-tab';
import { GitTab } from './tabs/git-tab';
import { GeneralTab } from './tabs/general-tab';
import { AiTab } from './tabs/ai-tab';
import { LanguageServersTab } from './tabs/language-servers-tab';
import { MobileTab } from './tabs/mobile-tab';
import { DockerTab } from './tabs/docker-tab';
import { AboutTab } from './tabs/about-tab';
import { ExtensionSettingsTab } from './tabs/extension-settings-tab';
import { ExtensionCustomTab } from './tabs/extension-custom-tab';
import { RulesTab } from './tabs/rules-tab';

// ── Built-in tabs ────────────────────────────────────────────────────────────

type BuiltinTabId = 'editor' | 'theme' | 'terminal' | 'git' | 'general' | 'ai' | 'languages' | 'mobile' | 'docker' | 'about' | 'extensions' | 'rules';

const BUILTIN_TAB_ITEMS: { id: BuiltinTabId; icon: LucideIcon; label: string }[] = [
  { id: 'editor', icon: Code2, label: 'Editor' },
  { id: 'theme', icon: Palette, label: 'Themes' },
  { id: 'languages', icon: Braces, label: 'Languages' },
  { id: 'terminal', icon: Terminal, label: 'Terminal' },
  { id: 'git', icon: GitBranch, label: 'Git' },
  { id: 'ai', icon: BrainCircuit, label: 'AI & Providers' },
  { id: 'rules', icon: BookText, label: 'Rules' },
  { id: 'mobile', icon: Smartphone, label: 'Mobile' },
  { id: 'docker', icon: Container, label: 'Docker' },
  { id: 'extensions', icon: Blocks, label: 'Extensions' },
  { id: 'general', icon: Settings2, label: 'General' },
  { id: 'about', icon: Info, label: 'About' },
];

const BUILTIN_TAB_CONTENT: Record<BuiltinTabId, ReactNode> = {
  editor: <EditorTab />,
  theme: <ThemeTab />,
  languages: <LanguageServersTab />,
  terminal: <TerminalTab />,
  git: <GitTab />,
  ai: <AiTab />,
  rules: <RulesTab />,
  mobile: <MobileTab />,
  docker: <DockerTab />,
  extensions: <ExtensionSettingsTab />,
  general: <GeneralTab />,
  about: <AboutTab />,
};

// ── Active tab discriminated union ───────────────────────────────────────────

type ActiveTab =
  | { type: 'builtin'; id: BuiltinTabId }
  | { type: 'extension'; tabId: string; extensionName: string; label: string };

// ── Icon map for extension-contributed icons ─────────────────────────────────

const EXT_ICON_MAP: Record<string, LucideIcon> = {
  blocks: Blocks,
  settings: Settings2,
  code: Code2,
  palette: Palette,
  terminal: Terminal,
  git: GitBranch,
  brain: BrainCircuit,
  info: Info,
};

function resolveExtIcon(icon?: string): LucideIcon {
  if (!icon) return Blocks;
  return EXT_ICON_MAP[icon.toLowerCase()] ?? Blocks;
}

// ── Component ────────────────────────────────────────────────────────────────

export function SettingsModal() {
  const open = useSettingsStore((s) => s.settingsOpen);
  const close = useSettingsStore((s) => s.closeSettings);
  const settingsInitialTab = useSettingsStore((s) => s.settingsInitialTab);
  const extensionSettingsTabs = useExtensionStore((s) => s.contributions.settingsTabs);

  const [activeTab, setActiveTab] = useState<ActiveTab>({ type: 'builtin', id: 'editor' });

  // Navigate to requested tab when modal opens
  useEffect(() => {
    if (open && settingsInitialTab) {
      const builtin = BUILTIN_TAB_ITEMS.find((t) => t.id === settingsInitialTab);
      if (builtin) {
        setActiveTab({ type: 'builtin', id: builtin.id });
      }
      useSettingsStore.getState().set('settingsInitialTab', null);
    }
  }, [open, settingsInitialTab]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, close]);

  // When the active extension tab is removed (extension disabled), fall back to editor
  useEffect(() => {
    if (activeTab.type !== 'extension') return;
    const still = extensionSettingsTabs.find((t) => t.id === activeTab.tabId);
    if (!still) setActiveTab({ type: 'builtin', id: 'editor' });
  }, [extensionSettingsTabs, activeTab]);

  if (!open) return null;

  const handleBuiltinTabClick = (id: BuiltinTabId) => {
    setActiveTab({ type: 'builtin', id });
  };

  const handleExtTabClick = (tab: typeof extensionSettingsTabs[number]) => {
    setActiveTab({ type: 'extension', tabId: tab.id, extensionName: tab.extensionName, label: tab.label });
    notifyTabVisible(tab.id);
  };

  const activeLabel =
    activeTab.type === 'builtin'
      ? BUILTIN_TAB_ITEMS.find((t) => t.id === activeTab.id)?.label ?? ''
      : activeTab.label;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex h-[580px] w-[860px] overflow-hidden rounded-xl bg-surface shadow-2xl">
        {/* Left navigation */}
        <nav className="flex w-[200px] flex-col bg-background p-3 overflow-y-auto">
          <div className="mb-4 flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Settings
            </span>
            <button
              onClick={close}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Built-in tabs */}
          <div className="flex flex-col gap-0.5">
            {BUILTIN_TAB_ITEMS.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => handleBuiltinTabClick(id)}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium transition-colors ${
                  activeTab.type === 'builtin' && activeTab.id === id
                    ? 'bg-surface-raised text-foreground'
                    : 'text-muted-foreground hover:bg-surface-raised/50 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Extension tabs — only shown when extensions contribute them */}
          {extensionSettingsTabs.length > 0 && (
            <>
              <div className="my-2 border-t border-border/40" />
              <span className="mb-1 px-2.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                Extensions
              </span>
              <div className="flex flex-col gap-0.5">
                {extensionSettingsTabs.map((tab) => {
                  const Icon = resolveExtIcon(tab.icon);
                  const isActive =
                    activeTab.type === 'extension' && activeTab.tabId === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleExtTabClick(tab)}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium transition-colors ${
                        isActive
                          ? 'bg-surface-raised text-foreground'
                          : 'text-muted-foreground hover:bg-surface-raised/50 hover:text-foreground'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </nav>

        {/* Right content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab header */}
          <div className="flex h-12 items-center border-b border-surface-raised px-6">
            <h2 className="text-[13px] font-semibold text-foreground">{activeLabel}</h2>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {activeTab.type === 'builtin' ? (
              BUILTIN_TAB_CONTENT[activeTab.id]
            ) : (
              <ExtensionCustomTab tabId={activeTab.tabId} extensionName={activeTab.extensionName} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


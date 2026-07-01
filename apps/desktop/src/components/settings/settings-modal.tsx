import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  X,
  Code2,
  Palette,
  Terminal,
  GitBranch,
  Settings2,
  BrainCircuit,
  Info,
  Blocks,
  RotateCcw,
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
import { SubAgentsTab } from './tabs/sub-agents-tab';
import { SettingsSearch } from './settings-search';
import { SettingsTree } from './settings-tree';
import {
  BUILTIN_GROUPS,
  buildExtensionsGroup,
  findGroupForBuiltin,
  findBuiltinLeaf,
  isTabModified,
  resetTabToDefaults,
  type BuiltinTabId,
  type GroupId,
  type ExtensionTabRef,
} from './tree-data';

// ── Built-in tabs ────────────────────────────────────────────────────────────

type BuiltinTabIdAny = BuiltinTabId;

const BUILTIN_TAB_CONTENT: Record<BuiltinTabIdAny, ReactNode> = {
  editor: <EditorTab />,
  theme: <ThemeTab />,
  languages: <LanguageServersTab />,
  terminal: <TerminalTab />,
  git: <GitTab />,
  ai: <AiTab />,
  rules: <RulesTab />,
  'sub-agents': <SubAgentsTab />,
  mobile: <MobileTab />,
  docker: <DockerTab />,
  extensions: <ExtensionSettingsTab />,
  general: <GeneralTab />,
  about: <AboutTab />,
};

// ── Active tab discriminated union ───────────────────────────────────────────

type ActiveTab =
  | { type: 'builtin'; id: BuiltinTabIdAny }
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
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const setTreeExpandedGroups = useSettingsStore((s) => s.setTreeExpandedGroups);
  const treeExpandedGroups = useSettingsStore((s) => s.treeExpandedGroups);
  const settingsInitialTab = useSettingsStore((s) => s.settingsInitialTab);
  const extensionSettingsTabs = useExtensionStore((s) => s.contributions.settingsTabs);

  const [activeTab, setActiveTab] = useState<ActiveTab>({ type: 'builtin', id: 'general' });
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(false);

  const expandedIds = useMemo(
    () => new Set<GroupId>(treeExpandedGroups as GroupId[]),
    [treeExpandedGroups],
  );

  // Build the extensions group (null when none exist).
  const extensionsGroup = useMemo<ReturnType<typeof buildExtensionsGroup>>(() => {
    const refs: ExtensionTabRef[] = extensionSettingsTabs.map((t) => ({
      id: t.id,
      label: t.label,
      icon: resolveExtIcon(t.icon),
      extensionName: t.extensionName,
    }));
    return buildExtensionsGroup(refs);
  }, [extensionSettingsTabs]);

  // Convert extension tabs into BUILTIN_GROUPS-compatible form (with icon already resolved)
  // by passing the resolved extensionsGroup directly to the tree.

  // Compute result count for the search footer. Must run before any early return.
  const resultCount = useMemo(() => {
    if (!query.trim()) return undefined;
    let count = 0;
    for (const group of BUILTIN_GROUPS) {
      for (const leaf of group.leaves) {
        if (matchesLeafQuery(leaf.label, leaf.keywords, query)) count++;
      }
    }
    if (extensionsGroup) {
      for (const leaf of extensionsGroup.leaves) {
        if (matchesLeafQuery(leaf.label, leaf.keywords, query)) count++;
      }
    }
    return count;
  }, [query, extensionsGroup]);

  // Auto-expand the group containing the active tab when the active tab *changes*.
  // (Not on every render — that would fight manual collapse.)
  const activeKey = activeTab.type === 'builtin' ? `b:${activeTab.id}` : `e:${activeTab.tabId}`;
  const prevActiveKeyRef = useRef<string>(activeKey);
  useEffect(() => {
    if (!open) return;
    const prev = prevActiveKeyRef.current;
    prevActiveKeyRef.current = activeKey;
    if (prev === activeKey) return;
    if (activeTab.type !== 'builtin') return;
    const gid = findGroupForBuiltin(activeTab.id);
    if (!gid) return;
    if (expandedIds.has(gid)) return;
    setTreeExpandedGroups([gid, ...treeExpandedGroups.filter((g) => g !== gid)]);
  }, [open, activeKey]);

  // Navigate to requested tab when modal opens.
  useEffect(() => {
    if (open && settingsInitialTab) {
      if (settingsInitialTab in BUILTIN_TAB_CONTENT) {
        setActiveTab({ type: 'builtin', id: settingsInitialTab as BuiltinTabIdAny });
        const gid = findGroupForBuiltin(settingsInitialTab);
        if (gid && !expandedIds.has(gid)) {
          setTreeExpandedGroups([gid, ...treeExpandedGroups.filter((g) => g !== gid)]);
        }
      } else {
        const ext = extensionSettingsTabs.find((t) => t.id === settingsInitialTab);
        if (ext) {
          setActiveTab({
            type: 'extension',
            tabId: ext.id,
            extensionName: ext.extensionName,
            label: ext.label,
          });
          notifyTabVisible(ext.id);
        }
      }
      useSettingsStore.getState().set('settingsInitialTab', null);
    }
  }, [open, settingsInitialTab, extensionSettingsTabs, expandedIds, treeExpandedGroups, setTreeExpandedGroups]);

  // Focus search on first open; reset query on close.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      requestAnimationFrame(() => searchRef.current?.focus());
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      setQuery('');
    }
  }, [open]);

  // Keyboard: Ctrl+F / Cmd+F focuses the search bar from anywhere in the modal.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const isFind = (e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F');
      if (isFind) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'Escape') {
        // If a query is active, clear it first; otherwise close.
        if (query) {
          setQuery('');
        } else {
          closeSettings();
        }
      } else if (e.key === '/' && document.activeElement === document.body) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, query, closeSettings]);

  // When the active extension tab is removed (extension disabled), fall back to general.
  useEffect(() => {
    if (activeTab.type !== 'extension') return;
    const still = extensionSettingsTabs.find((t) => t.id === activeTab.tabId);
    if (!still) setActiveTab({ type: 'builtin', id: 'general' });
  }, [extensionSettingsTabs, activeTab]);

  const handleBuiltinTabClick = useCallback((id: BuiltinTabIdAny) => {
    setActiveTab({ type: 'builtin', id });
  }, []);

  const handleExtTabClick = useCallback((tab: { id: string; extensionName: string; label: string }) => {
    setActiveTab({ type: 'extension', tabId: tab.id, extensionName: tab.extensionName, label: tab.label });
    notifyTabVisible(tab.id);
  }, []);

  const handleToggleGroup = useCallback(
    (groupId: GroupId) => {
      const next = expandedIds.has(groupId)
        ? treeExpandedGroups.filter((g) => g !== groupId)
        : [...treeExpandedGroups, groupId];
      setTreeExpandedGroups(next);
    },
    [expandedIds, treeExpandedGroups, setTreeExpandedGroups],
  );

  const handleResetTab = useCallback(() => {
    if (activeTab.type !== 'builtin') return;
    if (!isTabModified(activeTab.id)) return;
    resetTabToDefaults(activeTab.id);
  }, [activeTab]);

  const handleSearchEnter = useCallback(() => {
    // Find the first matching leaf (by search query) and select it.
    if (!query.trim()) return;
    const trimmed = query.toLowerCase();
    const matches = (label: string, keywords?: readonly string[]): boolean =>
      trimmed
        .split(/\s+/)
        .filter(Boolean)
        .every((t) => [label, ...(keywords ?? [])].join(' ').toLowerCase().includes(t));
    for (const group of BUILTIN_GROUPS) {
      for (const leaf of group.leaves) {
        if (matches(leaf.label, leaf.keywords)) {
          handleBuiltinTabClick(leaf.id as BuiltinTabIdAny);
          return;
        }
      }
    }
    if (extensionsGroup) {
      for (const leaf of extensionsGroup.leaves) {
        if (matches(leaf.label, leaf.keywords)) {
          const ext = extensionSettingsTabs.find((t) => t.id === leaf.id);
          if (ext) handleExtTabClick(ext);
          return;
        }
      }
    }
  }, [query, extensionsGroup, extensionSettingsTabs, handleBuiltinTabClick, handleExtTabClick]);

  if (!open) return null;

  // Resolve display info for the active tab.
  const activeLabel =
    activeTab.type === 'builtin'
      ? findBuiltinLeaf(activeTab.id)?.leaf.label ?? ''
      : activeTab.label;
  const activeGroupLabel =
    activeTab.type === 'builtin'
      ? BUILTIN_GROUPS.find((g) => g.id === findGroupForBuiltin(activeTab.id))?.label ?? null
      : extensionsGroup && extensionsGroup.leaves.some((l) => l.id === activeTab.tabId)
        ? extensionsGroup.label
        : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSettings();
      }}
    >
      <div className="flex h-[580px] w-[1100px] overflow-hidden rounded-xl bg-surface shadow-2xl">
        {/* Left navigation */}
        <nav className="flex w-[240px] flex-col overflow-hidden border-r border-border/40 bg-background">
          <div className="flex items-center justify-between px-3 pb-2 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Settings
            </span>
            <button
              onClick={closeSettings}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close settings"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <SettingsSearch
            ref={searchRef}
            value={query}
            onChange={setQuery}
            onEnter={handleSearchEnter}
            resultCount={resultCount}
          />

          <SettingsTree
            groups={BUILTIN_GROUPS}
            extensionsGroup={extensionsGroup ?? undefined}
            activeLeafId={activeTab.type === 'builtin' ? activeTab.id : activeTab.tabId}
            expandedIds={expandedIds}
            query={query}
            onSelectLeaf={(id) => {
              const isBuiltin = id in BUILTIN_TAB_CONTENT;
              if (isBuiltin) {
                handleBuiltinTabClick(id as BuiltinTabIdAny);
              } else {
                const ext = extensionSettingsTabs.find((t) => t.id === id);
                if (ext) handleExtTabClick(ext);
              }
            }}
            onToggleGroup={handleToggleGroup}
          />
        </nav>

        {/* Right content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab header */}
          <div className="flex h-12 items-center justify-between border-b border-surface-raised px-6">
            <div className="flex flex-col">
              {activeGroupLabel && activeTab.type === 'builtin' && findGroupForBuiltin(activeTab.id) !== activeTab.id && (
                <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/60">
                  <span>{activeGroupLabel}</span>
                  <span className="text-muted-foreground/40">›</span>
                  <span>{activeLabel}</span>
                </div>
              )}
              <h2 className="text-[13px] font-semibold text-foreground">{activeLabel}</h2>
            </div>
            {activeTab.type === 'builtin' && isTabModified(activeTab.id) && (
              <button
                type="button"
                onClick={handleResetTab}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
                title="Reset all settings on this tab to their defaults"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset to defaults</span>
              </button>
            )}
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

// ── Local helper ────────────────────────────────────────────────────────────

function matchesLeafQuery(label: string, keywords: readonly string[] | undefined, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = [label, ...(keywords ?? [])].join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

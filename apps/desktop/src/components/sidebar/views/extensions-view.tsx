import { useEffect, useState, useCallback } from 'react';
import {
  Blocks,
  Search,
  Trash2,
  FolderOpen,
  RefreshCw,
  FileArchive,
  ChevronLeft,
  Power,
  PowerOff,
  Package,
  Palette,
  Code2,
  Filter,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  GitFork,
  ArrowUpCircle,
  Link,
  Store,
  Download,
  HardDrive,
  BookOpen,
} from 'lucide-react';
import { useExtensionStore, type ExtensionFilter, type InstalledExtension, type StoreItem } from '../../../stores/extension-store';
import { useEditorStore } from '../../../stores/editor-store';
import { tauriFs } from '../../../lib/tauri-fs';
import { TabBadge } from '../../ui/tab-badge';

// ── README helpers ────────────────────────────────────────────────────────────

const STORE_README_BASE = 'https://raw.githubusercontent.com/Hyska-Software/Hyscode-Extensions/main/';

async function fetchStoreReadme(name: string): Promise<string> {
  try {
    const res = await fetch(`${STORE_README_BASE}${name}/README.md`);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function readLocalReadme(extPath: string): Promise<string> {
  const sep = extPath.includes('/') ? '/' : '\\';
  const readmePath = `${extPath}${sep}README.md`;
  try {
    return await tauriFs.readFile(readmePath);
  } catch {
    return '';
  }
}

function computeContributions(ext: InstalledExtension): { label: string; count: number }[] {
  const c = ext.manifest?.contributes;
  if (!c) return [];
  const result: { label: string; count: number }[] = [];
  if (c.themes?.length) result.push({ label: 'Themes', count: c.themes.length });
  if (c.languages?.length) result.push({ label: 'Languages', count: c.languages.length });
  if (c.languageServers?.length) result.push({ label: 'Language Servers', count: c.languageServers.length });
  if (c.commands?.length) result.push({ label: 'Commands', count: c.commands.length });
  if (c.keybindings?.length) result.push({ label: 'Keybindings', count: c.keybindings.length });
  if (c.views?.length) result.push({ label: 'Views', count: c.views.length });
  if (c.statusBarItems?.length) result.push({ label: 'Status Bar Items', count: c.statusBarItems.length });
  if (c.snippets?.length) result.push({ label: 'Snippets', count: c.snippets.length });
  if (c.configuration) result.push({ label: 'Settings', count: Object.keys(c.configuration.properties || {}).length });
  return result;
}

// ── Filter Tabs ──────────────────────────────────────────────────────────────

const FILTER_OPTIONS: { value: ExtensionFilter; label: string; icon: typeof Blocks }[] = [
  { value: 'all', label: 'All', icon: Blocks },
  { value: 'enabled', label: 'Enabled', icon: Power },
  { value: 'disabled', label: 'Disabled', icon: PowerOff },
  { value: 'themes', label: 'Themes', icon: Palette },
  { value: 'languages', label: 'Languages', icon: Code2 },
];

// ── Extension Detail Panel ───────────────────────────────────────────────────

function ExtensionDetail({
  ext,
  onBack,
}: {
  ext: InstalledExtension;
  onBack: () => void;
}) {
  const toggleExtension = useExtensionStore((s) => s.toggleExtension);
  const uninstallExtension = useExtensionStore((s) => s.uninstallExtension);
  const gitSources = useExtensionStore((s) => s.gitSources);
  const gitUpdates = useExtensionStore((s) => s.gitUpdates);
  const updateFromGit = useExtensionStore((s) => s.updateFromGit);
  const openExtensionReadmeTab = useEditorStore((s) => s.openExtensionReadmeTab);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [updatingGit, setUpdatingGit] = useState(false);
  const [loadingReadme, setLoadingReadme] = useState(false);

  const gitSource = gitSources[ext.name];
  const gitUpdate = gitUpdates[ext.name];

  const handleUpdate = useCallback(async () => {
    setUpdatingGit(true);
    try {
      await updateFromGit(ext.name);
    } finally {
      setUpdatingGit(false);
    }
  }, [ext.name, updateFromGit]);

  const handleViewReadme = useCallback(async () => {
    setLoadingReadme(true);
    try {
      const content = await readLocalReadme(ext.path);
      openExtensionReadmeTab({
        extensionName: ext.name,
        displayName: ext.displayName || ext.name,
        readmeContent: content,
        iconUrl: ext.icon,
        version: ext.version,
        publisher: ext.publisher,
        description: ext.description,
        enabled: ext.enabled,
        categories: ext.categories,
        activationEvents: ext.activationEvents,
        installedAt: ext.installedAt,
        hasMain: ext.hasMain,
        contributions: computeContributions(ext),
      });
    } finally {
      setLoadingReadme(false);
    }
  }, [ext, openExtensionReadmeTab]);

  const contributes = ext.manifest?.contributes;
  const contributionSummary: { label: string; count: number }[] = [];
  if (contributes?.themes?.length) contributionSummary.push({ label: 'Themes', count: contributes.themes.length });
  if (contributes?.languages?.length) contributionSummary.push({ label: 'Languages', count: contributes.languages.length });
  if (contributes?.languageServers?.length) contributionSummary.push({ label: 'Language Servers', count: contributes.languageServers.length });
  if (contributes?.commands?.length) contributionSummary.push({ label: 'Commands', count: contributes.commands.length });
  if (contributes?.keybindings?.length) contributionSummary.push({ label: 'Keybindings', count: contributes.keybindings.length });
  if (contributes?.views?.length) contributionSummary.push({ label: 'Views', count: contributes.views.length });
  if (contributes?.statusBarItems?.length) contributionSummary.push({ label: 'Status Bar Items', count: contributes.statusBarItems.length });
  if (contributes?.snippets?.length) contributionSummary.push({ label: 'Snippets', count: contributes.snippets.length });
  if (contributes?.configuration) contributionSummary.push({ label: 'Settings', count: Object.keys(contributes.configuration.properties || {}).length });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <button
          onClick={onBack}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] font-medium text-foreground truncate">
          {ext.displayName || ext.name}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Extension info */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            {ext.icon ? (
              <img
                src={ext.icon}
                alt={ext.displayName || ext.name}
                className="h-10 w-10 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Package className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="text-[12px] font-semibold text-foreground leading-tight">
                {ext.displayName || ext.name}
              </h3>
              <p className="text-[10px] text-muted-foreground">
                {ext.publisher} · v{ext.version}
              </p>
            </div>
          </div>
          {ext.description && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {ext.description}
            </p>
          )}
        </div>

        {/* Status + Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => toggleExtension(ext.name)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] font-medium transition-colors ${
              ext.enabled
                ? 'bg-accent/10 text-accent hover:bg-accent/20'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {ext.enabled ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                Enabled
              </>
            ) : (
              <>
                <PowerOff className="h-3 w-3" />
                Disabled
              </>
            )}
          </button>
          <button
            onClick={handleViewReadme}
            disabled={loadingReadme}
            className="flex items-center justify-center gap-1 rounded-md bg-muted px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="View README"
          >
            {loadingReadme ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <BookOpen className="h-3 w-3" />
            )}
          </button>
          {!confirmUninstall ? (
            <button
              onClick={() => setConfirmUninstall(true)}
              className="flex items-center justify-center gap-1 rounded-md bg-muted px-3 py-1.5 text-[10px] text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : (
            <button
              onClick={() => uninstallExtension(ext.name)}
              className="flex items-center justify-center gap-1 rounded-md bg-red-500/10 px-3 py-1.5 text-[10px] text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Confirm
            </button>
          )}
        </div>

        {/* Categories */}
        {ext.categories?.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Categories
            </p>
            <div className="flex flex-wrap gap-1">
              {ext.categories.map((cat) => (
                <span
                  key={cat}
                  className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground"
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Contributions */}
        {contributionSummary.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Contributions
            </p>
            <div className="space-y-0.5">
              {contributionSummary.map((c) => (
                <div
                  key={c.label}
                  className="flex items-center justify-between rounded px-2 py-1 text-[10px]"
                >
                  <span className="text-muted-foreground">{c.label}</span>
                  <span className="font-mono text-[9px] text-foreground/60">{c.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activation Events */}
        {ext.activationEvents?.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Activation Events
            </p>
            <div className="space-y-0.5">
              {ext.activationEvents.map((ev) => (
                <div
                  key={ev}
                  className="rounded bg-muted px-2 py-0.5 text-[9px] font-mono text-muted-foreground"
                >
                  {ev}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="space-y-1 border-t border-border pt-3">
          <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Details
          </p>
          <div className="space-y-0.5 text-[10px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Identifier</span>
              <span className="font-mono text-[9px] text-foreground/60">{ext.name}</span>
            </div>
            {ext.installedAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Installed</span>
                <span className="text-foreground/60">{ext.installedAt}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Has Code</span>
              <span className="text-foreground/60">{ext.hasMain ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>

        {/* Git Source section */}
        {gitSource && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Git Source
              </p>
              {gitUpdate?.hasUpdate && (
                <span className="flex items-center gap-0.5 rounded-full bg-orange-500/15 px-1.5 py-px text-[9px] font-medium text-orange-400">
                  <ArrowUpCircle className="h-2.5 w-2.5" />
                  Update available
                </span>
              )}
            </div>
            <div className="space-y-1 text-[10px]">
              <div className="flex items-center gap-1.5 rounded bg-muted/60 px-2 py-1">
                <Link className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />
                <span className="truncate text-muted-foreground" title={gitSource.repoUrl}>
                  {gitSource.repoUrl.replace(/^https?:\/\//, '')}
                </span>
              </div>
              <div className="flex items-center justify-between px-0.5">
                <span className="text-muted-foreground/70">Branch</span>
                <span className="font-mono text-[9px] text-foreground/60">{gitSource.branch}</span>
              </div>
              <div className="flex items-center justify-between px-0.5">
                <span className="text-muted-foreground/70">Commit</span>
                <span className="font-mono text-[9px] text-foreground/60">
                  {gitSource.localCommitSha.slice(0, 7)}
                </span>
              </div>
              {gitUpdate?.hasUpdate && (
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-muted-foreground/70">Remote</span>
                  <span className="font-mono text-[9px] text-orange-400">
                    {gitUpdate.remoteSha.slice(0, 7)}
                  </span>
                </div>
              )}
            </div>
            {gitUpdate?.hasUpdate && (
              <button
                onClick={handleUpdate}
                disabled={updatingGit}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md bg-orange-500/10 py-1.5 text-[10px] font-medium text-orange-400 hover:bg-orange-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updatingGit ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <ArrowUpCircle className="h-3 w-3" />
                    Update Extension
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Extension Row ────────────────────────────────────────────────────────────

function ExtensionRow({
  ext,
  storeUpdateNames,
  onSelect,
}: {
  ext: InstalledExtension;
  storeUpdateNames: Set<string>;
  onSelect: () => void;
}) {
  const toggleExtension = useExtensionStore((s) => s.toggleExtension);
  const openExtensionReadmeTab = useEditorStore((s) => s.openExtensionReadmeTab);
  const gitUpdates = useExtensionStore((s) => s.gitUpdates);
  const hasGitUpdate = gitUpdates[ext.name]?.hasUpdate ?? false;
  const hasStoreUpdate = storeUpdateNames.has(ext.name);
  const hasUpdate = hasGitUpdate || hasStoreUpdate;
  const [loadingReadme, setLoadingReadme] = useState(false);

  const handleClick = useCallback(async () => {
    setLoadingReadme(true);
    try {
      const content = await readLocalReadme(ext.path);
      openExtensionReadmeTab({
        extensionName: ext.name,
        displayName: ext.displayName || ext.name,
        readmeContent: content,
        iconUrl: ext.icon,
        version: ext.version,
        publisher: ext.publisher,
        description: ext.description,
        enabled: ext.enabled,
        categories: ext.categories,
        activationEvents: ext.activationEvents,
        installedAt: ext.installedAt,
        hasMain: ext.hasMain,
        contributions: computeContributions(ext),
      });
    } finally {
      setLoadingReadme(false);
    }
  }, [ext, openExtensionReadmeTab]);

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 transition-colors cursor-pointer group"
      onClick={handleClick}
    >
      <div className="relative shrink-0">
        {ext.icon ? (
          <img
            src={ext.icon}
            alt={ext.displayName || ext.name}
            className="h-7 w-7 rounded-md object-cover"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
            {loadingReadme ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Package className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
        )}
        {hasUpdate && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-orange-400 ring-1 ring-background" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[11px] font-medium truncate ${
              ext.enabled ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {ext.displayName || ext.name}
          </span>
          {!ext.enabled && (
            <span className="shrink-0 rounded bg-muted px-1 py-px text-[8px] text-muted-foreground/60">
              OFF
            </span>
          )}
          {hasUpdate && (
            <span className="shrink-0 rounded-full bg-orange-500/15 px-1 py-px text-[8px] font-medium text-orange-400">
              ↑
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 truncate">
          <span className="text-[10px] text-muted-foreground/70 truncate">
            {ext.description || 'No description'}
          </span>
          {ext.version && ext.version !== '0.0.0' && (
            <span className="shrink-0 text-[9px] text-muted-foreground/40 font-mono">
              v{ext.version}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="rounded p-1 text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-all"
          title="Extension details"
        >
          <Blocks className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleExtension(ext.name);
          }}
          className={`shrink-0 rounded-full p-1 transition-colors ${
            ext.enabled
              ? 'text-accent hover:bg-accent/10'
              : 'text-muted-foreground/40 hover:bg-muted'
          }`}
          title={ext.enabled ? 'Disable' : 'Enable'}
        >
          {ext.enabled ? (
            <Power className="h-3 w-3" />
          ) : (
            <PowerOff className="h-3 w-3" />
          )}
        </button>
      </div>
    </div>
  );
}

// ── Store View ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function StoreRow({
  item,
  isInstalled,
  isInstalling,
  hasUpdate,
  isUpdating,
  onInstall,
  onUpdate,
}: {
  item: StoreItem;
  isInstalled: boolean;
  isInstalling: boolean;
  hasUpdate: boolean;
  isUpdating: boolean;
  onInstall: () => void;
  onUpdate: () => void;
}) {
  const openExtensionReadmeTab = useEditorStore((s) => s.openExtensionReadmeTab);
  const [loadingReadme, setLoadingReadme] = useState(false);

  const handleClick = useCallback(async () => {
    setLoadingReadme(true);
    try {
      const content = await fetchStoreReadme(item.name);
      openExtensionReadmeTab({
        extensionName: item.name,
        displayName: item.displayName,
        readmeContent: content,
      });
    } finally {
      setLoadingReadme(false);
    }
  }, [item, openExtensionReadmeTab]);

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 transition-colors cursor-pointer group"
      onClick={handleClick}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
        {loadingReadme ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium truncate text-foreground">
            {item.displayName}
          </span>
          {isInstalled && !hasUpdate && (
            <span className="shrink-0 flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-px text-[8px] font-medium text-accent">
              <CheckCircle2 className="h-2 w-2" />
              Installed
            </span>
          )}
          {hasUpdate && (
            <span className="shrink-0 flex items-center gap-0.5 rounded-full bg-orange-500/15 px-1.5 py-px text-[8px] font-medium text-orange-400">
              <RefreshCw className="h-2 w-2" />
              Update
            </span>
          )}
        </div>
        <div className="truncate text-[10px] text-muted-foreground/70">
          {formatBytes(item.size)}
        </div>
      </div>
      {hasUpdate ? (
        <button
          onClick={(e) => { e.stopPropagation(); onUpdate(); }}
          disabled={isUpdating}
          className={`shrink-0 flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-medium transition-colors ${
            isUpdating
              ? 'bg-orange-500/10 text-orange-400/60 cursor-not-allowed'
              : 'bg-orange-500/10 text-orange-400 hover:bg-orange-500/20'
          }`}
          title={`Update ${item.displayName}`}
        >
          {isUpdating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onInstall(); }}
          disabled={isInstalled || isInstalling}
          className={`shrink-0 flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-medium transition-colors ${
            isInstalled
              ? 'text-accent/50 cursor-default'
              : isInstalling
                ? 'bg-accent/10 text-accent/60 cursor-not-allowed'
                : 'bg-muted text-muted-foreground hover:bg-accent/10 hover:text-accent'
          }`}
          title={isInstalled ? 'Already installed' : `Install ${item.displayName}`}
        >
          {isInstalling ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isInstalled ? (
            <HardDrive className="h-3 w-3" />
          ) : (
            <Download className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}

function StoreView() {
  const storeItems = useExtensionStore((s) => s.storeItems);
  const storeLoading = useExtensionStore((s) => s.storeLoading);
  const storeError = useExtensionStore((s) => s.storeError);
  const installingFromStore = useExtensionStore((s) => s.installingFromStore);
  const updatingFromStore = useExtensionStore((s) => s.updatingFromStore);
  const storeFetchedAt = useExtensionStore((s) => s.storeFetchedAt);
  const fetchStoreItems = useExtensionStore((s) => s.fetchStoreItems);
  const installFromStore = useExtensionStore((s) => s.installFromStore);
  const updateExtensionFromStore = useExtensionStore((s) => s.updateExtensionFromStore);
  const getStoreUpdates = useExtensionStore((s) => s.getStoreUpdates);
  const extensions = useExtensionStore((s) => s.extensions);
  const error = useExtensionStore((s) => s.error);

  const [storeSearch, setStoreSearch] = useState('');

  const installedNames = new Set(extensions.map((e) => e.name));
  const storeUpdateNames = new Set(getStoreUpdates());

  useEffect(() => {
    // Re-fetch only if data is stale (> 30s) — ExtensionsView already fetched
    // on mount, so this avoids a double-fetch when opening the store tab immediately.
    const age = storeFetchedAt ? Date.now() - storeFetchedAt : Infinity;
    if (age > 30_000) {
      void fetchStoreItems();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = storeSearch.trim()
    ? storeItems.filter((item) =>
        item.displayName.toLowerCase().includes(storeSearch.toLowerCase()) ||
        item.name.toLowerCase().includes(storeSearch.toLowerCase()),
      )
    : storeItems;

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="px-2 pt-1 pb-1 border-b border-border">
        <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          <input
            type="text"
            value={storeSearch}
            onChange={(e) => setStoreSearch(e.target.value)}
            placeholder="Search store..."
            className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none"
          />
          {storeSearch && (
            <button
              onClick={() => setStoreSearch('')}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-border">
        <span className="text-[9px] text-muted-foreground/60">
          {storeItems.length > 0
            ? `${storeItems.length} available${storeUpdateNames.size > 0 ? ` · ${storeUpdateNames.size} update${storeUpdateNames.size > 1 ? 's' : ''}` : ''}`
            : storeFetchedAt
              ? 'No extensions found'
              : ''}
        </span>
        <button
          onClick={() => void fetchStoreItems()}
          disabled={storeLoading}
          className="rounded p-0.5 text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
          title="Refresh store"
        >
          <RefreshCw className={`h-3 w-3 ${storeLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Install error */}
      {error && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 text-[10px] text-red-400 bg-red-500/5 border-b border-red-500/10">
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {/* Store error */}
      {storeError && !storeLoading && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-red-400 bg-red-500/5 border-b border-red-500/10">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="truncate">{storeError}</span>
        </div>
      )}

      {/* Installing indicator */}
      {installingFromStore && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-accent bg-accent/5 border-b border-accent/10">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span className="truncate">Installing…</span>
        </div>
      )}

      {/* Updating indicator */}
      {updatingFromStore && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-orange-400 bg-orange-500/5 border-b border-orange-500/10">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span className="truncate">Updating…</span>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-auto">
        {storeLoading && filtered.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
          </div>
        )}

        {!storeLoading && filtered.length === 0 && storeItems.length > 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Filter className="mb-2 h-5 w-5 opacity-20" />
            <p className="text-[10px]">No matching extensions</p>
          </div>
        )}

        {!storeLoading && storeItems.length === 0 && !storeError && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Store className="mb-3 h-8 w-8 opacity-20" />
            <p className="text-[11px] font-medium">Store unavailable</p>
            <p className="mt-1 text-[10px] text-muted-foreground/60 text-center px-4">
              Could not load extensions from the store.
            </p>
            <button
              onClick={() => void fetchStoreItems()}
              className="mt-3 flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        {filtered.map((item) => (
          <StoreRow
            key={item.sha}
            item={item}
            isInstalled={installedNames.has(item.name)}
            isInstalling={installingFromStore === item.name}
            hasUpdate={storeUpdateNames.has(item.name)}
            isUpdating={updatingFromStore === item.name}
            onInstall={() => void installFromStore(item)}
            onUpdate={() => void updateExtensionFromStore(item)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main View ────────────────────────────────────────────────────────────────

export function ExtensionsView() {
  const extensions = useExtensionStore((s) => s.extensions);
  const loading = useExtensionStore((s) => s.loading);
  const installing = useExtensionStore((s) => s.installing);
  const installingFromGit = useExtensionStore((s) => s.installingFromGit);
  const checkingUpdates = useExtensionStore((s) => s.checkingUpdates);
  const error = useExtensionStore((s) => s.error);
  const searchQuery = useExtensionStore((s) => s.searchQuery);
  const filter = useExtensionStore((s) => s.filter);
  const selectedExtension = useExtensionStore((s) => s.selectedExtension);
  const loadExtensions = useExtensionStore((s) => s.loadExtensions);
  const installFromFolder = useExtensionStore((s) => s.installFromFolder);
  const installFromZip = useExtensionStore((s) => s.installFromZip);
  const installFromGit = useExtensionStore((s) => s.installFromGit);
  const setSearchQuery = useExtensionStore((s) => s.setSearchQuery);
  const setFilter = useExtensionStore((s) => s.setFilter);
  const selectExtension = useExtensionStore((s) => s.selectExtension);
  const getFiltered = useExtensionStore((s) => s.getFiltered);
  const getStoreUpdates = useExtensionStore((s) => s.getStoreUpdates);
  const fetchStoreItems = useExtensionStore((s) => s.fetchStoreItems);

  const storeUpdateNames = new Set(getStoreUpdates());

  const [viewMode, setViewMode] = useState<'installed' | 'store'>('installed');
  const [showGitForm, setShowGitForm] = useState(false);
  const [gitUrl, setGitUrl] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [showBranchField, setShowBranchField] = useState(false);

  useEffect(() => {
    loadExtensions();
    // Fetch store items on mount so update badges work on the installed tab
    // even before the user has opened the store tab.
    void fetchStoreItems();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInstallFolder = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, title: 'Select Extension Folder' });
      if (selected && typeof selected === 'string') {
        await installFromFolder(selected);
      }
    } catch {
      // user cancelled
    }
  }, [installFromFolder]);

  const handleInstallZip = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        title: 'Install Extension from .zip / .rar',
        filters: [{ name: 'Extension Package', extensions: ['zip', 'rar'] }],
      });
      if (selected && typeof selected === 'string') {
        await installFromZip(selected);
      }
    } catch {
      // user cancelled
    }
  }, [installFromZip]);

  const handleInstallGit = useCallback(async () => {
    const url = gitUrl.trim();
    if (!url) return;
    await installFromGit(url, gitBranch.trim() || undefined);
    setGitUrl('');
    setGitBranch('');
    setShowGitForm(false);
    setShowBranchField(false);
  }, [gitUrl, gitBranch, installFromGit]);

  // If an extension is selected, show detail
  const selectedExt = selectedExtension
    ? extensions.find((e) => e.name === selectedExtension)
    : null;

  if (selectedExt) {
    return (
      <ExtensionDetail ext={selectedExt} onBack={() => selectExtension(null)} />
    );
  }

  const filtered = getFiltered();
  const enabledCount = extensions.filter((e) => e.enabled).length;

  const filterCounts: Record<ExtensionFilter, number> = {
    all: extensions.length,
    enabled: enabledCount,
    disabled: extensions.filter((e) => !e.enabled).length,
    themes: extensions.filter(
      (e) =>
        e.categories?.some((c) => c.toLowerCase().includes('theme')) ||
        e.manifest?.contributes?.themes?.length,
    ).length,
    languages: extensions.filter(
      (e) =>
        e.categories?.some((c) => c.toLowerCase().includes('language')) ||
        e.manifest?.contributes?.languages?.length ||
        e.manifest?.contributes?.languageServers?.length,
    ).length,
  };

  return (
    <div className="flex h-full flex-col">
      {/* View Mode Tabs: Installed / Store */}
      <div className="flex items-center border-b border-border px-2 pt-1">
        <button
          onClick={() => setViewMode('installed')}
          className={`flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium border-b-2 -mb-px transition-colors ${
            viewMode === 'installed'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground/60 hover:text-muted-foreground'
          }`}
        >
          <Blocks className="h-3 w-3" />
          Installed
          {extensions.length > 0 && (
            <span className={`rounded-full px-1 py-px text-[8px] ${
              viewMode === 'installed' ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground/60'
            }`}>
              {extensions.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setViewMode('store')}
          className={`flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium border-b-2 -mb-px transition-colors ${
            viewMode === 'store'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground/60 hover:text-muted-foreground'
          }`}
        >
          <Store className="h-3 w-3" />
          Store
        </button>
      </div>

      {/* Store View */}
      {viewMode === 'store' && <StoreView />}

      {/* Installed View */}
      {viewMode === 'installed' && (
        <>
      <div className="px-2 pt-1 pb-1">
        <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search extensions..."
            className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-0.5 px-2 pb-1 overflow-x-auto">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium transition-colors whitespace-nowrap ${
              filter === opt.value
                ? 'bg-accent/10 text-accent'
                : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {opt.label}
            <TabBadge
              count={filterCounts[opt.value]}
              showZero
            />
          </button>
        ))}
      </div>

      {/* Actions Bar */}
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[9px] text-muted-foreground/60">
          {enabledCount}/{extensions.length} active
          {filtered.length !== extensions.length && ` · ${filtered.length} shown`}
          {checkingUpdates && <span className="ml-1 text-muted-foreground/40">· checking…</span>}
        </span>
        <div className="flex gap-0.5">
          <button
            onClick={() => loadExtensions()}
            className="rounded p-0.5 text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => { setShowGitForm((v) => !v); }}
            className={`rounded p-0.5 transition-colors ${
              showGitForm
                ? 'text-accent bg-accent/10'
                : 'text-muted-foreground/50 hover:text-foreground hover:bg-muted'
            }`}
            title="Install from Git repository"
          >
            <GitFork className="h-3 w-3" />
          </button>
          <button
            onClick={handleInstallZip}
            className="rounded p-0.5 text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
            title="Install from .zip / .rar"
          >
            <FileArchive className="h-3 w-3" />
          </button>
          <button
            onClick={handleInstallFolder}
            className="rounded p-0.5 text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
            title="Install from folder"
          >
            <FolderOpen className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Git Install Form */}
      {showGitForm && (
        <div className="border-b border-border bg-muted/20 px-2 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
            <GitFork className="h-3 w-3 shrink-0 text-muted-foreground/50" />
            <input
              type="url"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleInstallGit(); }}
              placeholder="https://github.com/user/extension"
              className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none"
              autoFocus
            />
          </div>
          {showBranchField && (
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
              <span className="text-[9px] text-muted-foreground/50 shrink-0">branch</span>
              <input
                type="text"
                value={gitBranch}
                onChange={(e) => setGitBranch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleInstallGit(); }}
                placeholder="main"
                className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/30 outline-none"
              />
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowBranchField((v) => !v)}
              className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              {showBranchField ? 'Hide branch' : 'Specify branch'}
            </button>
            <div className="flex gap-1">
              <button
                onClick={() => { setShowGitForm(false); setGitUrl(''); setGitBranch(''); setShowBranchField(false); }}
                className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleInstallGit()}
                disabled={!gitUrl.trim() || installingFromGit}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {installingFromGit ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <GitFork className="h-2.5 w-2.5" />}
                Install
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-red-400 bg-red-500/5 border-b border-red-500/10">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Installing indicator */}
      {(installing || installingFromGit) && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-accent bg-accent/5 border-b border-accent/10">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span>{installingFromGit ? 'Cloning and installing from git…' : 'Installing extension...'}</span>
        </div>
      )}

      {/* Extensions List */}
      <div className="flex-1 overflow-auto">
        {filtered.map((ext) => (
          <ExtensionRow
            key={ext.name}
            ext={ext}
            storeUpdateNames={storeUpdateNames}
            onSelect={() => selectExtension(ext.name)}
          />
        ))}

        {filtered.length === 0 && !loading && extensions.length > 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Filter className="mb-2 h-5 w-5 opacity-20" />
            <p className="text-[10px]">No matching extensions</p>
          </div>
        )}

        {extensions.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Blocks className="mb-3 h-8 w-8 opacity-20" />
            <p className="text-[11px] font-medium">No extensions installed</p>
            <p className="mt-1 text-[10px] text-muted-foreground/60 text-center px-4">
              Install extensions from a git repository, .zip / .rar archive, or folder.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => setShowGitForm(true)}
                className="flex items-center gap-1.5 rounded-md bg-accent/10 px-3 py-1.5 text-[10px] font-medium text-accent hover:bg-accent/20 transition-colors"
              >
                <GitFork className="h-3 w-3" />
                From Git
              </button>
              <button
                onClick={handleInstallZip}
                className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
              >
                <FileArchive className="h-3 w-3" />
                Install .zip / .rar
              </button>
              <button
                onClick={handleInstallFolder}
                className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
              >
                <FolderOpen className="h-3 w-3" />
                Open Folder
              </button>
            </div>
          </div>
        )}

        {loading && extensions.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

import { X, PackageOpen } from 'lucide-react';
import { useLspStore } from '../../stores/lsp-store';
import { useSettingsStore } from '../../stores/settings-store';
import { getBuiltinServerForLanguage, detectLspLanguage } from '@hyscode/lsp-client';
import type { BuiltinServerConfig } from '@hyscode/lsp-client';
import { useEditorStore } from '../../stores';

/**
 * Picks the most relevant install instruction from a server config.
 * Priority: winget > choco > brew > npm > pip > gem > go > the first entry.
 */
function pickInstallHint(server: BuiltinServerConfig): { manager: string; command: string } | null {
  const priority = ['winget', 'choco', 'scoop', 'brew', 'npm', 'pnpm', 'pip', 'gem', 'go', 'dotnet', 'apt'];
  for (const mgr of priority) {
    if (server.installInstructions[mgr]) {
      return { manager: mgr, command: server.installInstructions[mgr] };
    }
  }
  const entries = Object.entries(server.installInstructions);
  if (entries.length > 0) {
    return { manager: entries[0][0], command: entries[0][1] };
  }
  return null;
}

export function LspMissingBanner() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const probeResults = useLspStore((s) => s.probeResults);
  const probeComplete = useLspStore((s) => s.probeComplete);
  const disabledServers = useLspStore((s) => s.disabledServers);
  const dismissedLspNotifications = useLspStore((s) => s.dismissedLspNotifications);
  const dismissLspNotification = useLspStore((s) => s.dismissLspNotification);
  const openSettingsOnTab = useSettingsStore((s) => s.openSettingsOnTab);

  // Only show after probes are done
  if (!probeComplete) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || activeTab.type !== 'file') return null;

  const languageId = detectLspLanguage(activeTab.filePath);
  if (!languageId) return null;

  if (dismissedLspNotifications.has(languageId)) return null;

  const server = getBuiltinServerForLanguage(languageId);
  if (!server) return null;

  // Server is user-disabled — don't nag
  if (disabledServers.has(server.id)) return null;

  const command = server.command.split(' ')[0];
  // false means probed and not found; undefined means not yet probed
  if (probeResults[command] !== false) return null;

  const hint = pickInstallHint(server);

  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
      <PackageOpen className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
      <span className="text-[11px] text-foreground">
        <span className="font-medium">{server.displayName}</span>
        {' '}not found — install it to enable IntelliSense for{' '}
        <span className="font-medium">{languageId}</span>
      </span>
      {hint && (
        <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground select-text">
          {hint.command}
        </code>
      )}
      <button
        onClick={() => openSettingsOnTab('languages')}
        className="ml-1 rounded-md bg-accent px-2.5 py-0.5 text-[10px] font-medium text-accent-foreground hover:bg-accent/90 transition-colors"
      >
        Open Settings
      </button>
      <button
        onClick={() => dismissLspNotification(languageId)}
        className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

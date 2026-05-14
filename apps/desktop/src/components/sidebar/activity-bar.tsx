import { Files, Search, GitBranch, Settings, Bot, Puzzle, Blocks, Smartphone, Container, CheckSquare, FolderKanban, LayoutList, BrainCircuit, type LucideIcon } from 'lucide-react';
import { useSettingsStore } from '../../stores';
import { useGitStore } from '../../stores/git-store';
import { useDockerStore } from '../../stores/docker-store';
import { useAgentStore } from '../../stores/agent-store';
import { useExtensionStore } from '../../stores/extension-store';
import { useViewRegistryStore } from '../../stores/view-registry-store';
import type { SidebarView, BuiltinSidebarView } from './sidebar';

const ICON_MAP: Record<string, LucideIcon> = {
  '$(checklist)': CheckSquare,
  '$(folder-library)': FolderKanban,
  '$(list-tree)': LayoutList,
};

const builtinItems: { id: BuiltinSidebarView; icon: LucideIcon; label: string }[] = [
  { id: 'files', icon: Files, label: 'Explorer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'git', icon: GitBranch, label: 'Source Control' },
  { id: 'skills', icon: Puzzle, label: 'Skills' },
  { id: 'extensions', icon: Blocks, label: 'Extensions' },
  { id: 'agent', icon: Bot, label: 'Agent' },
  { id: 'memories', icon: BrainCircuit, label: 'Memories' },
  { id: 'devices', icon: Smartphone, label: 'Devices' },
  { id: 'docker', icon: Container, label: 'Docker' },
];

interface ActivityBarProps {
  active: SidebarView;
  onSelect: (view: SidebarView) => void;
}

function ActivityBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums leading-none bg-accent text-accent-foreground"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function ActivityBar({ active, onSelect }: ActivityBarProps) {
  const openSettings = useSettingsStore((s) => s.openSettings);
  const visibleSidebarTabs = useSettingsStore((s) => s.visibleSidebarTabs);
  const visibleExtensionViews = useSettingsStore((s) => s.visibleExtensionViews);
  const extensionViews = useExtensionStore((s) => s.contributions.views);
  const viewBadges = useViewRegistryStore((s) => s.badges);

  const gitCount = useGitStore(
    (s) => s.staged.length + s.unstaged.length + s.untracked.length + s.conflicts.length,
  );
  const runningContainers = useDockerStore(
    (s) => s.containers.filter((c) => c.state.toLowerCase() === 'running').length,
  );
  const pendingAgentSessions = useAgentStore(
    (s) => s.agentEditSessions.filter(
      (es) => es.phase === 'streaming' || es.phase === 'pending_review',
    ).length,
  );
  const disabledExtensions = useExtensionStore(
    (s) => s.extensions.filter((e) => !e.enabled).length,
  );

  const badges: Partial<Record<string, number>> = {
    git:        gitCount,
    docker:     runningContainers,
    agent:      pendingAgentSessions,
    extensions: disabledExtensions,
  };

  // Build dynamic items from extension-contributed views
  const dynamicItems: { id: string; icon: LucideIcon; label: string }[] = extensionViews
    .filter((v) => visibleExtensionViews[v.id] !== false)
    .map((v) => ({
      id: v.id,
      icon: (v.icon && ICON_MAP[v.icon]) || LayoutList,
      label: v.name,
    }));

  return (
    <div className="flex w-11 flex-col items-center gap-1 bg-sidebar py-2">
      {builtinItems.filter((item) => visibleSidebarTabs[item.id]).map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        const badge = badges[item.id];
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`relative flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
              isActive
                ? 'bg-surface-raised text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised/50'
            }`}
            title={item.label}
          >
            <Icon className="h-[18px] w-[18px]" />
            {badge !== undefined && <ActivityBadge count={badge} />}
          </button>
        );
      })}

      {/* Extension-contributed views */}
      {dynamicItems.length > 0 && (
        <div className="mx-auto my-1 h-px w-5 bg-border" />
      )}
      {dynamicItems.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        const viewBadge = viewBadges[item.id];
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`relative flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
              isActive
                ? 'bg-surface-raised text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised/50'
            }`}
            title={viewBadge?.tooltip || item.label}
          >
            <Icon className="h-[18px] w-[18px]" />
            {viewBadge && <ActivityBadge count={viewBadge.count} />}
          </button>
        );
      })}

      <div className="mt-auto">
        <button
          onClick={openSettings}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-raised/50 transition-colors"
          title="Settings"
        >
          <Settings className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}

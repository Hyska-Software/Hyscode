import type { SidebarView } from './sidebar';
import { isBuiltinView } from './sidebar';
import {
  FileExplorerView,
  SearchView,
  GitView,
  SkillsView,
  ExtensionsView,
  AgentSidebarView,
  DevicesView,
  DockerView,
  MemoriesView,
} from './views';
import { TasksView } from './views/tasks-view';
import { ExtensionViewPanel } from './views/extension-view-panel';

interface SidebarContentProps {
  view: SidebarView;
}

export function SidebarContent({ view }: SidebarContentProps) {
  if (!isBuiltinView(view)) {
    return <ExtensionViewPanel viewId={view} />;
  }

  switch (view) {
    case 'files':
      return <FileExplorerView />;
    case 'search':
      return <SearchView />;
    case 'git':
      return <GitView />;
    case 'skills':
      return <SkillsView />;
    case 'extensions':
      return <ExtensionsView />;
    case 'agent':
      return <AgentSidebarView />;
    case 'memories':
      return <MemoriesView />;
    case 'tasks':
      return <TasksView />;
    case 'devices':
      return <DevicesView />;
    case 'docker':
      return <DockerView />;
  }
}

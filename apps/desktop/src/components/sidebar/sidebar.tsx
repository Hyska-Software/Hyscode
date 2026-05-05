import { useEffect } from 'react';
import { ActivityBar } from './activity-bar';
import { SidebarContent } from './sidebar-content';
import { useExtensionStore } from '../../stores/extension-store';
import { useLayoutStore } from '../../stores/layout-store';
import { useSettingsStore } from '../../stores';

const builtinViewLabels: Record<BuiltinSidebarView, string> = {
  files: 'Explorer',
  search: 'Search',
  git: 'Source Control',
  skills: 'Skills',
  extensions: 'Extensions',
  agent: 'Agent',
  devices: 'Devices',
  docker: 'Docker',
};

export type BuiltinSidebarView = 'files' | 'search' | 'git' | 'skills' | 'extensions' | 'agent' | 'devices' | 'docker';
export type SidebarView = BuiltinSidebarView | (string & {});

export function isBuiltinView(view: string): view is BuiltinSidebarView {
  return view in builtinViewLabels;
}

export function Sidebar() {
  const activeView = useLayoutStore((s) => s.sidebarActiveView);
  const setActiveView = useLayoutStore((s) => s.setSidebarActiveView);
  const extensionViews = useExtensionStore((s) => s.contributions.views);
  const visibleSidebarTabs = useSettingsStore((s) => s.visibleSidebarTabs);

  // If active builtin view gets hidden, fall back to first visible one
  useEffect(() => {
    if (isBuiltinView(activeView) && !visibleSidebarTabs[activeView]) {
      const fallback = (Object.keys(visibleSidebarTabs) as BuiltinSidebarView[]).find(
        (id) => visibleSidebarTabs[id],
      );
      if (fallback) setActiveView(fallback);
    }
  }, [activeView, visibleSidebarTabs, setActiveView]);

  const getViewLabel = (view: SidebarView): string => {
    if (isBuiltinView(view)) return builtinViewLabels[view];
    const extView = extensionViews.find((v) => v.id === view);
    return extView?.name ?? view;
  };

  return (
    <div className="flex h-full">
      <ActivityBar active={activeView} onSelect={setActiveView} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-8 items-center px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {getViewLabel(activeView)}
        </div>
        <div className="flex-1 overflow-auto px-2">
          <SidebarContent view={activeView} />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo } from 'react';
import { ActivityBar } from './activity-bar';
import { SidebarContent } from './sidebar-content';
import { useExtensionStore } from '../../stores/extension-store';
import { useLayoutStore } from '../../stores/layout-store';
import { useSettingsStore } from '../../stores';
import type { SidebarViewId } from '../../stores/layout-store';
import {
  createSidebarViewDescriptors,
  getVisibleSidebarViewIds,
  isBuiltinSidebarViewId,
  orderSidebarViewDescriptors,
  resolveActiveSidebarView,
} from '../../lib/activity-bar-model';

export type BuiltinSidebarView = SidebarViewId;
export type SidebarView = BuiltinSidebarView | (string & {});

export function isBuiltinView(view: string): view is BuiltinSidebarView {
  return isBuiltinSidebarViewId(view);
}

export function Sidebar() {
  const activeView = useLayoutStore((s) => s.sidebarActiveView);
  const setActiveView = useLayoutStore((s) => s.setSidebarActiveView);
  const extensionViews = useExtensionStore((s) => s.contributions.views);
  const visibleSidebarTabs = useSettingsStore((s) => s.visibleSidebarTabs);
  const visibleExtensionViews = useSettingsStore((s) => s.visibleExtensionViews);
  const sidebarViewOrder = useSettingsStore((s) => s.sidebarViewOrder);
  const setSidebarViewVisible = useSettingsStore((s) => s.setSidebarViewVisible);
  const activityBarPosition = useSettingsStore((s) => s.activityBarPosition);
  const descriptors = useMemo(() => createSidebarViewDescriptors(extensionViews), [extensionViews]);
  const availableIds = useMemo(() => descriptors.map((descriptor) => descriptor.id), [descriptors]);
  const orderedDescriptors = useMemo(
    () => orderSidebarViewDescriptors(descriptors, sidebarViewOrder),
    [descriptors, sidebarViewOrder],
  );
  const visibleIds = useMemo(
    () =>
      getVisibleSidebarViewIds(sidebarViewOrder, availableIds, {
        builtin: visibleSidebarTabs,
        extension: visibleExtensionViews,
      }),
    [availableIds, sidebarViewOrder, visibleExtensionViews, visibleSidebarTabs],
  );

  // Keep one available view visible and ensure the active view remains valid.
  useEffect(() => {
    if (visibleIds.length === 0) {
      setSidebarViewVisible('files', true, availableIds);
      setActiveView('files');
      return;
    }
    const nextActiveView = resolveActiveSidebarView(activeView, visibleIds);
    if (nextActiveView && nextActiveView !== activeView) setActiveView(nextActiveView);
  }, [activeView, availableIds, setActiveView, setSidebarViewVisible, visibleIds]);

  const getViewLabel = (view: SidebarView): string => {
    return orderedDescriptors.find((descriptor) => descriptor.id === view)?.label ?? view;
  };

  const isTop = activityBarPosition === 'top';

  return (
    <div className={isTop ? 'flex h-full flex-col' : 'flex h-full'}>
      <ActivityBar
        orientation={isTop ? 'horizontal' : 'vertical'}
        active={activeView}
        onSelect={setActiveView}
      />
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

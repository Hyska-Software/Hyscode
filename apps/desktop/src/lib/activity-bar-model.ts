import type { SidebarViewId } from '../stores/layout-store';

export type SidebarViewDescriptor = {
  id: string;
  label: string;
  kind: 'builtin' | 'extension';
};

export type SidebarViewVisibility = {
  builtin: Record<SidebarViewId, boolean>;
  extension: Record<string, boolean>;
};

export type SidebarDropPosition = 'before' | 'after';

export const BUILTIN_SIDEBAR_VIEWS: readonly SidebarViewDescriptor[] = [
  { id: 'files', label: 'Explorer', kind: 'builtin' },
  { id: 'search', label: 'Search', kind: 'builtin' },
  { id: 'git', label: 'Source Control', kind: 'builtin' },
  { id: 'skills', label: 'Skills', kind: 'builtin' },
  { id: 'extensions', label: 'Extensions', kind: 'builtin' },
  { id: 'agent', label: 'Agent', kind: 'builtin' },
  { id: 'memories', label: 'Memories', kind: 'builtin' },
  { id: 'devices', label: 'Devices', kind: 'builtin' },
  { id: 'docker', label: 'Docker', kind: 'builtin' },
] as const;

export const DEFAULT_SIDEBAR_VIEW_ORDER = BUILTIN_SIDEBAR_VIEWS.map((view) => view.id);

const BUILTIN_VIEW_IDS = new Set<string>(DEFAULT_SIDEBAR_VIEW_ORDER);

export function isBuiltinSidebarViewId(id: string): id is SidebarViewId {
  return BUILTIN_VIEW_IDS.has(id);
}

export function createSidebarViewDescriptors(
  extensionViews: readonly { id: string; name: string }[],
): SidebarViewDescriptor[] {
  const descriptors = [...BUILTIN_SIDEBAR_VIEWS];
  const seen = new Set(descriptors.map((view) => view.id));

  for (const view of extensionViews) {
    if (!view.id || seen.has(view.id)) continue;
    seen.add(view.id);
    descriptors.push({ id: view.id, label: view.name, kind: 'extension' });
  }

  return descriptors;
}

export function normalizeSidebarViewOrder(
  storedOrder: readonly unknown[] | undefined,
  availableIds: readonly string[],
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();

  for (const id of storedOrder ?? []) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }

  for (const id of DEFAULT_SIDEBAR_VIEW_ORDER) {
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }

  for (const id of availableIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }

  return order;
}

export function createDefaultSidebarViewOrder(availableIds: readonly string[]): string[] {
  const extensionIds = availableIds.filter((id) => !isBuiltinSidebarViewId(id));
  return normalizeSidebarViewOrder(DEFAULT_SIDEBAR_VIEW_ORDER, extensionIds);
}

export function orderSidebarViewDescriptors(
  descriptors: readonly SidebarViewDescriptor[],
  storedOrder: readonly unknown[] | undefined,
): SidebarViewDescriptor[] {
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const order = normalizeSidebarViewOrder(
    storedOrder,
    descriptors.map((descriptor) => descriptor.id),
  );

  return order
    .map((id) => byId.get(id))
    .filter((descriptor): descriptor is SidebarViewDescriptor => descriptor !== undefined);
}

export function isSidebarViewVisible(id: string, visibility: SidebarViewVisibility): boolean {
  return isBuiltinSidebarViewId(id)
    ? visibility.builtin[id] !== false
    : visibility.extension[id] !== false;
}

export function getVisibleSidebarViewIds(
  order: readonly string[],
  availableIds: readonly string[],
  visibility: SidebarViewVisibility,
): string[] {
  const available = new Set(availableIds);
  return normalizeSidebarViewOrder(order, availableIds).filter(
    (id) => available.has(id) && isSidebarViewVisible(id, visibility),
  );
}

export function resolveActiveSidebarView(
  activeId: string,
  visibleIds: readonly string[],
): string | null {
  if (visibleIds.includes(activeId)) return activeId;
  return visibleIds[0] ?? null;
}

export function canHideSidebarView(
  id: string,
  order: readonly string[],
  availableIds: readonly string[],
  visibility: SidebarViewVisibility,
): boolean {
  if (!isSidebarViewVisible(id, visibility)) return true;
  return getVisibleSidebarViewIds(order, availableIds, visibility).length > 1;
}

export function moveSidebarView(
  order: readonly string[],
  draggedId: string,
  targetId: string,
  position: SidebarDropPosition,
  availableIds: readonly string[],
): string[] {
  const normalized = normalizeSidebarViewOrder(order, availableIds);
  if (draggedId === targetId || !normalized.includes(draggedId) || !normalized.includes(targetId)) {
    return normalized;
  }

  const next = normalized.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  const insertionIndex = position === 'after' ? targetIndex + 1 : targetIndex;
  next.splice(insertionIndex, 0, draggedId);
  return next;
}

export function getSidebarDropPosition(
  pointerCoordinate: number,
  targetStart: number,
  targetLength: number,
): SidebarDropPosition {
  return pointerCoordinate < targetStart + targetLength / 2 ? 'before' : 'after';
}

export function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

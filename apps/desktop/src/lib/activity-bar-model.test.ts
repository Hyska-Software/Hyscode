import { describe, expect, it } from 'vitest';
import type { SidebarViewId } from '../stores/layout-store';
import {
  DEFAULT_SIDEBAR_VIEW_ORDER,
  canHideSidebarView,
  createDefaultSidebarViewOrder,
  createSidebarViewDescriptors,
  getSidebarDropPosition,
  getVisibleSidebarViewIds,
  moveSidebarView,
  normalizeSidebarViewOrder,
  orderSidebarViewDescriptors,
  resolveActiveSidebarView,
  type SidebarViewVisibility,
} from './activity-bar-model';

const allBuiltinVisible = Object.fromEntries(
  DEFAULT_SIDEBAR_VIEW_ORDER.map((id) => [id, true]),
) as Record<SidebarViewId, boolean>;

function visibility(
  builtin: Partial<Record<SidebarViewId, boolean>> = {},
  extension: Record<string, boolean> = {},
): SidebarViewVisibility {
  return {
    builtin: { ...allBuiltinVisible, ...builtin },
    extension,
  };
}

describe('activity bar model', () => {
  it('migrates a missing stored order to builtins followed by available extensions', () => {
    expect(normalizeSidebarViewOrder(undefined, ['files', 'todo.panel', 'git.panel'])).toEqual([
      ...DEFAULT_SIDEBAR_VIEW_ORDER,
      'todo.panel',
      'git.panel',
    ]);
  });

  it('deduplicates invalid persisted entries and restores missing builtins', () => {
    expect(
      normalizeSidebarViewOrder(
        ['git', '', 'git', 42, 'custom.panel', null, 'files'],
        ['custom.panel'],
      ),
    ).toEqual([
      'git',
      'custom.panel',
      'files',
      'search',
      'skills',
      'extensions',
      'agent',
      'memories',
      'tasks',
      'devices',
      'docker',
    ]);
  });

  it('preserves unavailable extension ids and restores their position when they return', () => {
    const stored = ['files', 'todo.panel', 'search', ...DEFAULT_SIDEBAR_VIEW_ORDER.slice(2)];
    const unavailable = orderSidebarViewDescriptors(createSidebarViewDescriptors([]), stored).map(
      (view) => view.id,
    );
    const restored = orderSidebarViewDescriptors(
      createSidebarViewDescriptors([{ id: 'todo.panel', name: 'TODO Tree' }]),
      stored,
    ).map((view) => view.id);

    expect(unavailable).not.toContain('todo.panel');
    expect(restored.slice(0, 3)).toEqual(['files', 'todo.panel', 'search']);
  });

  it('appends new extensions and ignores ids that collide with builtins or other extensions', () => {
    const descriptors = createSidebarViewDescriptors([
      { id: 'files', name: 'Conflicting Explorer' },
      { id: 'first.panel', name: 'First' },
      { id: 'first.panel', name: 'Duplicate' },
      { id: 'second.panel', name: 'Second' },
    ]);

    expect(descriptors.filter((view) => view.id === 'files')).toHaveLength(1);
    expect(descriptors.slice(-2).map((view) => view.id)).toEqual(['first.panel', 'second.panel']);
  });

  it('reorders native and extension views across groups', () => {
    const available = [...DEFAULT_SIDEBAR_VIEW_ORDER, 'todo.panel'];
    const moved = moveSidebarView(available, 'todo.panel', 'search', 'before', available);

    expect(moved.slice(0, 3)).toEqual(['files', 'todo.panel', 'search']);
  });

  it('preserves hidden and unavailable entries while reordering visible views', () => {
    const stored = ['files', 'hidden.panel', 'search', 'stale.panel', 'git'];
    const moved = moveSidebarView(stored, 'git', 'files', 'before', [
      'files',
      'search',
      'git',
      'hidden.panel',
    ]);

    expect(moved.slice(0, 6)).toEqual([
      'git',
      'files',
      'hidden.panel',
      'search',
      'stale.panel',
      'skills',
    ]);
  });

  it('calculates insertion before or after the target midpoint for either axis', () => {
    expect(getSidebarDropPosition(109, 100, 20)).toBe('before');
    expect(getSidebarDropPosition(110, 100, 20)).toBe('after');
    expect(getSidebarDropPosition(299, 200, 200)).toBe('before');
    expect(getSidebarDropPosition(301, 200, 200)).toBe('after');
  });

  it('blocks hiding the final visible view but allows showing hidden views', () => {
    const available = ['files', 'todo.panel'];
    const currentVisibility = visibility(
      {
        search: false,
        git: false,
        skills: false,
        extensions: false,
        agent: false,
        memories: false,
        devices: false,
        docker: false,
      },
      { 'todo.panel': false },
    );

    expect(canHideSidebarView('files', available, available, currentVisibility)).toBe(false);
    expect(canHideSidebarView('todo.panel', available, available, currentVisibility)).toBe(true);
  });

  it('selects visible ids according to persisted order', () => {
    const available = ['files', 'search', 'todo.panel'];
    const currentVisibility = visibility({ files: false }, { 'todo.panel': true });

    expect(
      getVisibleSidebarViewIds(['todo.panel', 'files', 'search'], available, currentVisibility),
    ).toEqual(['todo.panel', 'search']);
  });

  it('keeps a valid active view and falls back to the first ordered visible view', () => {
    expect(resolveActiveSidebarView('search', ['todo.panel', 'search'])).toBe('search');
    expect(resolveActiveSidebarView('files', ['todo.panel', 'search'])).toBe('todo.panel');
    expect(resolveActiveSidebarView('files', [])).toBeNull();
  });

  it('restores builtin order and all currently available extensions', () => {
    expect(createDefaultSidebarViewOrder(['git', 'second.panel', 'files', 'first.panel'])).toEqual([
      ...DEFAULT_SIDEBAR_VIEW_ORDER,
      'second.panel',
      'first.panel',
    ]);
  });
});

/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RIGHT_TAB_ORDER,
  DEFAULT_RIGHT_TAB_VISIBILITY,
  DEFAULT_TERMINAL_LAYOUT_PREFS,
  agentRightTabProjectKey,
  normalizeAgentRightTabPrefs,
  resolveTerminalLayoutPrefs,
  type AgentRightTabPrefs,
  type RightTab,
} from './layout-store';
import { useLayoutStore } from './layout-store';
import { useProjectStore } from './project-store';

beforeEach(() => {
  useProjectStore.setState({ rootPath: 'C:/layout-store-test' });
  useLayoutStore.setState({
    agentRightTab: 'changes',
    agentRightTabPrefs: {},
    terminalLocation: 'bottom',
    terminalVisible: true,
    sidebarActiveTab: 'chat',
    terminalLayoutPrefs: {},
  });
});

afterEach(() => {
  useProjectStore.setState({ rootPath: null });
  useLayoutStore.setState({
    agentRightTab: 'changes',
    agentRightTabPrefs: {},
    terminalLocation: 'bottom',
    terminalVisible: true,
    sidebarActiveTab: 'chat',
    terminalLayoutPrefs: {},
  });
});

describe('agent right tab preferences', () => {
  it('adds Context hidden by default for new and legacy preferences', () => {
    const defaults = normalizeAgentRightTabPrefs(undefined);
    expect(defaults.order).toEqual(DEFAULT_RIGHT_TAB_ORDER);
    expect(defaults.visible.context).toBe(false);

    const legacy = normalizeAgentRightTabPrefs({
      order: ['terminal', 'changes'],
      visible: {
        ...DEFAULT_RIGHT_TAB_VISIBILITY,
        terminal: true,
        changes: true,
      },
    } as AgentRightTabPrefs);

    expect(legacy.order).toEqual(['terminal', 'changes', 'context', 'files', 'preview']);
    expect(legacy.visible.context).toBe(false);
  });

  it('preserves an explicit Context order and visibility choice', () => {
    const prefs = normalizeAgentRightTabPrefs({
      order: ['context', 'files', 'changes', 'preview', 'terminal'],
      visible: { ...DEFAULT_RIGHT_TAB_VISIBILITY, context: true },
    });

    expect(prefs.order[0]).toBe('context');
    expect(prefs.visible.context).toBe(true);
    expect(prefs.order.every((tab) => DEFAULT_RIGHT_TAB_ORDER.includes(tab as RightTab))).toBe(true);
  });

  it('opens a hidden tab and makes it the active tab', () => {
    const store = useLayoutStore.getState();

    store.openAgentRightTab('context');

    const prefs = useLayoutStore.getState().agentRightTabPrefs[agentRightTabProjectKey('C:/layout-store-test')];
    expect(useLayoutStore.getState().agentRightTab).toBe('context');
    expect(prefs.visible.context).toBe(true);
  });

  it('closes the active tab using a visible fallback, then exposes the empty state', () => {
    const store = useLayoutStore.getState();
    store.closeAgentRightTab('terminal');
    store.openAgentRightTab('changes');
    store.openAgentRightTab('files');
    store.openAgentRightTab('preview');

    store.closeAgentRightTab('preview');
    expect(useLayoutStore.getState().agentRightTab).toBe('files');

    store.closeAgentRightTab('files');
    expect(useLayoutStore.getState().agentRightTab).toBe('changes');

    store.closeAgentRightTab('changes');
    expect(useLayoutStore.getState().agentRightTab).toBeNull();

    const prefs = useLayoutStore.getState().agentRightTabPrefs[agentRightTabProjectKey('C:/layout-store-test')];
    expect(prefs.visible.changes).toBe(false);
    expect(prefs.visible.files).toBe(false);
    expect(prefs.visible.preview).toBe(false);
  });

  it('keeps right-tab visibility isolated by project', () => {
    const store = useLayoutStore.getState();
    store.closeAgentRightTab('changes');

    useProjectStore.setState({ rootPath: 'C:/another-project' });
    const otherProjectPrefs = normalizeAgentRightTabPrefs(
      useLayoutStore.getState().agentRightTabPrefs[agentRightTabProjectKey('C:/another-project')],
    );
    expect(otherProjectPrefs.visible.changes).toBe(true);

    useProjectStore.setState({ rootPath: 'C:/layout-store-test' });
    const originalProjectPrefs = useLayoutStore.getState().agentRightTabPrefs[agentRightTabProjectKey('C:/layout-store-test')];
    expect(originalProjectPrefs.visible.changes).toBe(false);
  });

  it('reopens Preview and Changes when external actions target them', () => {
    const store = useLayoutStore.getState();
    store.closeAgentRightTab('preview');
    store.closeAgentRightTab('changes');

    store.setAgentPreviewFile('C:/layout-store-test/README.md');
    expect(useLayoutStore.getState().agentRightTab).toBe('preview');

    store.setAgentSelectedChangeFile('src/app.ts');
    expect(useLayoutStore.getState().agentRightTab).toBe('changes');
  });
});

describe('terminal layout preferences', () => {
  it('resolves defaults for projects without stored preferences', () => {
    expect(resolveTerminalLayoutPrefs(undefined, 'C:/unknown-project')).toEqual(
      DEFAULT_TERMINAL_LAYOUT_PREFS,
    );
    expect(
      resolveTerminalLayoutPrefs(useLayoutStore.getState().terminalLayoutPrefs, null),
    ).toEqual(DEFAULT_TERMINAL_LAYOUT_PREFS);
  });

  it('persists docking, visibility, tab and sizes per project', () => {
    const store = useLayoutStore.getState();
    store.moveTerminalToSidebar();
    store.setTerminalLayoutPrefs({ bottomPanelSize: 42, rightPanelSize: 38 });

    const stored = useLayoutStore.getState().terminalLayoutPrefs[
      agentRightTabProjectKey('C:/layout-store-test')
    ];
    expect(stored).toMatchObject({
      location: 'sidebar',
      visible: true,
      sidebarActiveTab: 'terminal',
      bottomPanelSize: 42,
      rightPanelSize: 38,
    });

    useProjectStore.setState({ rootPath: 'C:/another-project' });
    const otherPrefs = resolveTerminalLayoutPrefs(
      useLayoutStore.getState().terminalLayoutPrefs,
      'C:/another-project',
    );
    expect(otherPrefs).toEqual(DEFAULT_TERMINAL_LAYOUT_PREFS);
  });

  it('persists visibility toggles performed through existing actions', () => {
    const store = useLayoutStore.getState();
    store.toggleTerminal();
    expect(
      useLayoutStore.getState().terminalLayoutPrefs[agentRightTabProjectKey('C:/layout-store-test')]
        ?.visible,
    ).toBe(false);

    store.setTerminalVisible(true);
    expect(
      useLayoutStore.getState().terminalLayoutPrefs[agentRightTabProjectKey('C:/layout-store-test')]
        ?.visible,
    ).toBe(true);
  });

  it('restores a stored layout and falls back to the previous visibility', () => {
    const store = useLayoutStore.getState();
    store.setTerminalLayoutPrefs({ bottomPanelSize: 48 });
    store.moveTerminalToSidebar();

    useProjectStore.setState({ rootPath: 'C:/another-project' });
    store.applyTerminalLayoutState({
      location: 'bottom',
      visible: false,
      sidebarActiveTab: 'chat',
    });

    store.restoreTerminalLayout('C:/another-project', false);
    expect(useLayoutStore.getState().terminalLocation).toBe('bottom');
    expect(useLayoutStore.getState().terminalVisible).toBe(false);

    store.restoreTerminalLayout('C:/layout-store-test', false);
    expect(useLayoutStore.getState().terminalLocation).toBe('sidebar');
    expect(useLayoutStore.getState().terminalVisible).toBe(true);
    expect(useLayoutStore.getState().sidebarActiveTab).toBe('terminal');
    expect(
      resolveTerminalLayoutPrefs(
        useLayoutStore.getState().terminalLayoutPrefs,
        'C:/layout-store-test',
      ).bottomPanelSize,
    ).toBe(48);
  });

  it('uses the fallback visibility for projects with no record', () => {
    useLayoutStore.getState().restoreTerminalLayout('C:/never-opened', false);
    expect(useLayoutStore.getState().terminalVisible).toBe(false);
    expect(useLayoutStore.getState().terminalLocation).toBe('bottom');
    expect(useLayoutStore.getState().sidebarActiveTab).toBe('chat');
  });
});

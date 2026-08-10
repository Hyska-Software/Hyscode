/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RIGHT_TAB_ORDER,
  DEFAULT_RIGHT_TAB_VISIBILITY,
  agentRightTabProjectKey,
  normalizeAgentRightTabPrefs,
  type AgentRightTabPrefs,
  type RightTab,
} from './layout-store';
import { useLayoutStore } from './layout-store';
import { useProjectStore } from './project-store';

beforeEach(() => {
  useProjectStore.setState({ rootPath: 'C:/layout-store-test' });
  useLayoutStore.setState({ agentRightTab: 'changes', agentRightTabPrefs: {} });
});

afterEach(() => {
  useProjectStore.setState({ rootPath: null });
  useLayoutStore.setState({ agentRightTab: 'changes', agentRightTabPrefs: {} });
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

/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DEFAULT_RIGHT_TAB_ORDER,
  DEFAULT_RIGHT_TAB_VISIBILITY,
  normalizeAgentRightTabPrefs,
  useLayoutStore,
} from '@/stores/layout-store';
import { useProjectStore } from '@/stores/project-store';
import { RightTabContextMenu } from './right-tab-context-menu';

beforeEach(() => {
  useProjectStore.setState({ rootPath: 'C:/right-tab-menu-test' });
  useLayoutStore.setState({ agentRightTab: 'changes', agentRightTabPrefs: {} });
});

afterEach(() => {
  cleanup();
  useProjectStore.setState({ rootPath: null });
  useLayoutStore.setState({ agentRightTab: 'changes', agentRightTabPrefs: {} });
});

describe('RightTabContextMenu', () => {
  it('allows closing the final visible surface', () => {
    const onClose = vi.fn();
    render(
      <RightTabContextMenu
        x={0}
        y={0}
        order={DEFAULT_RIGHT_TAB_ORDER}
        visible={DEFAULT_RIGHT_TAB_VISIBILITY}
        onClose={onClose}
      />,
    );

    const store = useLayoutStore.getState();
    store.closeAgentRightTab('files');
    store.closeAgentRightTab('preview');
    store.closeAgentRightTab('terminal');

    fireEvent.click(screen.getByRole('button', { name: 'Changes' }));

    expect(useLayoutStore.getState().agentRightTab).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens a hidden surface and activates it', () => {
    const onClose = vi.fn();
    render(
      <RightTabContextMenu
        x={0}
        y={0}
        order={DEFAULT_RIGHT_TAB_ORDER}
        visible={normalizeAgentRightTabPrefs(undefined).visible}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Context' }));

    expect(useLayoutStore.getState().agentRightTab).toBe('context');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

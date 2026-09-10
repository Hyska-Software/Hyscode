/* @vitest-environment jsdom */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorLayout } from './editor-layout';
import {
  agentRightTabProjectKey,
  resolveTerminalLayoutPrefs,
  useLayoutStore,
  type TerminalLayoutPrefs,
} from '../../stores/layout-store';
import { useProjectStore } from '../../stores/project-store';
import { useSettingsStore } from '../../stores/settings-store';

interface CapturedPanel {
  defaultSize?: number;
  onResize?: (size: number) => void;
  hasRef: boolean;
}

interface CapturedHandle {
  className?: string;
  onDragging?: (dragging: boolean) => void;
}

const harness = vi.hoisted(() => ({
  panels: [] as CapturedPanel[],
  handles: [] as CapturedHandle[],
  rightPanelSize: 34,
  resizeCalls: [] as number[],
}));

vi.mock('react-resizable-panels', async () => {
  const { useImperativeHandle } = await import('react');
  return {
    PanelGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Panel: (props: {
      children?: React.ReactNode;
      defaultSize?: number;
      onResize?: (size: number) => void;
      ref?: React.Ref<unknown>;
    }) => {
      harness.panels.push({
        defaultSize: props.defaultSize,
        onResize: props.onResize,
        hasRef: Boolean(props.ref),
      });
      useImperativeHandle(
        props.ref,
        () => ({
          collapse: () => undefined,
          expand: () => undefined,
          getId: () => 'panel',
          getSize: () => harness.rightPanelSize,
          isCollapsed: () => false,
          isExpanded: () => true,
          resize: (size: number) => {
            harness.resizeCalls.push(size);
            harness.rightPanelSize = size;
          },
        }),
        [],
      );
      return <section>{props.children}</section>;
    },
    PanelResizeHandle: (props: { className?: string; onDragging?: (dragging: boolean) => void }) => {
      harness.handles.push({ className: props.className, onDragging: props.onDragging });
      return <div data-testid="resize-handle" />;
    },
  };
});

vi.mock('../sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('../editor', () => ({ EditorArea: () => <div data-testid="editor" /> }));
vi.mock('../terminal', () => ({ TerminalPanel: () => <div data-testid="terminal" /> }));
vi.mock('../agent/sidebar-panel', () => ({ SidebarPanel: () => <div data-testid="agent" /> }));
vi.mock('../terminal/terminal-drop-zone', () => ({
  TerminalDropZone: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const PROJECT_KEY = 'C:/layout-component-test';

function setPrefs(patch: Partial<TerminalLayoutPrefs>): void {
  useLayoutStore.setState((state) => ({
    terminalLayoutPrefs: {
      ...state.terminalLayoutPrefs,
      [PROJECT_KEY]: {
        ...resolveTerminalLayoutPrefs(state.terminalLayoutPrefs, PROJECT_KEY),
        ...patch,
      },
    },
  }));
}

function currentPrefs(): TerminalLayoutPrefs {
  return resolveTerminalLayoutPrefs(useLayoutStore.getState().terminalLayoutPrefs, PROJECT_KEY);
}

function lastPanel(predicate: (panel: CapturedPanel) => boolean): CapturedPanel | undefined {
  return [...harness.panels].reverse().find(predicate);
}

function lastHandle(className: string): CapturedHandle | undefined {
  return [...harness.handles].reverse().find((handle) => handle.className === className);
}

beforeEach(() => {
  harness.panels = [];
  harness.handles = [];
  harness.rightPanelSize = 34;
  harness.resizeCalls = [];
  useProjectStore.setState({ rootPath: PROJECT_KEY });
  useSettingsStore.setState({ showAgentChatPanel: true });
  useLayoutStore.setState({
    terminalLocation: 'bottom',
    terminalVisible: true,
    sidebarActiveTab: 'chat',
    sidebarVisible: true,
    terminalLayoutPrefs: {
      [agentRightTabProjectKey(PROJECT_KEY)]: {
        location: 'bottom',
        visible: true,
        sidebarActiveTab: 'chat',
        bottomPanelSize: 35,
        rightPanelSize: 34,
      },
    },
  });
});

afterEach(() => {
  cleanup();
  useProjectStore.setState({ rootPath: null });
});

describe('editor layout terminal persistence', () => {
  it('seeds panel sizes from the current project preferences', () => {
    act(() => setPrefs({ bottomPanelSize: 45, rightPanelSize: 40 }));
    harness.rightPanelSize = 40;

    render(<EditorLayout />);

    const terminalPanel = lastPanel((panel) => Boolean(panel.onResize) && !panel.hasRef);
    const rightPanel = lastPanel((panel) => panel.hasRef);
    expect(terminalPanel?.defaultSize).toBe(45);
    expect(rightPanel?.defaultSize).toBe(40);
  });

  it('commits resized panel sizes to the current project when dragging ends', () => {
    render(<EditorLayout />);

    const terminalPanel = lastPanel((panel) => Boolean(panel.onResize) && !panel.hasRef);
    act(() => terminalPanel?.onResize?.(58));
    act(() => lastHandle('h-1.5')?.onDragging?.(false));
    expect(currentPrefs().bottomPanelSize).toBe(58);

    const rightPanel = lastPanel((panel) => panel.hasRef);
    act(() => rightPanel?.onResize?.(46));
    act(() => lastHandle('w-1.5')?.onDragging?.(false));
    expect(currentPrefs().rightPanelSize).toBe(46);
  });

  it('reapplies the stored width when the active project changes', () => {
    render(<EditorLayout />);
    expect(harness.resizeCalls).toEqual([]);

    act(() => {
      useProjectStore.setState({ rootPath: 'C:/another-layout-project' });
      useLayoutStore.setState((state) => ({
        terminalLayoutPrefs: {
          ...state.terminalLayoutPrefs,
          'C:/another-layout-project': {
            ...resolveTerminalLayoutPrefs(state.terminalLayoutPrefs, PROJECT_KEY),
            rightPanelSize: 44,
          },
        },
      }));
    });

    expect(harness.resizeCalls).toEqual([44]);
  });
});

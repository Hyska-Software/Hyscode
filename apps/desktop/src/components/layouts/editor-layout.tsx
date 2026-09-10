import { useEffect, useRef } from 'react';
import { Sidebar } from '../sidebar';
import { EditorArea } from '../editor';
import { TerminalPanel } from '../terminal';
import { SidebarPanel } from '../agent/sidebar-panel';
import { TerminalDropZone } from '../terminal/terminal-drop-zone';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { resolveTerminalLayoutPrefs, useLayoutStore } from '../../stores/layout-store';
import { useProjectStore, useSettingsStore } from '../../stores';

/** Tolerance used when comparing persisted sizes against live panel sizes */
const PANEL_SIZE_EPSILON = 0.5;

/** Track the latest reported panel size and commit it once a drag settles */
function usePanelSizeCommit(commit: (size: number) => void): {
  onResize: (size: number) => void;
  commitPending: () => void;
} {
  const pending = useRef<number | null>(null);
  return {
    onResize: (size) => {
      pending.current = size;
    },
    commitPending: () => {
      const size = pending.current;
      if (size === null) return;
      pending.current = null;
      commit(size);
    },
  };
}

export function EditorLayout() {
  const terminalLocation = useLayoutStore((s) => s.terminalLocation);
  const terminalVisible = useLayoutStore((s) => s.terminalVisible);
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const moveTerminalToSidebar = useLayoutStore((s) => s.moveTerminalToSidebar);
  const moveTerminalToBottom = useLayoutStore((s) => s.moveTerminalToBottom);
  const showAgentChat = useSettingsStore((s) => s.showAgentChatPanel);
  const projectKey = useProjectStore((s) => s.rootPath);
  const terminalLayoutPrefs = useLayoutStore((s) => s.terminalLayoutPrefs);
  const setTerminalLayoutPrefs = useLayoutStore((s) => s.setTerminalLayoutPrefs);

  const terminalPrefs = resolveTerminalLayoutPrefs(terminalLayoutPrefs, projectKey);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const bottomSizeCommit = usePanelSizeCommit((size) =>
    setTerminalLayoutPrefs({ bottomPanelSize: size }),
  );
  const rightSizeCommit = usePanelSizeCommit((size) =>
    setTerminalLayoutPrefs({ rightPanelSize: size }),
  );

  const showBottomTerminal = terminalLocation === 'bottom' && terminalVisible;
  const terminalInSidebar = terminalLocation === 'sidebar' && terminalVisible;
  // Show right panel if chat is enabled OR the terminal lives there
  const showRightPanel = showAgentChat || terminalInSidebar;

  // `defaultSize` is only honoured on mount; restore the width when the project changes.
  useEffect(() => {
    const panel = rightPanelRef.current;
    if (!panel || !showRightPanel) return;
    if (Math.abs(panel.getSize() - terminalPrefs.rightPanelSize) > PANEL_SIZE_EPSILON) {
      panel.resize(terminalPrefs.rightPanelSize);
    }
  }, [projectKey, terminalPrefs.rightPanelSize, showRightPanel]);

  return (
    <PanelGroup direction="horizontal" className="min-h-0 min-w-0">
      {/* Sidebar */}
      {sidebarVisible && (
        <>
          <Panel defaultSize={16} minSize={12} maxSize={24}>
            <div className="h-full rounded-lg bg-surface overflow-hidden">
              <Sidebar />
            </div>
          </Panel>
          <PanelResizeHandle
            className="w-1.5"
            onDragging={(dragging) => {
              if (!dragging) rightSizeCommit.commitPending();
            }}
          />
        </>
      )}

      {/* Editor + (optionally) Terminal stacked */}
      <Panel defaultSize={showRightPanel ? 50 : sidebarVisible ? 84 : 100} minSize={30}>
        {showBottomTerminal ? (
          <PanelGroup direction="vertical" className="min-h-0 min-w-0">
            <Panel defaultSize={100 - terminalPrefs.bottomPanelSize} minSize={25}>
              <div className="h-full rounded-lg bg-surface overflow-hidden">
                <EditorArea />
              </div>
            </Panel>

            <PanelResizeHandle
              className="h-1.5"
              onDragging={(dragging) => {
                if (!dragging) bottomSizeCommit.commitPending();
              }}
            />

            <Panel
              defaultSize={terminalPrefs.bottomPanelSize}
              minSize={15}
              onResize={bottomSizeCommit.onResize}
            >
              <TerminalDropZone
                onDrop={showRightPanel ? moveTerminalToSidebar : () => {}}
                label="Move to Sidebar"
                className="h-full rounded-lg bg-surface overflow-hidden"
              >
                <TerminalPanel />
              </TerminalDropZone>
            </Panel>
          </PanelGroup>
        ) : (
          <TerminalDropZone
            onDrop={moveTerminalToBottom}
            label="Move Terminal to Panel"
            className="h-full rounded-lg bg-surface overflow-hidden"
          >
            <EditorArea />
          </TerminalDropZone>
        )}
      </Panel>

      {/* Agent + (optionally) Terminal in sidebar */}
      {showRightPanel && (
        <>
          <PanelResizeHandle
            className="w-1.5"
            onDragging={(dragging) => {
              if (!dragging) rightSizeCommit.commitPending();
            }}
          />
          <Panel
            ref={rightPanelRef}
            defaultSize={terminalPrefs.rightPanelSize}
            minSize={22}
            maxSize={50}
            onResize={rightSizeCommit.onResize}
          >
            <TerminalDropZone
              onDrop={moveTerminalToSidebar}
              label="Drop Terminal Here"
              className="h-full rounded-lg bg-surface overflow-hidden"
            >
              <SidebarPanel />
            </TerminalDropZone>
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}

import { Sidebar } from '../sidebar';
import { EditorArea } from '../editor';
import { TerminalPanel } from '../terminal';
import { SidebarPanel } from '../agent/sidebar-panel';
import { TerminalDropZone } from '../terminal/terminal-drop-zone';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useLayoutStore } from '../../stores/layout-store';
import { useSettingsStore } from '../../stores';

export function EditorLayout() {
  const terminalLocation = useLayoutStore((s) => s.terminalLocation);
  const terminalVisible = useLayoutStore((s) => s.terminalVisible);
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const moveTerminalToSidebar = useLayoutStore((s) => s.moveTerminalToSidebar);
  const moveTerminalToBottom = useLayoutStore((s) => s.moveTerminalToBottom);
  const showAgentChat = useSettingsStore((s) => s.showAgentChatPanel);

  const showBottomTerminal = terminalLocation === 'bottom' && terminalVisible;
  const terminalInSidebar = terminalLocation === 'sidebar' && terminalVisible;
  // Show right panel if chat is enabled OR the terminal lives there
  const showRightPanel = showAgentChat || terminalInSidebar;

  return (
    <PanelGroup direction="horizontal">
      {/* Sidebar */}
      {sidebarVisible && (
        <>
          <Panel defaultSize={16} minSize={12} maxSize={24}>
            <div className="h-full rounded-lg bg-surface overflow-hidden">
              <Sidebar />
            </div>
          </Panel>
          <PanelResizeHandle className="w-1.5" />
        </>
      )}

      {/* Editor + (optionally) Terminal stacked */}
      <Panel defaultSize={showRightPanel ? 50 : sidebarVisible ? 84 : 100} minSize={30}>
        {showBottomTerminal ? (
          <PanelGroup direction="vertical">
            <Panel defaultSize={65} minSize={25}>
              <div className="h-full rounded-lg bg-surface overflow-hidden">
                <EditorArea />
              </div>
            </Panel>

            <PanelResizeHandle className="h-1.5" />

            <Panel defaultSize={35} minSize={15}>
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
          <PanelResizeHandle className="w-1.5" />
          <Panel defaultSize={34} minSize={22} maxSize={50}>
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

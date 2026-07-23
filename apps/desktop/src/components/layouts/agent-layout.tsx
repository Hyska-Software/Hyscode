import { useRef, useEffect, useState } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { AgentPanel } from '../agent/agent-panel';
import { AgentLeftPanel } from './agent-left-panel';
import { AgentRightPanel } from './agent-right-panel';
import { useLayoutStore } from '../../stores/layout-store';

function panelTransition(dragging: boolean): React.CSSProperties {
  return dragging
    ? { transition: 'none' }
    : { transition: 'flex-grow 200ms ease-out' };
}

export function AgentLayout() {
  const leftRef = useRef<ImperativePanelHandle>(null);
  const rightRef = useRef<ImperativePanelHandle>(null);

  const leftCollapsed = useLayoutStore((s) => s.agentLeftCollapsed);
  const rightCollapsed = useLayoutStore((s) => s.agentRightCollapsed);
  const setLeftCollapsed = useLayoutStore((s) => s.setAgentLeftCollapsed);
  const setRightCollapsed = useLayoutStore((s) => s.setAgentRightCollapsed);

  const [leftDragging, setLeftDragging] = useState(false);
  const [rightDragging, setRightDragging] = useState(false);

  // Restore persisted collapsed state on first mount
  useEffect(() => {
    if (leftCollapsed) leftRef.current?.collapse();
  }, []);
  useEffect(() => {
    if (rightCollapsed) rightRef.current?.collapse();
  }, []);

  // Sync external state changes (chat expand buttons) to panel refs
  useEffect(() => {
    const panel = leftRef.current;
    if (!panel) return;
    if (leftCollapsed && !panel.isCollapsed()) {
      panel.collapse();
    } else if (!leftCollapsed && panel.isCollapsed()) {
      panel.expand();
    }
  }, [leftCollapsed]);

  useEffect(() => {
    const panel = rightRef.current;
    if (!panel) return;
    if (rightCollapsed && !panel.isCollapsed()) {
      panel.collapse();
    } else if (!rightCollapsed && panel.isCollapsed()) {
      panel.expand();
    }
  }, [rightCollapsed]);

  return (
    <PanelGroup direction="horizontal">
      {/* Left: Sessions + File Explorer */}
      <Panel
        ref={leftRef}
        defaultSize={20}
        minSize={14}
        maxSize={30}
        collapsible
        collapsedSize={0}
        onCollapse={() => setLeftCollapsed(true)}
        onExpand={() => setLeftCollapsed(false)}
        style={panelTransition(leftDragging)}
      >
        <div className="h-full rounded-lg bg-surface overflow-hidden">
          <AgentLeftPanel />
        </div>
      </Panel>

      {!leftCollapsed && (
        <PanelResizeHandle
          className="w-1.5"
          onDragging={setLeftDragging}
        />
      )}

      {/* Center: Agent Chat */}
      <Panel minSize={30}>
        <div className="h-full rounded-lg bg-surface overflow-hidden">
          <AgentPanel />
        </div>
      </Panel>

      {!rightCollapsed && (
        <PanelResizeHandle
          className="w-1.5"
          onDragging={setRightDragging}
        />
      )}

      {/* Right: Changes / Preview / Terminal */}
      <Panel
        ref={rightRef}
        defaultSize={35}
        minSize={20}
        maxSize={50}
        collapsible
        collapsedSize={0}
        onCollapse={() => setRightCollapsed(true)}
        onExpand={() => setRightCollapsed(false)}
        style={panelTransition(rightDragging)}
      >
        <div className="h-full rounded-lg bg-surface overflow-hidden">
          <AgentRightPanel />
        </div>
      </Panel>
    </PanelGroup>
  );
}

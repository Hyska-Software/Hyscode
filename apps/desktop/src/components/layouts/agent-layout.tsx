import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { AgentPanel } from '../agent/agent-panel';
import { AgentLeftPanel } from './agent-left-panel';
import { AgentRightPanel } from './agent-right-panel';

export function AgentLayout() {
  return (
    <PanelGroup direction="horizontal">
      {/* Left: Sessions + File Explorer */}
      <Panel defaultSize={20} minSize={14} maxSize={30}>
        <div className="h-full rounded-lg bg-surface overflow-hidden">
          <AgentLeftPanel />
        </div>
      </Panel>

      <PanelResizeHandle className="w-1.5" />

      {/* Center: Agent Chat */}
      <Panel defaultSize={45} minSize={30}>
        <div className="h-full rounded-lg bg-surface overflow-hidden">
          <AgentPanel />
        </div>
      </Panel>

      <PanelResizeHandle className="w-1.5" />

      {/* Right: Changes / Preview / Terminal */}
      <Panel defaultSize={35} minSize={20} maxSize={50}>
        <div className="h-full rounded-lg bg-surface overflow-hidden">
          <AgentRightPanel />
        </div>
      </Panel>
    </PanelGroup>
  );
}

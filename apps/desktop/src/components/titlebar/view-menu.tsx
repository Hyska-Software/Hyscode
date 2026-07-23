import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../ui/dropdown-menu';
import { useLayoutStore, type SidebarViewId } from '../../stores/layout-store';
import { useSettingsStore } from '../../stores';
import { useCommandStore } from '../../stores/command-store';

const VIEW_LABELS: Record<SidebarViewId, string> = {
  files: 'Explorer',
  search: 'Search',
  git: 'Source Control',
  skills: 'Skills',
  extensions: 'Extensions',
  agent: 'Agent',
  devices: 'Devices',
  docker: 'Docker',
  memories: 'Memories',
};

export function ViewMenu() {
  const workspaceMode = useLayoutStore((s) => s.workspaceMode);
  const setWorkspaceMode = useLayoutStore((s) => s.setWorkspaceMode);
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const focusSidebarView = useLayoutStore((s) => s.focusSidebarView);
  const sidebarActiveView = useLayoutStore((s) => s.sidebarActiveView);

  const terminalVisible = useLayoutStore((s) => s.terminalVisible);
  const terminalLocation = useLayoutStore((s) => s.terminalLocation);
  const toggleTerminal = useLayoutStore((s) => s.toggleTerminal);
  const moveTerminalToSidebar = useLayoutStore((s) => s.moveTerminalToSidebar);
  const moveTerminalToBottom = useLayoutStore((s) => s.moveTerminalToBottom);

  const showAgentChatPanel = useSettingsStore((s) => s.showAgentChatPanel);
  const setSettings = useSettingsStore((s) => s.set);
  const minimap = useSettingsStore((s) => s.minimap);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const lineNumbers = useSettingsStore((s) => s.lineNumbers);
  const visibleSidebarTabs = useSettingsStore((s) => s.visibleSidebarTabs);
  const activityBarPosition = useSettingsStore((s) => s.activityBarPosition);

  const executeCommand = useCommandStore((s) => s.executeCommand);

  const isAgentMode = workspaceMode === 'agent';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-7 cursor-pointer items-center rounded-md px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none">
        View
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="w-56">
        {/* ── Workspace Mode ── */}
        <DropdownMenuItem
          onClick={() => setWorkspaceMode('editor')}
          className={workspaceMode === 'editor' ? 'bg-accent text-accent-foreground' : ''}
        >
          Editor Mode
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setWorkspaceMode('agent')}
          className={workspaceMode === 'agent' ? 'bg-accent text-accent-foreground' : ''}
        >
          Agent Mode
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* ── Appearance ── */}
        <DropdownMenuCheckboxItem
          checked={sidebarVisible}
          onCheckedChange={toggleSidebar}
        >
          Sidebar
          <DropdownMenuShortcut>Ctrl+B</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={showAgentChatPanel}
          onCheckedChange={(checked) => setSettings('showAgentChatPanel', checked)}
          disabled={isAgentMode}
        >
          Agent Chat
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={minimap}
          onCheckedChange={(checked) => setSettings('minimap', checked)}
        >
          Minimap
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={wordWrap === 'on'}
          onCheckedChange={(checked) => setSettings('wordWrap', checked ? 'on' : 'off')}
        >
          Word Wrap
          <DropdownMenuShortcut>Alt+Z</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={lineNumbers !== 'off'}
          onCheckedChange={(checked) => setSettings('lineNumbers', checked ? 'on' : 'off')}
        >
          Line Numbers
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />

        {/* ── Sidebar Tabs ── */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Activity Bar Position</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuCheckboxItem
              checked={activityBarPosition === 'left'}
              onCheckedChange={() => setSettings('activityBarPosition', 'left')}
            >
              Left
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={activityBarPosition === 'top'}
              onCheckedChange={() => setSettings('activityBarPosition', 'top')}
            >
              Top
            </DropdownMenuCheckboxItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Sidebar Tabs</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            {(Object.keys(VIEW_LABELS) as SidebarViewId[]).map((id) => (
              <DropdownMenuCheckboxItem
                key={id}
                checked={visibleSidebarTabs[id]}
                onCheckedChange={(checked) =>
                  setSettings('visibleSidebarTabs', { ...visibleSidebarTabs, [id]: checked })
                }
                disabled={id === 'files'}
              >
                {VIEW_LABELS[id]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* ── Sidebar Views (jump to) ── */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Sidebar Views</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            {(Object.keys(VIEW_LABELS) as SidebarViewId[])
              .filter((id) => visibleSidebarTabs[id])
              .map((id) => (
                <DropdownMenuItem
                  key={id}
                  onClick={() => focusSidebarView(id)}
                  className={sidebarActiveView === id ? 'bg-accent text-accent-foreground' : ''}
                >
                  {VIEW_LABELS[id]}
                </DropdownMenuItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* ── Terminal ── */}
        <DropdownMenuCheckboxItem
          checked={terminalVisible}
          onCheckedChange={toggleTerminal}
        >
          Terminal
          <DropdownMenuShortcut>Ctrl+`</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>

        <DropdownMenuItem
          onClick={() => executeCommand('workbench.action.terminal.new')}
        >
          New Terminal
          <DropdownMenuShortcut>Ctrl+Shift+`</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={moveTerminalToBottom}
          disabled={terminalLocation === 'bottom'}
        >
          Move Terminal to Panel
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={moveTerminalToSidebar}
          disabled={terminalLocation === 'sidebar'}
        >
          Move Terminal to Sidebar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

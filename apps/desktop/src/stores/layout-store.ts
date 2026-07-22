import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TerminalLocation = 'bottom' | 'sidebar';
export type WorkspaceMode = 'editor' | 'agent';

/** Builtin sidebar views exposed in ActivityBar and View menu */
export type SidebarViewId =
  | 'files'
  | 'search'
  | 'git'
  | 'skills'
  | 'extensions'
  | 'agent'
  | 'devices'
  | 'docker'
  | 'memories';

/** Full sidebar view type including extension-contributed views */
export type SidebarView = SidebarViewId | (string & {});

interface LayoutState {
  /** Active workspace layout mode */
  workspaceMode: WorkspaceMode;
  /** Where the terminal is rendered: 'bottom' (below editor) or 'sidebar' (next to agent chat) */
  terminalLocation: TerminalLocation;
  /** Whether the terminal panel is visible at all */
  terminalVisible: boolean;
  /** Which tab is active when terminal is in sidebar mode */
  sidebarActiveTab: 'chat' | 'terminal';
  /** Which tab is active in the agent-mode right panel */
  agentRightTab: 'changes' | 'preview' | 'terminal';
  /** File path to preview in agent-mode right panel */
  agentPreviewFile: string | null;
  /** File path selected in the agent changes panel */
  agentSelectedChangeFile: string | null;
  /** Whether the rules panel popup is open in the agent panel */
  rulesPanelOpen: boolean;
  /** Whether the left sidebar is visible */
  sidebarVisible: boolean;
  /** Which view is active in the left sidebar */
  sidebarActiveView: SidebarView;
  /** Whether the agent left panel is collapsed */
  agentLeftCollapsed: boolean;
  /** Whether the agent right panel is collapsed */
  agentRightCollapsed: boolean;

  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setTerminalLocation: (location: TerminalLocation) => void;
  setTerminalVisible: (visible: boolean) => void;
  setSidebarActiveTab: (tab: 'chat' | 'terminal') => void;
  setAgentRightTab: (tab: 'changes' | 'preview' | 'terminal') => void;
  setAgentPreviewFile: (filePath: string | null) => void;
  setAgentSelectedChangeFile: (filePath: string | null) => void;
  setRulesPanelOpen: (open: boolean) => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarActiveView: (view: SidebarView) => void;
  setAgentLeftCollapsed: (collapsed: boolean) => void;
  setAgentRightCollapsed: (collapsed: boolean) => void;
  toggleTerminal: () => void;
  toggleSidebar: () => void;
  focusSidebarView: (view: SidebarView) => void;
  moveTerminalToSidebar: () => void;
  moveTerminalToBottom: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      workspaceMode: 'editor',
      terminalLocation: 'bottom',
      terminalVisible: true,
      sidebarActiveTab: 'chat',
      agentRightTab: 'changes',
      agentPreviewFile: null,
      agentSelectedChangeFile: null,
      rulesPanelOpen: false,
      sidebarVisible: true,
      sidebarActiveView: 'files',
      agentLeftCollapsed: false,
      agentRightCollapsed: false,

      setWorkspaceMode: (mode) => set({ workspaceMode: mode }),
      setTerminalLocation: (location) => set({ terminalLocation: location }),
      setTerminalVisible: (visible) => set({ terminalVisible: visible }),
      setSidebarActiveTab: (tab) => set({ sidebarActiveTab: tab }),
      setAgentRightTab: (tab) => set({ agentRightTab: tab }),
      setAgentPreviewFile: (filePath) => set({ agentPreviewFile: filePath, agentRightTab: 'preview' }),
      setAgentSelectedChangeFile: (filePath) =>
        set({ agentSelectedChangeFile: filePath, agentRightTab: 'changes' }),
      setRulesPanelOpen: (open) => set({ rulesPanelOpen: open }),
      setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
      setSidebarActiveView: (view) => set({ sidebarActiveView: view }),
      setAgentLeftCollapsed: (collapsed) => set({ agentLeftCollapsed: collapsed }),
      setAgentRightCollapsed: (collapsed) => set({ agentRightCollapsed: collapsed }),

      toggleTerminal: () =>
        set((state) => ({ terminalVisible: !state.terminalVisible })),

      toggleSidebar: () =>
        set((state) => ({ sidebarVisible: !state.sidebarVisible })),

      focusSidebarView: (view) =>
        set({ sidebarActiveView: view, sidebarVisible: true }),

      moveTerminalToSidebar: () =>
        set({ terminalLocation: 'sidebar', sidebarActiveTab: 'terminal', terminalVisible: true }),

      moveTerminalToBottom: () =>
        set({ terminalLocation: 'bottom', terminalVisible: true }),
    }),
    {
      name: 'hyscode-layout',
      partialize: (state) => ({
        workspaceMode: state.workspaceMode,
        terminalLocation: state.terminalLocation,
        terminalVisible: state.terminalVisible,
        sidebarVisible: state.sidebarVisible,
        sidebarActiveView: state.sidebarActiveView,
        agentLeftCollapsed: state.agentLeftCollapsed,
        agentRightCollapsed: state.agentRightCollapsed,
      }),
    },
  ),
);

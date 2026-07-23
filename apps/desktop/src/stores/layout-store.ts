import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useProjectStore } from './project-store';

export type TerminalLocation = 'bottom' | 'sidebar';
export type WorkspaceMode = 'editor' | 'agent';

/** Tabs available in the agent-mode right panel */
export type RightTab = 'changes' | 'preview' | 'terminal' | 'files';

/** Per-project preferences for the agent right panel tabs */
export interface AgentRightTabPrefs {
  order: RightTab[];
  visible: Record<RightTab, boolean>;
}

/** Default order for the agent right panel tabs */
export const DEFAULT_RIGHT_TAB_ORDER: RightTab[] = ['changes', 'files', 'preview', 'terminal'];

/** Default visibility for the agent right panel tabs (all visible) */
export const DEFAULT_RIGHT_TAB_VISIBILITY: Record<RightTab, boolean> = {
  changes: true,
  files: true,
  preview: true,
  terminal: true,
};

/** Fallback key used when no project is currently open */
const GLOBAL_PROJECT_KEY = '__global__';

/** Resolve the current project key (root path) for scoping tab prefs */
function getProjectKey(): string {
  return useProjectStore.getState().rootPath ?? GLOBAL_PROJECT_KEY;
}

/** Build a complete, valid prefs object from a possibly-partial stored value */
export function normalizeAgentRightTabPrefs(
  prefs: AgentRightTabPrefs | undefined,
): AgentRightTabPrefs {
  return normalizePrefs(prefs);
}

/** Resolve the project key for a given root path (or the global fallback) */
export function agentRightTabProjectKey(rootPath: string | null): string {
  return rootPath ?? GLOBAL_PROJECT_KEY;
}

function normalizePrefs(prefs: AgentRightTabPrefs | undefined): AgentRightTabPrefs {
  const visible: Record<RightTab, boolean> = {
    ...DEFAULT_RIGHT_TAB_VISIBILITY,
    ...(prefs?.visible ?? {}),
  };
  // Keep only known tabs, preserve stored order, then append any missing tabs
  const storedOrder = (prefs?.order ?? []).filter((id): id is RightTab =>
    DEFAULT_RIGHT_TAB_ORDER.includes(id),
  );
  const order: RightTab[] = [
    ...storedOrder,
    ...DEFAULT_RIGHT_TAB_ORDER.filter((id) => !storedOrder.includes(id)),
  ];
  return { order, visible };
}

/** Builtin sidebar views exposed in ActivityBar and View menu */
export type AgentChangesFilter = 'session' | 'last-turn' | 'staged' | 'working';

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
  agentRightTab: RightTab;
  /** Per-project order + visibility for the agent right panel tabs, keyed by project root path */
  agentRightTabPrefs: Record<string, AgentRightTabPrefs>;
  /** File path to preview in agent-mode right panel */
  agentPreviewFile: string | null;
  /** File path selected in the agent changes panel */
  agentSelectedChangeFile: string | null;
  /** Active filter in the agent changes panel */
  agentChangesFilter: AgentChangesFilter;
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
  setAgentRightTab: (tab: RightTab) => void;
  /** Reorder the agent right panel tabs for the current project */
  reorderAgentRightTabs: (fromIndex: number, toIndex: number) => void;
  /** Show/hide an agent right panel tab for the current project (min 1 visible) */
  setAgentRightTabVisible: (id: RightTab, visible: boolean) => void;
  /** Reset the current project's agent right panel tab order + visibility to defaults */
  resetAgentRightTabs: () => void;
  setAgentPreviewFile: (filePath: string | null) => void;
  setAgentSelectedChangeFile: (filePath: string | null) => void;
  setAgentChangesFilter: (filter: AgentChangesFilter) => void;
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
      agentRightTabPrefs: {},
      agentPreviewFile: null,
      agentSelectedChangeFile: null,
      agentChangesFilter: 'session',
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

      reorderAgentRightTabs: (fromIndex, toIndex) =>
        set((state) => {
          const key = getProjectKey();
          const prefs = normalizePrefs(state.agentRightTabPrefs[key]);
          if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= prefs.order.length ||
            toIndex >= prefs.order.length ||
            fromIndex === toIndex
          ) {
            return {};
          }
          const order = [...prefs.order];
          const [moved] = order.splice(fromIndex, 1);
          order.splice(toIndex, 0, moved);
          return {
            agentRightTabPrefs: {
              ...state.agentRightTabPrefs,
              [key]: { ...prefs, order },
            },
          };
        }),

      setAgentRightTabVisible: (id, visible) =>
        set((state) => {
          const key = getProjectKey();
          const prefs = normalizePrefs(state.agentRightTabPrefs[key]);
          // Prevent hiding the last visible tab
          if (!visible) {
            const visibleCount = prefs.order.filter((tabId) => prefs.visible[tabId]).length;
            if (visibleCount <= 1 && prefs.visible[id]) {
              return {};
            }
          }
          const nextVisible: Record<RightTab, boolean> = { ...prefs.visible, [id]: visible };
          // If the active tab was hidden, switch to the first visible tab in order
          let agentRightTab = state.agentRightTab;
          if (!visible && agentRightTab === id) {
            const firstVisible = prefs.order.find((tabId) => nextVisible[tabId]);
            if (firstVisible) agentRightTab = firstVisible;
          }
          return {
            agentRightTab,
            agentRightTabPrefs: {
              ...state.agentRightTabPrefs,
              [key]: { ...prefs, visible: nextVisible },
            },
          };
        }),

      resetAgentRightTabs: () =>
        set((state) => {
          const key = getProjectKey();
          const rest = { ...state.agentRightTabPrefs };
          delete rest[key];
          const agentRightTab = DEFAULT_RIGHT_TAB_ORDER.includes(state.agentRightTab)
            ? state.agentRightTab
            : DEFAULT_RIGHT_TAB_ORDER[0];
          return { agentRightTab, agentRightTabPrefs: rest };
        }),
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
        agentRightTabPrefs: state.agentRightTabPrefs,
      }),
    },
  ),
);

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AgentType, ToolCategory } from '@hyscode/agent-harness';
import type { SidebarViewId } from './layout-store';

// ── Types ────────────────────────────────────────────────────────────────────

export type ApprovalMode = 'manual' | 'yolo' | 'smart' | 'notify' | 'session-trust' | 'custom';
export type UpdateChannel = 'stable' | 'pre-release';
export type WordWrap = 'on' | 'off' | 'wordWrapColumn';
export type LineNumbers = 'on' | 'off' | 'relative';
export type CursorStyle = 'line' | 'block' | 'underline';
export type RenderWhitespace = 'none' | 'boundary' | 'all';
export type AutoSave = 'off' | 'afterDelay' | 'onFocusChange';
export type AutoClosingBrackets = 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';
export type AutoClosingQuotes = 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';
export type TerminalCursorStyle = 'block' | 'underline' | 'bar';

export type ThemeId =
  | 'hyscode-dark'
  | 'hyscode-light'
  | 'nord'
  | 'monokai'
  | 'dracula'
  | 'github-dark'
  | (string & {}); // allows extension theme ids while keeping autocomplete

export interface ProviderConfig {
  providerId: string;
  modelId: string;
  isActive: boolean;
}

export interface CustomModel {
  providerId: string;
  modelId: string;
  name: string;
}

export interface ModelThinkingConfig {
  enabled: boolean;
  level?: 'low' | 'medium' | 'high' | 'enabled' | 'disabled' | 'none' | 'minimal' | 'xhigh';
  budgetTokens?: number;
  display?: 'summarized' | 'omitted';
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'websocket';
  /** For stdio: command to run */
  command?: string;
  /** For stdio: args for command */
  args?: string[];
  /** For SSE: url */
  url?: string;
  /** For WebSocket: url */
  wsUrl?: string;
  enabled: boolean;
}

/** Per-category / per-tool overrides for the 'custom' approval mode */
export interface CustomApprovalRules {
  /** Override approval requirement per tool category.
   *  true  = auto-approve (no dialog)
   *  false = always ask
   */
  categoryRules: Partial<Record<ToolCategory, boolean>>;
  /** Override approval requirement per exact tool name (highest priority).
   *  true  = auto-approve
   *  false = always ask
   */
  toolRules: Record<string, boolean>;
}

// ── State ────────────────────────────────────────────────────────────────────

interface SettingsState {
  // ─ Theme ─
  themeId: ThemeId;
  iconThemeId: string;

  // ─ Editor ─
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: WordWrap;
  minimap: boolean;
  lineNumbers: LineNumbers;
  cursorStyle: CursorStyle;
  renderWhitespace: RenderWhitespace;
  bracketPairColorization: boolean;
  scrollBeyondLastLine: boolean;
  smoothScrolling: boolean;
  autoClosingBrackets: AutoClosingBrackets;
  autoClosingQuotes: AutoClosingQuotes;
  formatOnPaste: boolean;
  formatOnType: boolean;
  autoSave: AutoSave;
  autoSaveDelay: number;
  gitBlameInline: boolean;

  // ─ Terminal ─
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalScrollback: number;
  terminalShell: string;
  terminalCursorStyle: TerminalCursorStyle;

  // ─ Git ─
  gitUserName: string;
  gitUserEmail: string;
  gitDefaultBranch: string;
  gitAutoFetch: boolean;
  gitAutoFetchInterval: number;
  gitConfirmDiscard: boolean;
  /** Provider used for AI commit message generation (null = use active provider) */
  commitAiProviderId: string | null;
  /** Model used for AI commit message generation (null = use active model) */
  commitAiModelId: string | null;

  // ─ General ─
  confirmOnClose: boolean;
  showWelcomeOnStartup: boolean;
  reducedMotion: boolean;

  // ─ Updates ─
  updateChannel: UpdateChannel;
  checkForUpdatesOnStartup: boolean;
  autoDownload: boolean;

  // ─ Agent / Provider ─
  activeProviderId: string | null;
  activeModelId: string | null;
  /** When true, the model selector shows all providers' enabled models */
  useAllProviders: boolean;
  agentType: AgentType;
  providers: ProviderConfig[];
  approvalMode: ApprovalMode;
  /** Per-category and per-tool overrides used when approvalMode === 'custom' */
  customApprovalRules: CustomApprovalRules;
  maxIterations: number;
  temperature: number;
  maxTokens: number;
  topP: number | null;

  // ─ Inline Completion (AI-powered autocomplete) ─
  inlineCompletionEnabled: boolean;
  inlineCompletionProviderId: string | null;
  inlineCompletionModelId: string | null;
  inlineCompletionDelay: number;
  inlineCompletionMaxTokens: number;
  inlineCompletionTemperature: number;

  // ─ Per-provider enabled models ─
  /** Maps provider id → array of enabled model ids */
  enabledModels: Record<string, string[]>;
  /** User-added custom models (primarily for OpenRouter) */
  customModels: CustomModel[];

  // ─ Thinking / Reasoning ─
  /** Per-model thinking configuration: key = "providerId::modelId" */
  thinkingSettings: Record<string, ModelThinkingConfig>;

  // ─ MCP Servers ─
  mcpServers: McpServerConfig[];

  // ─ Skills ─
  skillsPath: string;

  // ─ Rules ─
  globalRulesPath: string;

  // ─ Mobile / Devices ─
  flutterSdkPath: string;
  androidSdkPath: string;
  reactNativeAutoDetect: boolean;

  // ─ Docker ─
  dockerSocketPath: string;
  dockerShowStopped: boolean;
  dockerAutoRefreshInterval: number;
  dockerComposeFile: string;

  // ─ Language Servers ─
  /** Per-server custom binary path overrides: serverId → absolute path to binary */
  lspCustomBinaryPaths: Record<string, string>;

  // ─ Layout tabs ─
  showAgentTab: boolean;
  showReviewTab: boolean;
  showAgentChatPanel: boolean;
  agentCenterPanelMode: 'chat' | 'terminal';
  /** Which builtin sidebar tabs are visible in the ActivityBar */
  visibleSidebarTabs: Record<SidebarViewId, boolean>;
  /** Which extension-contributed sidebar views are visible */
  visibleExtensionViews: Record<string, boolean>;

  // ─ Settings modal ─
  settingsOpen: boolean;

  // ─ Actions ─
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  setThemeId: (id: ThemeId) => void;
  setIconThemeId: (id: string) => void;
  setActiveProvider: (providerId: string, modelId: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
  addMcpServer: (server: McpServerConfig) => void;
  removeMcpServer: (id: string) => void;
  updateMcpServer: (id: string, patch: Partial<McpServerConfig>) => void;
  toggleModel: (providerId: string, modelId: string) => void;
  setEnabledModels: (providerId: string, modelIds: string[]) => void;
  addCustomModel: (model: CustomModel) => void;
  removeCustomModel: (providerId: string, modelId: string) => void;
  /** Set a per-category override for custom approval mode */
  setCustomCategoryRule: (category: ToolCategory, autoApprove: boolean | undefined) => void;
  /** Set a per-tool override for custom approval mode */
  setCustomToolRule: (toolName: string, autoApprove: boolean | undefined) => void;
  /** Get thinking config for a specific provider+model */
  getThinkingConfig: (providerId: string, modelId: string) => ModelThinkingConfig;
  /** Set thinking config for a specific provider+model */
  setThinkingConfig: (providerId: string, modelId: string, config: Partial<ModelThinkingConfig>) => void;
  /** Set a custom binary path override for a language server */
  setLspCustomBinaryPath: (serverId: string, path: string) => void;
  /** Remove the custom binary path override for a language server */
  clearLspCustomBinaryPath: (serverId: string) => void;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    immer((set) => ({
      // Theme
      themeId: 'hyscode-dark',
      iconThemeId: 'default',

      // Editor
      fontSize: 14,
      fontFamily: 'Geist Mono',
      lineHeight: 1.5,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'off',
      minimap: true,
      lineNumbers: 'on',
      cursorStyle: 'line',
      renderWhitespace: 'none',
      bracketPairColorization: true,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      autoClosingBrackets: 'languageDefined',
      autoClosingQuotes: 'languageDefined',
      formatOnPaste: false,
      formatOnType: false,
      autoSave: 'off',
      autoSaveDelay: 1000,
      gitBlameInline: true,

      // Terminal
      terminalFontSize: 13,
      terminalFontFamily: 'Geist Mono',
      terminalScrollback: 1000,
      terminalShell: '',
      terminalCursorStyle: 'block',

      // Git
      gitUserName: '',
      gitUserEmail: '',
      gitDefaultBranch: 'main',
      gitAutoFetch: false,
      gitAutoFetchInterval: 5,
      gitConfirmDiscard: true,
      commitAiProviderId: null,
      commitAiModelId: null,

      // General
      confirmOnClose: false,
      showWelcomeOnStartup: true,
      reducedMotion: false,

      // Updates
      updateChannel: 'stable' as UpdateChannel,
      checkForUpdatesOnStartup: true,
      autoDownload: false,

      // Agent / Provider
      activeProviderId: null,
      activeModelId: null,
      useAllProviders: false,
      agentType: 'chat' as AgentType,
      providers: [],
      approvalMode: 'manual',
      customApprovalRules: {
        categoryRules: {},
        toolRules: {},
      },
      maxIterations: 25,
      temperature: 0.0,
      maxTokens: 8192,
      topP: null,

      // Inline Completion
      inlineCompletionEnabled: true,
      inlineCompletionProviderId: null,
      inlineCompletionModelId: null,
      inlineCompletionDelay: 300,
      inlineCompletionMaxTokens: 128,
      inlineCompletionTemperature: 0.2,

      // Per-provider enabled models (default: empty = all enabled)
      enabledModels: {},
      customModels: [],

      // Thinking / Reasoning
      thinkingSettings: {},

      // MCP Servers
      mcpServers: [],

      // Skills
      skillsPath: '',

      // Rules
      globalRulesPath: '',

      // Mobile / Devices
      flutterSdkPath: '',
      androidSdkPath: '',
      reactNativeAutoDetect: true,

      // Docker
      dockerSocketPath: '',
      dockerShowStopped: true,
      dockerAutoRefreshInterval: 5,
      dockerComposeFile: 'docker-compose.yml',

      // Language Servers
      lspCustomBinaryPaths: {},

      // Layout tabs
      showAgentTab: true,
      showReviewTab: true,
      showAgentChatPanel: true,
      agentCenterPanelMode: 'chat' as const,
      visibleSidebarTabs: {
        files: true,
        search: true,
        git: true,
        skills: true,
        extensions: true,
        agent: true,
        devices: true,
        docker: true,
      },
      visibleExtensionViews: {},

      // Settings modal
      settingsOpen: false,

      // Generic setter for any key
      set: (key, value) =>
        set((state) => {
          (state as Record<string, unknown>)[key as string] = value;
        }),

      setThemeId: (id) =>
        set((state) => {
          state.themeId = id;
        }),

      setIconThemeId: (id) =>
        set((state) => {
          state.iconThemeId = id;
        }),

      setActiveProvider: (providerId, modelId) =>
        set((state) => {
          state.activeProviderId = providerId;
          state.activeModelId = modelId;
        }),

      openSettings: () =>
        set((state) => {
          state.settingsOpen = true;
        }),

      closeSettings: () =>
        set((state) => {
          state.settingsOpen = false;
        }),

      addMcpServer: (server) =>
        set((state) => {
          state.mcpServers.push(server);
        }),

      removeMcpServer: (id) =>
        set((state) => {
          state.mcpServers = state.mcpServers.filter((s) => s.id !== id);
        }),

      updateMcpServer: (id, patch) =>
        set((state) => {
          const server = state.mcpServers.find((s) => s.id === id);
          if (server) Object.assign(server, patch);
        }),

      toggleModel: (providerId, modelId) =>
        set((state) => {
          const current = state.enabledModels[providerId];
          if (!current) {
            // First toggle for this provider — no entry means "all enabled"
            // We need to know all model ids to create the list minus this one.
            // Store an empty array convention: absent key = all on, present key = explicit list.
            // Toggle OFF: store all-except-this. But we don't know "all" here.
            // Instead: absent key = use default; present array = explicit enabled.
            // On first toggle-off, the UI will call setEnabledModels first.
            state.enabledModels[providerId] = [modelId];
          } else if (current.includes(modelId)) {
            state.enabledModels[providerId] = current.filter((m) => m !== modelId);
          } else {
            current.push(modelId);
          }
        }),

      setEnabledModels: (providerId, modelIds) =>
        set((state) => {
          state.enabledModels[providerId] = modelIds;
        }),

      addCustomModel: (model) =>
        set((state) => {
          // Avoid duplicates
          if (!state.customModels.some((m) => m.providerId === model.providerId && m.modelId === model.modelId)) {
            state.customModels.push(model);
            // Auto-enable the custom model
            if (!state.enabledModels[model.providerId]) {
              state.enabledModels[model.providerId] = [model.modelId];
            } else if (!state.enabledModels[model.providerId].includes(model.modelId)) {
              state.enabledModels[model.providerId].push(model.modelId);
            }
          }
        }),

      removeCustomModel: (providerId, modelId) =>
        set((state) => {
          state.customModels = state.customModels.filter(
            (m) => !(m.providerId === providerId && m.modelId === modelId),
          );
          // Also remove from enabled
          const enabled = state.enabledModels[providerId];
          if (enabled) {
            state.enabledModels[providerId] = enabled.filter((m) => m !== modelId);
          }
        }),

      setCustomCategoryRule: (category, autoApprove) =>
        set((state) => {
          if (autoApprove === undefined) {
            delete state.customApprovalRules.categoryRules[category];
          } else {
            state.customApprovalRules.categoryRules[category] = autoApprove;
          }
        }),

      setCustomToolRule: (toolName, autoApprove) =>
        set((state) => {
          if (autoApprove === undefined) {
            delete state.customApprovalRules.toolRules[toolName];
          } else {
            state.customApprovalRules.toolRules[toolName] = autoApprove;
          }
        }),

      getThinkingConfig: (providerId: string, modelId: string): ModelThinkingConfig => {
        const key = `${providerId}::${modelId}`;
        const stored = useSettingsStore.getState().thinkingSettings[key];
        return stored ?? { enabled: false };
      },

      setThinkingConfig: (providerId: string, modelId: string, config: Partial<ModelThinkingConfig>) =>
        set((state) => {
          const key = `${providerId}::${modelId}`;
          const current = state.thinkingSettings[key] ?? { enabled: false };
          state.thinkingSettings[key] = { ...current, ...config };
        }),

      setLspCustomBinaryPath: (serverId, path) =>
        set((state) => {
          state.lspCustomBinaryPaths[serverId] = path;
        }),

      clearLspCustomBinaryPath: (serverId) =>
        set((state) => {
          delete state.lspCustomBinaryPaths[serverId];
        }),
    })),
    {
      name: 'hyscode-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        // Exclude transient UI state and action functions from persistence
        const { settingsOpen: _, ...rest } = state;
        return rest;
      },
    },
  ),
);

/**
 * Settings store defaults
 *
 * The initial values for every persisted field in the settings store.
 * Exported as `SETTINGS_DEFAULTS` so the settings sidebar tree can:
 *   1. Detect which tabs have been modified (by diffing current state against these values)
 *   2. Reset a tab to its defaults without inlining the full default map in the sidebar
 *
 * The shape of this object MUST match the data portion of `SettingsState` in
 * `./settings-store.ts`. The store spreads it into the immer initial state.
 */

export const SETTINGS_DEFAULTS = {
  // ─ Theme ─
  themeId: 'hyscode-dark',
  iconThemeId: 'default',
  disableRoundedBorders: false,

  // ─ Editor ─
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

  // ─ Terminal ─
  terminalFontSize: 13,
  terminalFontFamily: 'Geist Mono',
  terminalScrollback: 1000,
  terminalShell: '',
  terminalCursorStyle: 'block',

  // ─ Git ─
  gitUserName: '',
  gitUserEmail: '',
  gitDefaultBranch: 'main',
  gitAutoFetch: false,
  gitAutoFetchInterval: 5,
  gitConfirmDiscard: true,
  commitAiProviderId: null,
  commitAiModelId: null,

  // ─ General ─
  confirmOnClose: false,
  showWelcomeOnStartup: true,
  reducedMotion: false,

  // ─ Updates ─
  updateChannel: 'stable',
  checkForUpdatesOnStartup: true,
  autoDownload: false,

  // ─ Agent / Provider ─
  activeProviderId: null,
  activeModelId: null,
  useAllProviders: false,
  agentType: 'chat',
  providers: [],
  approvalMode: 'manual',
  customApprovalRules: { categoryRules: {}, toolRules: {} },
  interactionLimitEnabled: false,
  maxIterations: 25,
  temperature: 0.0,
  maxTokens: 8192,
  topP: null,
  agentMaxRetries: 3,
  agentRetryBaseDelayMs: 1_000,
  agentRetryMaxDelayMs: 30_000,
  agentRequestTimeoutMs: 120_000,
  agentStreamIdleTimeoutMs: 90_000,

  // ─ Inline Completion ─
  inlineCompletionEnabled: true,
  inlineCompletionProviderId: null,
  inlineCompletionModelId: null,
  inlineCompletionDelay: 300,
  inlineCompletionMaxTokens: 128,
  inlineCompletionTemperature: 0.2,

  // ─ Per-provider enabled models ─
  enabledModels: {},
  customModels: [],

  // ─ Thinking / Reasoning ─
  thinkingSettings: {},

  // ─ MCP Servers ─
  mcpServers: [],

  // ─ Skills ─
  skillsPath: '',

  // ─ Rules ─
  globalRulesPath: '',

  // ─ Mobile / Devices ─
  flutterSdkPath: '',
  androidSdkPath: '',
  reactNativeAutoDetect: true,

  // ─ Docker ─
  dockerSocketPath: '',
  dockerShowStopped: true,
  dockerAutoRefreshInterval: 5,
  dockerComposeFile: 'docker-compose.yml',

  // ─ Language Servers ─
  lspCustomBinaryPaths: {},

  // ─ Sub-agents ─
  subAgentEnabled: true,
  subAgentDefaultMode: 'build',
  subAgentMaxIterations: 20,
  subAgentAutoApprove: false,

  // ─ Layout tabs ─
  activityBarPosition: 'left',
  showAgentTab: true,
  showAgentChatPanel: true,
  agentCenterPanelMode: 'chat',
  visibleSidebarTabs: {
    files: true,
    search: true,
    git: true,
    skills: true,
    extensions: true,
    agent: true,
    devices: true,
    docker: true,
    memories: true,
  },
  visibleExtensionViews: {},
} as const;

export type SettingsDefaults = typeof SETTINGS_DEFAULTS;
export type SettingsKey = keyof SettingsDefaults;

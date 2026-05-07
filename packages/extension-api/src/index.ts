// ── Disposable ───────────────────────────────────────────────────────────────

export interface Disposable {
  dispose(): void;
}

// ── Extension Manifest (extension.json) ──────────────────────────────────────

export interface ExtensionManifest {
  name: string;
  displayName: string;
  version: string;
  description?: string;
  publisher: string;
  engines: { hyscode: string };
  main?: string;
  activationEvents?: string[];
  contributes?: ContributionPoints;
  icon?: string;
  categories?: string[];
  keywords?: string[];
  repository?: string;
  license?: string;
  readme?: string;
}

// ── Contribution Points ──────────────────────────────────────────────────────

export interface ContributionPoints {
  themes?: ThemeContribution[];
  languages?: LanguageContribution[];
  languageServers?: LspContribution[];
  commands?: CommandContribution[];
  keybindings?: KeybindingContribution[];
  views?: ViewContribution[];
  statusBarItems?: StatusBarItemContribution[];
  configuration?: ConfigurationContribution;
  menus?: MenuContributions;
  snippets?: SnippetContribution[];
  iconThemes?: IconThemeContribution[];
  /** Dedicated settings tabs registered in the Settings modal. */
  settingsTabs?: SettingsTabContribution[];
}

// ── Theme Contribution ───────────────────────────────────────────────────────

export interface ThemeContribution {
  id: string;
  label: string;
  uiTheme: 'hyscode-dark' | 'hyscode-light';
  path: string;
}

export interface ThemeDefinition {
  id: string;
  label: string;
  type: 'dark' | 'light';
  colors: Record<string, string>;
  tokenColors?: TokenColorRule[];
  source?: 'builtin' | 'extension';
  extensionName?: string;
}

export interface TokenColorRule {
  scope: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

// ── Language Contribution ────────────────────────────────────────────────────

export interface LanguageContribution {
  id: string;
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  mimetypes?: string[];
  configuration?: string;
  tokenizer?: string;
  icon?: string;
}

// ── Language Server Contribution ─────────────────────────────────────────────

export interface LspContribution {
  id: string;
  languageIds: string[];
  command: string;
  args?: string[];
  rootPatterns?: string[];
  initializationOptions?: Record<string, unknown>;
}

// ── Command Contribution ─────────────────────────────────────────────────────

export interface CommandContribution {
  id: string;
  title: string;
  category?: string;
  icon?: string;
  enablement?: string;
}

// ── Keybinding Contribution ──────────────────────────────────────────────────

export interface KeybindingContribution {
  command: string;
  key: string;
  mac?: string;
  when?: string;
}

// ── View Contribution ────────────────────────────────────────────────────────

export interface ViewContribution {
  id: string;
  name: string;
  icon?: string;
  when?: string;
}

// ── Status Bar Item Contribution ─────────────────────────────────────────────

export interface StatusBarItemContribution {
  id: string;
  text: string;
  tooltip?: string;
  command?: string;
  alignment?: 'left' | 'right';
  priority?: number;
}

// ── Configuration Contribution ───────────────────────────────────────────────

export interface ConfigurationContribution {
  title?: string;
  properties: Record<string, ConfigurationProperty>;
}

export interface ConfigurationProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  default?: unknown;
  description?: string;
  enum?: string[];
  enumDescriptions?: string[];
  minimum?: number;
  maximum?: number;
}

// ── Menu Contribution ────────────────────────────────────────────────────────

export interface MenuContributions {
  'editor/context'?: MenuItem[];
  'editor/title'?: MenuItem[];
  'explorer/context'?: MenuItem[];
  commandPalette?: MenuItem[];
}

export interface MenuItem {
  command: string;
  group?: string;
  when?: string;
}

// ── Snippet Contribution ─────────────────────────────────────────────────────

export interface SnippetContribution {
  language: string;
  path: string;
}

// ── Icon Theme Contribution ──────────────────────────────────────────────────

export interface IconThemeContribution {
  id: string;
  label: string;
  path: string;
}

/**
 * A single icon definition inside an icon theme JSON file.
 * `svgPath` is resolved relative to the theme JSON file's directory.
 */
export interface IconImageDefinition {
  svgPath: string;
}

/**
 * Shape of the icon theme JSON file referenced by `IconThemeContribution.path`.
 *
 * Keys in `fileExtensions`, `fileNames`, `folderNames`, and `folderNamesExpanded`
 * are matched case-insensitively. Extension keys should omit the leading dot.
 */
export interface IconThemeDefinition {
  /** Map of icon id → image definition. All icon ids used below must appear here. */
  iconDefinitions: Record<string, IconImageDefinition>;
  /** Default icon id used for files with no specific match. */
  file?: string;
  /** Default icon id used for closed folders with no specific match. */
  folder?: string;
  /** Default icon id used for open folders with no specific match. */
  folderExpanded?: string;
  /** Map of file extension (no leading dot) → icon id. */
  fileExtensions?: Record<string, string>;
  /** Map of exact file name → icon id. */
  fileNames?: Record<string, string>;
  /** Map of folder name → icon id for closed state. */
  folderNames?: Record<string, string>;
  /** Map of folder name → icon id for open state. */
  folderNamesExpanded?: Record<string, string>;
}

// ── Settings Tab Contribution ─────────────────────────────────────────────────

/**
 * Contributes a dedicated tab to the Settings modal.
 * The tab content is pushed at runtime via `api.settings.updateTabContent()`.
 */
export interface SettingsTabContribution {
  /** Unique id — must be unique across all extensions. Use `publisher.name` format. */
  id: string;
  /** Human-readable tab label shown in the Settings nav. */
  label: string;
  /**
   * Icon ID from the app icon set (e.g. `'settings'`, `'blocks'`, `'code'`).
   * Falls back to a generic blocks icon when omitted.
   */
  icon?: string;
}

// ── Settings Tab Content (pushed at runtime) ──────────────────────────────────

/**
 * Full content of an extension settings tab, pushed via
 * `api.settings.updateTabContent(tabId, content)`.
 */
export interface SettingsTabContent {
  sections: SettingsSection[];
}

/** A named section grouping related settings items. */
export interface SettingsSection {
  id: string;
  title?: string;
  description?: string;
  items: SettingsItem[];
}

/**
 * A single item inside a settings section.
 * The `type` discriminant controls rendering and which extra fields apply.
 */
export type SettingsItem =
  | SettingsHeadingItem
  | SettingsSeparatorItem
  | SettingsToggleItem
  | SettingsTextItem
  | SettingsNumberItem
  | SettingsSelectItem
  | SettingsButtonItem
  | SettingsColorItem;

interface SettingsItemBase {
  id: string;
  label?: string;
  description?: string;
}

/** A bold heading line with no interactive control. */
export interface SettingsHeadingItem extends SettingsItemBase {
  type: 'heading';
}

/** A visual divider between item groups. */
export interface SettingsSeparatorItem extends SettingsItemBase {
  type: 'separator';
}

/** Boolean toggle (pill switch). Reads/writes `settingKey` via the settings API. */
export interface SettingsToggleItem extends SettingsItemBase {
  type: 'toggle';
  settingKey: string;
  default?: boolean;
}

/** Single-line or multi-line text input. */
export interface SettingsTextItem extends SettingsItemBase {
  type: 'text';
  settingKey: string;
  default?: string;
  placeholder?: string;
  multiline?: boolean;
}

/** Numeric slider + number input. */
export interface SettingsNumberItem extends SettingsItemBase {
  type: 'number';
  settingKey: string;
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

/** Dropdown selector from a fixed set of options. */
export interface SettingsSelectItem extends SettingsItemBase {
  type: 'select';
  settingKey: string;
  default?: string;
  options: Array<{ value: string; label: string }>;
}

/** Action button that dispatches a command registered by the extension. */
export interface SettingsButtonItem extends SettingsItemBase {
  type: 'button';
  /** Text on the button face. Defaults to `label`. */
  buttonLabel?: string;
  command: string;
  commandArgs?: unknown[];
  /** `'danger'` renders the button in destructive (red) styling. */
  variant?: 'default' | 'danger';
}

/** Color picker input. */
export interface SettingsColorItem extends SettingsItemBase {
  type: 'color';
  settingKey: string;
  default?: string;
}

// ── Extension Context (received by extension in activate()) ─────────────────

export interface ExtensionContext {
  extensionPath: string;
  extensionName: string;
  subscriptions: Disposable[];
  globalState: ExtensionMemento;
  workspaceState: ExtensionMemento;
}

export interface ExtensionMemento {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

// ── Terminal API ─────────────────────────────────────────────────────────────

export interface TerminalAPI {
  /** Send a command string to the active terminal, pressing Enter afterwards. */
  sendToActive(command: string): Promise<void>;
}

// ── Process API ──────────────────────────────────────────────────────────────

export interface ProcessAPI {
  /** Run a program and capture stdout. Rejects with stderr on non-zero exit. */
  exec(program: string, args: string[], cwd?: string): Promise<string>;
}

// ── HysCode API (injected into extensions) ──────────────────────────────────

export interface HyscodeAPI {
  workspace: WorkspaceAPI;
  commands: CommandsAPI;
  window: WindowAPI;
  editor: EditorAPI;
  settings: SettingsAPI;
  git: GitAPI;
  themes: ThemesAPI;
  iconThemes: IconThemesAPI;
  languages: LanguagesAPI;
  notifications: NotificationsAPI;
  extensions: ExtensionsManagerAPI;
  ui: UiAPI;
  views: ViewsAPI;
  terminal: TerminalAPI;
  process: ProcessAPI;
}

// ── Workspace API ────────────────────────────────────────────────────────────

export interface WorkspaceAPI {
  rootPath: string | null;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<FileEntry[]>;
  onDidOpenFile(handler: (path: string) => void): Disposable;
  onDidSaveFile(handler: (path: string) => void): Disposable;
  onDidCloseFile(handler: (path: string) => void): Disposable;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

// ── Commands API ─────────────────────────────────────────────────────────────

export interface CommandsAPI {
  /** Alias for registerCommand — preferred shorthand used by extensions */
  register(id: string, handler: (...args: unknown[]) => unknown): Disposable;
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable;
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  getCommands(): string[];
}

// ── Window API ───────────────────────────────────────────────────────────────

export interface WindowAPI {
  showInformationMessage(message: string, ...actions: string[]): Promise<string | undefined>;
  showWarningMessage(message: string, ...actions: string[]): Promise<string | undefined>;
  showErrorMessage(message: string, ...actions: string[]): Promise<string | undefined>;
  createStatusBarItem(options: StatusBarItemOptions): StatusBarItem;
  registerViewProvider(viewId: string, provider: ViewProvider): Disposable;
  showQuickPick(items: QuickPickItem[], options?: QuickPickOptions): Promise<QuickPickItem | undefined>;
  showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
}

export interface StatusBarItemOptions {
  id: string;
  text: string;
  tooltip?: string;
  command?: string;
  alignment?: 'left' | 'right';
  priority?: number;
}

export interface StatusBarItem extends Disposable {
  id: string;
  text: string;
  tooltip?: string;
  command?: string;
  show(): void;
  hide(): void;
  update(options: Partial<StatusBarItemOptions>): void;
}

export interface ViewProvider {
  render(): HTMLElement | string;
  onVisibilityChange?(visible: boolean): void;
}

// ── Rich View System ─────────────────────────────────────────────────────────

/** Full view content pushed by extensions to their sidebar panels. */
export interface ViewContent {
  /** Toolbar actions rendered at the top of the view. */
  toolbar?: ViewAction[];
  /** Whether to show a search/filter bar. */
  searchable?: boolean;
  /** Placeholder text for the search bar. */
  searchPlaceholder?: string;
  /** Badge shown on the activity bar icon for this view. */
  badge?: { count: number; tooltip?: string };
  /** The layout type for this view's content. */
  type: 'tree' | 'list' | 'sections' | 'welcome';
  /** Tree/list items (for type 'tree' or 'list'). */
  items?: ViewItem[];
  /** Rich sections (for type 'sections'). */
  sections?: ViewSection[];
  /** Welcome / empty state content (for type 'welcome'). */
  welcome?: ViewWelcome;
  /** Footer shown at the bottom of the view. */
  footer?: { text: string; command?: string };
}

/** A collapsible section within a 'sections' view. */
export interface ViewSection {
  id: string;
  title: string;
  collapsible?: boolean;
  collapsed?: boolean;
  badge?: string;
  badgeColor?: string;
  /** Content type within this section. */
  type: 'tree' | 'list' | 'stats' | 'actions' | 'progress';
  /** Items for tree/list sections. */
  items?: ViewItem[];
  /** Key-value stats displayed as a grid. */
  stats?: ViewStat[];
  /** Action buttons displayed in a row. */
  actions?: ViewAction[];
  /** Progress bar (0-100 or indeterminate). */
  progress?: { value?: number; label?: string };
}

/** A stat card within a 'stats' section. */
export interface ViewStat {
  label: string;
  value: string | number;
  color?: string;
  icon?: string;
  command?: string;
}

/** A single item in a tree or list. */
export interface ViewItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  badge?: string;
  badgeColor?: string;
  tooltip?: string;
  command?: string;
  commandArgs?: unknown[];
  contextMenu?: ViewAction[];
  children?: ViewItem[];
  /** Visual decorations applied to the label. */
  decorations?: {
    strikethrough?: boolean;
    faded?: boolean;
    italic?: boolean;
    bold?: boolean;
    color?: string;
  };
}

/** A toolbar/action button. */
export interface ViewAction {
  id: string;
  label: string;
  icon?: string;
  tooltip?: string;
  command: string;
  commandArgs?: unknown[];
}

/** Welcome/empty state shown when there's no content. */
export interface ViewWelcome {
  icon?: string;
  title: string;
  description?: string;
  actions?: ViewAction[];
}

// ── Views API (injected into extensions) ─────────────────────────────────────

export interface ViewsAPI {
  /** Push full content to a view panel. Replaces previous content. */
  updateView(viewId: string, content: ViewContent): void;
  /** Set the badge on a view's activity bar icon. */
  setViewBadge(viewId: string, badge: { count: number; tooltip?: string } | null): void;
  /** Listen for search input changes in a view's search bar. */
  onDidChangeSearch(viewId: string, handler: (query: string) => void): Disposable;
  /** Listen for visibility changes of a view panel. */
  onDidChangeVisibility(viewId: string, handler: (visible: boolean) => void): Disposable;
  /** Reveal/focus a specific view in the sidebar. */
  revealView(viewId: string): void;
}

// ── Editor API ───────────────────────────────────────────────────────────────

export interface EditorAPI {
  activeFilePath: string | null;
  openFile(path: string): Promise<void>;
  getSelectedText(): string | null;
  insertText(text: string): void;
  addDecorations(
    filePath: string,
    decorations: EditorDecoration[],
  ): Disposable;
}

export interface EditorDecoration {
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  options: {
    className?: string;
    inlineClassName?: string;
    hoverMessage?: string;
    isWholeLine?: boolean;
    glyphMarginClassName?: string;
  };
}

// ── Settings API ─────────────────────────────────────────────────────────────

export interface SettingsAPI {
  get<T>(key: string, defaultValue?: T): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  onDidChange(key: string, handler: (newValue: unknown) => void): Disposable;
  /**
   * Push declarative content to a settings tab contributed by this extension.
   * `tabId` must match an entry in `contributes.settingsTabs[].id`.
   * Calling this again replaces the previous content.
   */
  updateTabContent(tabId: string, content: SettingsTabContent): void;
  /**
   * Subscribe to the moment the user navigates to this extension's settings tab.
   * Useful for lazy-loading data before rendering.
   */
  onTabVisible(tabId: string, handler: () => void): Disposable;
}

// ── Git API ──────────────────────────────────────────────────────────────────

export interface GitAPI {
  currentBranch(): Promise<string | null>;
  status(): Promise<GitFileStatus[]>;
  diff(staged?: boolean): Promise<string>;
  onDidChangeBranch(handler: (branch: string) => void): Disposable;
}

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
}

// ── Themes API ───────────────────────────────────────────────────────────────

export interface ThemesAPI {
  registerTheme(theme: ThemeDefinition): Disposable;
  getActiveThemeId(): string;
}

// ── Icon Themes API ──────────────────────────────────────────────────────────

export interface IconThemesAPI {
  /**
   * Register a data-URL SVG icon for one or more file extensions.
   * `extensions` should be without a leading dot (e.g. `['ts', 'tsx']`).
   * Lower-priority than a full active icon theme pack; used as fallback.
   */
  registerFileExtensionIcon(extensions: string[], svgDataUrl: string): Disposable;
  /**
   * Register a data-URL SVG icon for one or more exact file names.
   * Lower-priority than a full active icon theme pack; used as fallback.
   */
  registerFileNameIcon(fileNames: string[], svgDataUrl: string): Disposable;
  /** Returns the id of the currently active icon theme (`'default'` for built-ins). */
  getActiveIconThemeId(): string;
  /** Subscribe to icon theme changes. */
  onDidChangeIconTheme(handler: (themeId: string) => void): Disposable;
}

// ── Languages API ────────────────────────────────────────────────────────────

export interface LanguagesAPI {
  registerLanguage(language: LanguageRegistration): Disposable;
  registerLanguageServer(config: LspContribution): Disposable;
  setLanguageDiagnostics(uri: string, diagnostics: Diagnostic[]): void;
}

export interface LanguageRegistration {
  id: string;
  extensions?: string[];
  aliases?: string[];
  mimetypes?: string[];
}

export interface Diagnostic {
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source?: string;
  code?: string | number;
}

// ── Extension Module Shape ───────────────────────────────────────────────────

export interface ExtensionModule {
  activate(context: ExtensionContext, api?: HyscodeAPI): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

// ── Notifications API ────────────────────────────────────────────────────────

export interface NotificationsAPI {
  showInfo(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
  showProgress(title: string, task: (progress: ProgressReporter) => Promise<void>): void;
}

export interface ProgressReporter {
  report(options: { message?: string; increment?: number }): void;
}

// ── Extensions Manager API ───────────────────────────────────────────────────

export interface ExtensionsManagerAPI {
  getExtension(name: string): ExtensionInfo | undefined;
  getAllExtensions(): ExtensionInfo[];
  onDidChange(handler: (extensions: ExtensionInfo[]) => void): Disposable;
}

export interface ExtensionInfo {
  name: string;
  displayName: string;
  version: string;
  publisher: string;
  enabled: boolean;
  isActive: boolean;
}

// ── UI API — Extensions can modify the IDE interface ─────────────────────────

export interface UiAPI {
  /**
   * Register a context menu item that appears in the editor right-click menu.
   */
  registerContextMenuItem(item: ExtensionContextMenuItem): Disposable;

  /**
   * Register a document formatter for one or more language IDs.
   * When the user triggers "Format Document", the formatter is called.
   */
  registerDocumentFormatter(formatter: DocumentFormatter): Disposable;

  /**
   * Register a status bar item that can display dynamic content.
   */
  registerStatusBarItem(item: ExtensionStatusBarItem): Disposable;

  /**
   * Register a custom panel (webview-like) in a sidebar slot.
   */
  registerPanel(panel: ExtensionPanel): Disposable;

  /**
   * Register a toolbar action in the editor title bar area.
   */
  registerToolbarAction(action: ExtensionToolbarAction): Disposable;

  /**
   * Show a quick-pick style modal from the extension.
   */
  showQuickPick(items: QuickPickItem[], options?: QuickPickOptions): Promise<QuickPickItem | undefined>;

  /**
   * Show an input box from the extension.
   */
  showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
}

export interface ExtensionContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  group?: 'navigation' | 'modification' | 'formatting' | 'other';
  when?: string;
  order?: number;
  handler: (context: MenuActionContext) => void | Promise<void>;
}

export interface MenuActionContext {
  filePath: string | null;
  languageId: string | null;
  selectedText: string | null;
  cursorLine: number;
  cursorColumn: number;
}

export interface DocumentFormatter {
  id: string;
  displayName: string;
  languageIds: string[];
  format: (params: FormatParams) => Promise<string>;
}

export interface FormatParams {
  content: string;
  filePath: string;
  languageId: string;
  tabSize: number;
  insertSpaces: boolean;
  selection?: { startLine: number; endLine: number };
}

export interface ExtensionStatusBarItem {
  id: string;
  text: string;
  tooltip?: string;
  command?: string;
  alignment?: 'left' | 'right';
  priority?: number;
  update(options: { text?: string; tooltip?: string }): void;
}

export interface ExtensionPanel {
  id: string;
  title: string;
  icon?: string;
  location: 'sidebar' | 'bottom';
  render: () => string;
  onMessage?: (message: unknown) => void;
}

export interface ExtensionToolbarAction {
  id: string;
  label: string;
  icon?: string;
  tooltip?: string;
  handler: () => void | Promise<void>;
}

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  value?: string;
  icon?: string;
}

export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
  canSelectMany?: boolean;
}

export interface InputBoxOptions {
  title?: string;
  placeholder?: string;
  value?: string;
  prompt?: string;
  validateInput?: (value: string) => string | undefined;
}

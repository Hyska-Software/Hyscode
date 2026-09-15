# Frontend Architecture

## Overview

The frontend is a React 19 SPA running inside Tauri's WebView. It uses shadcn/ui for components, Tailwind v4 for styling, Zustand for state, and Monaco Editor for code editing.

---

## Desktop Bootstrap and Development Profile

`apps/desktop/index.html` loads `apps/desktop/public/boot.js` before the React
module. The bootstrap layer renders a solid loading surface with an
indeterminate progress bar and rotating status copy. It remains visible until
React calls `ready()` after mounting; it intentionally has no timeout or error
panel. This keeps the startup surface quiet while the local interface is
initializing instead of showing a second recovery flow.

The bootstrap surface also renders temporary window controls. The controls
module uses the same Tauri window API as the main titlebar for minimize,
maximize/restore, and close, while the top drag region uses
`data-tauri-drag-region` so the window can be moved before React mounts.

The desktop development launcher applies the isolated Tauri identifier
`com.hyscode.dev` through a dev-only configuration merge. This keeps the
WebView2 profile used by `npm run dev` separate from the installed
`com.hyscode.app` profile, avoiding shared browser-cache state between an
installed release and a local build. Set `HYSCODE_TAURI_DEV_IDENTIFIER` when a
different local profile is required.

Development also passes `--disable-http-cache` to WebView2 while preserving any
existing `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. This prevents a stale Vite
optimized module from being reused after dependency or version changes.

The version bump script validates this identity boundary before and after a
bump. It never derives the production identifier from the version, because
doing so would break installation and application-data continuity.

The Rust database path remains the shared HysCode data directory; the
identifier isolation is specifically for the desktop WebView2 profile and its
cache/session state.

---

## Application Shell Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Title Bar (Tauri custom)                               [─ □ ✕]    │
├──────┬──────────────────────────────────────┬───────────────────────┤
│      │  Tab Bar                             │                       │
│      │  [file.ts] [index.tsx] [+]           │   Agent Panel         │
│      ├──────────────────────────────────────┤                       │
│ File │                                      │   ┌─────────────────┐ │
│ Tree │         Monaco Editor                │   │  Chat Messages  │ │
│      │                                      │   │  Tool Calls     │ │
│      │                                      │   │  Context Chips  │ │
│      │                                      │   └─────────────────┘ │
│      │                                      │   ┌─────────────────┐ │
│      │                                      │   │  Input Bar      │ │
│      │                                      │   │  [Send] [Mode]  │ │
├──────┴──────────────────────────────────────┤   └─────────────────┘ │
│  Terminal Panel (xterm.js)                  │                       │
│  $ pnpm dev                                 │                       │
│  > ready on http://localhost:3000           │                       │
├─────────────────────────────────────────────┴───────────────────────┤
│  Status Bar: branch • line:col • language • AI model • tokens       │
└─────────────────────────────────────────────────────────────────────┘
```

### Panel System

- All panels are **resizable** via drag handles (react-resizable-panels)
- All panels are **collapsible** (toggle via keyboard shortcut or button)
- Panel layout state persisted in `layoutStore`
- Default ratios: File Tree 15% | Editor 50% | Agent 35%

Terminal docking, visibility, active sidebar tab, the editor/bottom-terminal split,
and the right-panel width are persisted per project root in
`layoutStore.terminalLayoutPrefs`. Opening or switching a project restores that
project's terminal layout; projects without a stored record inherit the previous
terminal visibility and use the default sizes.

### VORTEX Right Surface Tabs

VORTEX uses `AgentRightPanel` for project-aware right-side surfaces: Changes,
Context, Files, Preview, and Terminal. `layoutStore.agentRightTabPrefs` owns
the order and visibility of these surfaces, persisted by project root path so
one VORTEX project cannot overwrite another project's presentation state.

Each visible surface can be closed independently. The active surface is held in
`layoutStore.agentRightTab`; it is `null` when every surface is closed. In that
state the panel renders an open-surface grid that lists every supported surface
and opens the selected one through the same store action used by the tab strip
and surface menu. Programmatic Preview and Changes navigation also reopens and
activates the corresponding surface.

---

## Component Hierarchy

```
<App>
  <ThemeProvider>
    <TauriTitleBar />
    <PanelGroup direction="horizontal">
      <Panel id="sidebar" defaultSize={15}>
        <SidebarNav />                  // Activity bar icons
        <FileTreePanel />               // Virtual file tree
        <SearchPanel />                 // Workspace search (hidden by default)
        <GitPanel />                    // Git status (hidden by default)
        <ExtensionsPanel />             // Skills/MCP (hidden by default)
      </Panel>
      <PanelResizeHandle />
      <Panel id="main">
        <PanelGroup direction="vertical">
          <Panel id="editor">
            <TabBar />                  // Open file tabs
            <EditorPanel />             // Monaco Editor instance
          </Panel>
          <PanelResizeHandle />
          <Panel id="terminal" defaultSize={25}>
            <TerminalTabs />            // Multiple terminal sessions
            <TerminalPanel />           // xterm.js
          </Panel>
        </PanelGroup>
      </Panel>
      <PanelResizeHandle />
      <Panel id="agent" defaultSize={35}>
        <AgentPanel />
          <AgentHeader />              // Model selector, mode toggle
          <MessageThread />            // Chat messages list
          <ToolCallCard />             // Expandable tool execution cards
          <ContextChips />             // Files/symbols in context
          <AgentInput />               // Textarea + send button
      </Panel>
    </PanelGroup>
    <StatusBar />
  </ThemeProvider>
</App>
```

---

## Zustand Stores

### editorStore

```typescript
interface EditorStore {
  // State
  tabs: Tab[]; // { id, path, language, isDirty }
  activeTabId: string | null;
  cursorPositions: Map<string, Position>; // per-tab cursor memory

  // Actions
  openFile(path: string): Promise<void>;
  closeTab(tabId: string): void;
  setActiveTab(tabId: string): void;
  updateBuffer(tabId: string, content: string): void;
  saveFile(tabId: string): Promise<void>;
  saveAll(): Promise<void>;
}
```

### fileStore

```typescript
interface FileStore {
  // State
  rootPath: string | null;
  tree: FileNode[]; // { name, path, type, children? }
  expandedDirs: Set<string>;
  fileContentCache: Map<string, string>;

  // Actions
  openFolder(path: string): Promise<void>;
  refreshTree(): Promise<void>;
  toggleDir(path: string): void;
  getFileContent(path: string): Promise<string>;
  handleFsEvent(event: FsChangeEvent): void;
}
```

### agentStore

```typescript
interface AgentStore {
  // State
  conversations: Conversation[];
  activeConversationId: string | null;
  isStreaming: boolean;
  pendingToolCalls: ToolCall[];
  mode: 'chat' | 'build' | 'review';

  // Actions
  sendMessage(content: string, attachments?: ContextAttachment[]): Promise<void>;
  cancelStream(): void;
  approveToolCall(toolCallId: string): void;
  rejectToolCall(toolCallId: string, reason?: string): void;
  setMode(mode: 'chat' | 'build' | 'review'): void;
  newConversation(): void;
}
```

### settingsStore

```typescript
interface SettingsStore {
  // State
  theme: 'dark' | 'light' | 'system';
  aiProvider: string; // active provider id
  aiModel: string; // active model id
  providerConfigs: Map<string, ProviderConfig>;
  editorSettings: EditorSettings; // fontSize, tabSize, wordWrap, etc.
  agentSettings: AgentSettings; // autoApprove, maxTokens, temperature
  panelLayout: PanelLayoutConfig;
  keybindings: Keybinding[];

  // Actions
  updateSetting<K extends keyof SettingsStore>(key: K, value: SettingsStore[K]): void;
  loadSettings(): Promise<void>;
  saveSettings(): Promise<void>;
}
```

### projectStore

```typescript
interface ProjectStore {
  // State
  activeProject: Project | null;
  recentProjects: Project[];

  // Actions
  openProject(path: string): Promise<void>;
  closeProject(): void;
  getProjectConfig(): ProjectConfig;
}
```

---

## Monaco Editor Integration

### Lazy Loading

```typescript
// Only import Monaco when editor panel mounts
const MonacoEditor = lazy(() => import('@monaco-editor/react'));
```

### Configuration

- **Theme**: custom dark theme matching shadcn/ui Zinc palette
- **Languages**: TypeScript, JavaScript, Python, Rust, Go, JSON, Markdown, HTML, CSS (built-in)
- **Font**: Geist Mono, 14px, ligatures enabled
- **Features**: minimap, bracket colorization, indent guides, word wrap toggle

### Agent Edit Visualization

- Agent edits appear as **diff decorations** (green for additions, red for deletions)
- Real-time streaming: characters appear with a "typing cursor" effect
- Each agent edit creates an **undo checkpoint** so user can revert individual agent edits
- Diff view toggle: side-by-side before/after for any agent edit

### LSP Document URIs

Editor models are created with canonical `file:` URIs (`pathToFileUri` from
`@hyscode/lsp-client`) instead of raw filesystem paths. `monaco.Uri.parse` of a
Windows path produces a one-letter scheme with percent-encoded backslashes
(`D:/x%5Cy.rs`), which LSP servers reject with `url is not a file`. The Monaco
adapter normalizes every model URI before sending requests and skips models that
are not backed by a real file (history snapshots, diff/in-memory models,
untitled buffers). `textDocument/inlayHint` requests forward the visible range
required by servers such as rust-analyzer.

---

## Terminal Integration

- **xterm.js** + `@xterm/addon-fit` + `@xterm/addon-webgl`
- Backend: Tauri PTY commands (`pty_spawn`, `pty_write`, `pty_resize`)
- Multiple terminal instances with tabs
- Captures last command output for agent context
- Agent can write to terminal via `run_terminal_command` tool
- Interactive prompts surface as `awaiting_input`; approved agent responses resume the same PTY
- Users may type into a waiting agent terminal unless approval mode is `Auto-approve`
- Agent terminals are owned by a conversation through the desktop terminal runtime adapter
- xterm attaches with listen-before-snapshot replay and never owns PTY process lifetime
- Terminal tool cards stream a bounded output tail without moving focus away from chat
- `@terminal` attaches a one-turn sanitized snapshot of the active terminal

---

## Routing

Using **TanStack Router** for type-safe routing:

```
/                          → EditorView (default)
/settings                  → SettingsView
/settings/ai               → AI Provider Settings
/settings/keybindings      → Keybinding Editor
/welcome                   → Welcome/Onboarding
```

Most navigation is panel-based (not route-based). Routes are used for full-page views only.

---

## Build Pipeline

The production frontend is built with Vite 6 (`vite build`) from `apps/desktop`.

### Build Target

`build.target` is pinned to `['es2021', 'edge88', 'firefox79', 'chrome87', 'safari14']`
in `apps/desktop/vite.config.ts`. This keeps the same browser baseline as Vite's
default `'modules'` target while preventing esbuild from lowering logical
assignment operators (`||=`, `&&=`, `??=`). esbuild 0.25.x miscompiles a lowered
logical assignment whose target variable is dead into an undeclared reference
(`(void 0 || (i = {}))` without the `let`), which produced
`ReferenceError: i is not defined` in xterm's `InputHandler.requestMode` whenever a
terminal application sent a DECRQM sequence (`CSI Ps $ p`).

`scripts/verify-frontend-bundle.mjs` runs after `vite build` (wired into the
`@hyscode/desktop` build script) and fails the build if the broken pattern
reappears in `dist/assets/index-*.js`.

> esbuild 0.28.2 fixes the minifier bug, but it is incompatible with Vite 6.4.2
> in this project (it aborts on destructuring lowering for the Monaco bundle), so
> the dependency version is intentionally not overridden.

---

## Performance Patterns

1. **Code splitting**: Monaco, terminal, settings loaded lazily
2. **Virtual scrolling**: file tree and chat messages use virtualized lists
3. **Debounced saves**: file writes debounced 300ms after last keystroke
4. **Selective re-renders**: Zustand selectors prevent unnecessary component updates
5. **Web Workers**: syntax highlighting, file search run off main thread
6. **Image optimization**: all icons are SVG, no raster images

---

## Theming

### CSS Variables (shadcn/ui tokens)

```css
:root {
  /* Dark theme (default) */
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --card-foreground: 0 0% 98%;
  --popover: 240 10% 3.9%;
  --popover-foreground: 0 0% 98%;
  --primary: 217 91% 60%; /* Electric Blue #3B82F6 */
  --primary-foreground: 0 0% 100%;
  --secondary: 240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%;
  --ring: 217 91% 60%;
  --radius: 0.5rem;
}
```

### Typography

- **UI text**: Geist Sans (400, 500, 600)
- **Code/Editor**: Geist Mono (400, 500)
- **Headings**: Geist Sans 600, tracking-tight
- **Body**: 14px base, relaxed line-height

---

## Keyboard Shortcuts

| Action             | Shortcut                        |
| ------------------ | ------------------------------- |
| Open file          | `Ctrl+P`                        |
| Command palette    | `Ctrl+Shift+P`                  |
| Toggle terminal    | `` Ctrl+` ``                    |
| Toggle agent panel | `Ctrl+Shift+A`                  |
| Toggle file tree   | `Ctrl+B`                        |
| Save file          | `Ctrl+S`                        |
| New agent chat     | `Ctrl+Shift+N`                  |
| Focus agent input  | `Ctrl+L`                        |
| Accept agent edit  | `Ctrl+Enter` (in diff view)     |
| Reject agent edit  | `Ctrl+Backspace` (in diff view) |

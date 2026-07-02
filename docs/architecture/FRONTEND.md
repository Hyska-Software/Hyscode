# Frontend Architecture

## Overview

The frontend is a React 19 SPA running inside Tauri's WebView. It uses shadcn/ui for components, Tailwind v4 for styling, Zustand for state, and Monaco Editor for code editing.

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
- Panel layout state persisted in `settingsStore`
- Default ratios: File Tree 15% | Editor 50% | Agent 35%

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

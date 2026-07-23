# Editor Specification

## Overview

The editor is the central panel of HysCode, built on **Monaco Editor** (the same engine powering VS Code). It provides syntax highlighting, IntelliSense, multi-tab editing, diff view, and real-time agent edit visualization.

---

## Monaco Editor Configuration

### Base Setup

```typescript
const editorOptions: editor.IStandaloneEditorConstructionOptions = {
  theme: 'hyscode-dark',
  fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
  fontSize: 14,
  fontLigatures: true,
  lineNumbers: 'on',
  minimap: { enabled: true, maxColumn: 80 },
  bracketPairColorization: { enabled: true },
  guides: { indentation: true, bracketPairs: true },
  wordWrap: 'off',                        // togglable via settings
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorSmoothCaretAnimation: 'on',
  padding: { top: 12, bottom: 12 },
  renderWhitespace: 'selection',
  tabSize: 2,                             // configurable
  insertSpaces: true,
  automaticLayout: true,                  // auto-resize with panel
};
```

### Custom Dark Theme

```typescript
editor.defineTheme('hyscode-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'keyword', foreground: '818cf8' },                      // indigo-400
    { token: 'string', foreground: '34d399' },                       // emerald-400
    { token: 'number', foreground: 'fb923c' },                       // orange-400
    { token: 'type', foreground: '38bdf8' },                         // sky-400
    { token: 'function', foreground: '3b82f6' },                     // blue-500
    { token: 'variable', foreground: 'e5e7eb' },                     // gray-200
  ],
  colors: {
    'editor.background': '#0a0a0b',                                  // zinc-950
    'editor.foreground': '#e5e7eb',                                  // gray-200
    'editor.selectionBackground': '#3b82f633',                       // blue-500/20
    'editor.lineHighlightBackground': '#18181b',                     // zinc-900
    'editorCursor.foreground': '#3b82f6',                            // blue-500
    'editorLineNumber.foreground': '#52525b',                        // zinc-600
    'editorLineNumber.activeForeground': '#a1a1aa',                  // zinc-400
    'editor.selectionHighlightBackground': '#3b82f622',
    'editorBracketMatch.background': '#3b82f633',
    'editorBracketMatch.border': '#3b82f6',
  }
});
```

---

## Tab System

### Tab Component

```
┌────────────────┬────────────────┬──────┐
│ ● file.ts  ✕  │  index.tsx  ✕  │  +   │
└────────────────┴────────────────┴──────┘
```

- **Dirty indicator**: filled dot (●) for unsaved changes
- **Close button**: (✕) appears on hover, always visible for active tab
- **Tab overflow**: horizontal scroll when too many tabs, no wrapping
- **Tab context menu**: Close, Close Others, Close All, Copy Path, Reveal in File Tree
- **Tab drag**: reorder tabs by dragging
- **Tab limit**: configurable max open tabs (default: 20), oldest auto-closed

### Tab State

```typescript
interface Tab {
  id: string;                             // unique tab ID
  path: string;                           // absolute file path
  language: string;                       // Monaco language ID
  isDirty: boolean;                       // has unsaved changes
  isPreview: boolean;                     // single-click preview (italic title)
  viewState: editor.ICodeEditorViewState; // cursor, scroll position
}
```

---

## Virtual File System

The Editor operates on a **virtual file system** that caches file contents in memory and syncs with disk via Tauri commands.

```typescript
interface VirtualFS {
  // Read file from disk (with cache)
  readFile(path: string): Promise<string>;

  // Write buffer to disk
  writeFile(path: string, content: string): Promise<void>;

  // Patch file (for agent edits - atomic find/replace on disk)
  patchFile(path: string, oldText: string, newText: string): Promise<PatchResult>;

  // Watch for external changes
  watchFile(path: string, callback: (event: FsChangeEvent) => void): Disposable;

  // Invalidate cache when external change detected
  invalidateCache(path: string): void;
}
```

### External Change Detection
When a file is modified outside HysCode (e.g., by git, another editor):
1. Tauri FS watcher detects change → emits `fs:changed` event
2. VirtualFS invalidates cache for that path
3. If file is open in a tab:
   - If no unsaved changes: silently reload
   - If has unsaved changes: show notification "File changed on disk. Reload?"

---

## Language Support

### Built-in (Monaco)
TypeScript, JavaScript, JSON, HTML, CSS, SCSS, Less, Markdown, XML, YAML, Python, Go, Rust, C, C++, Java, PHP, Ruby, Swift, Kotlin, SQL

### Language Server Protocol (LSP)

For MVP, LSP is **not** included. Monaco's built-in IntelliSense covers:
- TypeScript/JavaScript: full type checking, go-to-definition, autocomplete
- JSON: schema validation
- HTML/CSS: tag/property autocomplete

**Future (post-MVP)**: LSP client connecting to language servers via Tauri subprocess management.

---

## Agent Edit Visualization

When the agent modifies a file, the editor shows real-time streaming edits.

### Streaming Edit UX

1. **Agent starts editing**: file's tab pulses with blue dot indicator
2. **Edit region highlighted**: the lines being modified get a subtle blue background glow
3. **Characters stream in**: text appears character-by-character with a "ghost cursor"
4. **Edit complete**: glow fades, diff decorations appear (green for additions, red background for deletions)
5. **Undo checkpoint**: each complete agent edit creates a single undo checkpoint (Ctrl+Z reverts entire edit)

### Diff Decorations

```typescript
// After agent edit, add decorations to show what changed
const decorations = editor.deltaDecorations([], [
  {
    range: new Range(startLine, 1, endLine, 1),
    options: {
      isWholeLine: true,
      className: 'agent-edit-added',      // bg-blue-500/10, left border blue
      glyphMarginClassName: 'agent-edit-glyph',
      glyphMarginHoverMessage: { value: 'Modified by agent' },
    }
  }
]);
```

### Diff View Toggle

User can toggle a full diff view for any agent edit:
- Split view: original (left) vs modified (right)
- **Accept**: keep the changes (default after 30s)
- **Reject**: revert to original via undo checkpoint
- **Edit**: switch to normal edit mode to manually adjust agent's changes

---

## Split Editor

- **Vertical split**: divide editor into left/right panes
- **Horizontal split**: divide into top/bottom panes
- Maximum 4 editor panes (2×2 grid)
- Each pane has its own tab bar
- Drag tabs between panes

---

## Keyboard Shortcuts (Editor-Specific)

| Action | Shortcut |
|---|---|
| Go to file | `Ctrl+P` |
| Go to symbol | `Ctrl+Shift+O` |
| Go to line | `Ctrl+G` |
| Find | `Ctrl+F` |
| Find and replace | `Ctrl+H` |
| Toggle word wrap | `Alt+Z` |
| Toggle minimap | (settings only) |
| Split editor right | `Ctrl+\` |
| Close tab | `Ctrl+W` |
| Next tab | `Ctrl+Tab` |
| Previous tab | `Ctrl+Shift+Tab` |
| Format document | `Shift+Alt+F` |
| Toggle comment | `Ctrl+/` |

---

## Performance Requirements

| Metric | Target |
|---|---|
| Editor mount time | < 500ms (lazy loaded) |
| File open time (< 1MB) | < 100ms |
| File open time (1-10MB) | < 500ms |
| Keystroke latency | < 16ms (60fps) |
| Search results (10k files) | < 2 seconds |
| Agent edit streaming | Real-time, no visible lag |

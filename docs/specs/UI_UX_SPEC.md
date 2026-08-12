# UI/UX Specification

## Design Philosophy

> "A tool that feels like an extension of the developer's mind — fast, focused, and invisible when it's working."

HysCode's design is **dark-first**, **information-dense but breathable**, and built for long coding sessions. The AI agent is a first-class UI citizen, not a bolted-on sidebar.

---

## Design Tokens

### Colors

```css
/* Base palette: Zinc */
--zinc-950: #09090b;    /* app background */
--zinc-900: #18181b;    /* panel backgrounds, cards */
--zinc-800: #27272a;    /* elevated surfaces, hover states */
--zinc-700: #3f3f46;    /* borders, separators */
--zinc-600: #52525b;    /* disabled text, line numbers */
--zinc-500: #71717a;    /* placeholder text */
--zinc-400: #a1a1aa;    /* secondary text */
--zinc-300: #d4d4d8;    /* primary text (body) */
--zinc-200: #e4e4e7;    /* primary text (headings) */
--zinc-100: #f4f4f5;    /* emphasis text */
--zinc-50:  #fafafa;    /* max contrast text */

/* Accent: Electric Blue */
--blue-500: #3b82f6;    /* primary accent, links, active states */
--blue-400: #60a5fa;    /* hover accent */
--blue-600: #2563eb;    /* pressed accent */
--blue-500-20: #3b82f633; /* selection backgrounds */

/* Semantic */
--success: #22c55e;     /* green-500: completed, passed */
--warning: #f59e0b;     /* amber-500: warnings, pending */
--error: #ef4444;       /* red-500: errors, failed */
--info: #3b82f6;        /* blue-500: info, running */
```

### Typography

```css
/* Font families */
--font-sans: 'Geist', system-ui, -apple-system, sans-serif;
--font-mono: 'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace;

/* Scale */
--text-xs:   0.75rem;   /* 12px — captions, badges */
--text-sm:   0.875rem;  /* 14px — body text, UI labels */
--text-base: 1rem;      /* 16px — input text, card titles */
--text-lg:   1.125rem;  /* 18px — section headers */
--text-xl:   1.25rem;   /* 20px — panel titles */
--text-2xl:  1.5rem;    /* 24px — page headers */

/* Body default: 14px for information density */
body { font-size: var(--text-sm); }
```

### Spacing

```css
/* 4px base unit */
--space-1:  0.25rem;  /* 4px */
--space-2:  0.5rem;   /* 8px */
--space-3:  0.75rem;  /* 12px */
--space-4:  1rem;     /* 16px */
--space-5:  1.25rem;  /* 20px */
--space-6:  1.5rem;   /* 24px */
--space-8:  2rem;     /* 32px */
```

### Borders & Radius

```css
--radius-sm:  0.25rem;  /* 4px — small elements, badges */
--radius-md:  0.375rem; /* 6px — buttons, inputs */
--radius-lg:  0.5rem;   /* 8px — cards, panels */
--radius-xl:  0.75rem;  /* 12px — modals, sheets */

--border-default: 1px solid hsl(var(--border));
```

### Shadows

```css
/* Minimal shadows — dark themes rely more on borders and background contrast */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.5);
```

---

## Layout Specifications

### Application Shell

```
Total viewport
├── Title Bar: 32px height (Tauri custom, draggable)
├── Main Content: calc(100vh - 32px - 24px)
│   ├── Sidebar: 48px activity bar + variable file tree (min 180px, max 400px)
│   ├── Editor + Terminal: flexible (min 300px)
│   │   ├── Editor: flexible (min 200px)
│   │   └── Terminal: collapsible (default 200px, min 100px)
│   └── Agent Panel: collapsible (default 380px, min 300px, max 600px)
└── Status Bar: 24px height
```

### Panel Resize Handles

- Width: 4px (1px visible line + 3px hit area)
- Hover: cursor changes to col-resize/row-resize
- Active: blue highlight line

### VORTEX Project and Session Navigator

VORTEX uses the left agent panel to federate project and session navigation while allowing
multiple isolated project/session runtimes to execute concurrently. The navigator is not a second
chat state store: selecting a project invokes the existing guarded project lifecycle when the file
workspace must change, then focuses the selected runtime into the shared agent-panel projection.
Background runtimes remain active and continue updating their own status in the navigator.

The navigator hierarchy is:

```
VORTEX sidebar
├── New session
├── Open/add project + search
├── Recent sessions (five visible by default)
└── Projects
    ├── Project header + session count + actions
    └── Sessions or "No sessions in this workspace yet"
```

- Recent sessions are globally ordered and always show their project name.
- Project groups merge durable SQLite projects with locally recent projects so empty projects are
  visible after they are opened.
- Project headers expand/collapse without activating the project; the header action menu is kept
  separate from the right-side new-session button.
- Each live session shows Starting, Queued, Running, Waiting, Stopping, Completed, Needs attention,
  or Cancelled when applicable. Active sessions can be stopped from their context menu, and failed
  sessions can be retried without affecting other runtimes.
- Starting a session creates an independent runtime, including when another session in the same
  project is already running. Switching focus never cancels a background runtime.
- Project actions can hide a project from VORTEX without deleting its folder or persisted data.
- Session rename uses the application input dialog; session deletion is confirmed
  and destructive.
- The project/session list owns the only scroll region. The toolbar and Settings/Extensions
  footer remain fixed.
- Long titles truncate with a full-title tooltip. Icon-only controls have accessible labels.
- Keyboard focus, Enter/Space activation, loading, empty, unavailable-project, retry, cancellation,
  and live-runtime status states are required.
- EDITOR does not show federated project groups and continues to manage one active project.

---

## Component Specifications

### Sidebar Activity Bar

```
┌──────┐
│  📁  │  File Explorer (active)
│  🔍  │  Search
│  🌿  │  Source Control (Git)
│  🤖  │  Skills & MCP
│  ⚙   │  Settings
└──────┘
```

- Width: 48px
- Icon size: 24px
- Active indicator: 2px left border in blue-500
- Tooltip on hover: panel name
- Icons: Phosphor Icons (regular weight, strokeWidth 1.5)
- Views nativas e contribuídas por extensões compartilham uma única ordem global persistida
- Drag-and-drop reordena qualquer view; a direção acompanha a barra à esquerda ou no topo
- Clique direito em qualquer ponto da barra abre a lista de visibilidade e a ação de restaurar
- Qualquer view pode ser ocultada, mas ao menos uma view deve permanecer visível
- O botão de Settings permanece fixo no final da barra e não participa da ordenação

### File Tree

- **Indent**: 16px per level
- **Row height**: 28px
- **Icon**: file type icon (16px) + filename
- **Hover**: zinc-800 background
- **Selected**: zinc-700 background + blue-500 left border
- **Dirty indicator**: dot after filename
- **Git status**: colored letter (M=modified yellow, A=added green, D=deleted red)
- **Virtual scroll**: only render visible nodes for large projects

### Tab Bar

- **Tab height**: 36px
- **Tab min-width**: 120px
- **Tab max-width**: 200px
- **Active tab**: zinc-950 background (matches editor), white text, bottom border blue-500
- **Inactive tab**: zinc-900 background, zinc-400 text
- **Tab separator**: 1px zinc-700 vertical line
- **Overflow**: horizontal scroll with arrow indicators

### Agent Message Thread

- **User message**: zinc-800 background bubble, right-aligned context chips below
- **Assistant message**: no background (transparent), left-aligned
- **Code blocks**: zinc-900 background, rounded-lg, copy button on hover
- **Tool call cards**: zinc-900 border, collapsible, status icon + timing
- **Streaming indicator**: pulsing blue cursor block

### Agent Input

- **Background**: zinc-900
- **Border**: zinc-700, focus: blue-500
- **Min height**: 40px (single line)
- **Max height**: 200px (auto-expand)
- **Send button**: blue-500 background, white arrow icon
- **Attach button**: zinc-400 icon, hover zinc-200
- **Stop button**: red-500, appears during streaming

### Status Bar

- **Height**: 24px
- **Background**: zinc-900
- **Text**: zinc-400, 12px
- **Sections**: branch name | cursor position | language | encoding | AI model | token count

---

## States

### Source Control

Source Control renders five repository states independently: no workspace, checking,
not a repository, ready, and error. Errors include a retry action and are never presented as
an empty or non-repository state. Requests carry the workspace root and generation so a slow
response or stale filesystem watcher cannot update a newly opened project.

The primary remote action is contextual:

- **Publish Branch** when a named branch has no upstream.
- **Sync Changes** when the upstream has incoming or outgoing commits.
- **Synchronized** when ahead and behind are both zero.

Push and pull follow the configured upstream. Remote-specific menus expose Push To, Pull
From, Fetch, Fetch All, and Fetch Prune where applicable. Conflict entries open an editable
conflict diff and staging marks the file resolved. Deleted files offer diff only. Discard
confirmation lists affected paths; deleting an untracked file is always described as
permanent and always requires confirmation.

Branch selection is searchable and includes remote-tracking branches. Normal branch deletion
is confirmed and uses Git's merged-branch protection; force deletion is a separate second
confirmation. Pull-request creation requires explicit base/head remotes, a published head
branch, and a dedicated GitHub repository token stored in the OS keychain.

AI commit-message generation is available only when staged changes exist. The model modal
lists enabled models from configured providers, preserves an unavailable saved selection
without silently choosing a replacement, and closes as soon as the user selects a model.
While generating, the generate control becomes Cancel and reports collection, provider retry,
and validation progress. Cancellation never applies partial text.

The generated message is applied automatically only while the repository, staged fingerprint,
and original draft remain unchanged. A staged change makes the response stale and requires a
new generation; editing only the draft preserves the user's text and presents the generated
message as an explicit Apply/Dismiss suggestion. Invalid provider output and provider errors
remain visible and retryable. Git Settings states that remote providers receive
repository-relative staged paths and patches, while local providers such as Ollama keep that
data on the machine.

### Desktop Kanban

Kanban is a Desktop-only surface. The Editor Activity Bar exposes `Tasks`,
while the top bar places a `Kanban` button immediately beside the File and View
menus. The same board opens as a modal from VORTEX and the agent chat; these
surfaces share the project-scoped store and never duplicate task data.

The board uses five seeded columns (`Backlog`, `To do`, `In progress`,
`Blocked`, and `Done`), draggable cards, keyboard left/right movement, search,
priority and label badges, a selected-task detail pane, activity history, and
explicit loading, empty, error, conflict, waiting, failed, and cancelled
states. Delegation displays the selected provider/model and current run state;
the chat card and VORTEX navigator link back to the same task/run.

Task cards expose the standard Desktop context menu on right click. It provides
editing, column movement, delegation or run cancellation, recoverable archive,
and permanently destructive deletion. Archive and deletion use the shared
confirmation dialog, and destructive actions are disabled while a task run is
active.

### Loading States

- **App launch**: skeleton layout with pulsing zinc-800 blocks
- **File opening**: skeleton code lines (7 lines, varying widths)
- **Agent thinking**: typing indicator (3 dots bouncing) + "Thinking..." text
- **Tool executing**: spinner icon + tool name + elapsed time
- **Search running**: inline progress bar in search panel

### Empty States

- **No project open**: centered illustration + "Open a folder to get started" + button
- **No conversations**: "Start a conversation with your AI agent" + suggested prompts
- **No search results**: "No matches found" + suggestion to broaden search
- **No skills**: "No custom skills yet" + "Create your first skill" link

### Error States

- **API error**: inline error card in agent panel (red border, error icon, message, retry button)
- **File save error**: toast notification (bottom-right, auto-dismiss 5s)
- **Connection error**: status bar indicator (yellow dot) + tooltip with details
- **Tool error**: error state in tool call card (red status, error message, expandable details)

---

## Animations

- **Panel resize**: smooth with `will-change: width`
- **Tab open/close**: 150ms ease-out opacity + width
- **Agent message appear**: 200ms fade-in + slight slide-up (8px)
- **Tool call expand/collapse**: 200ms ease-out height transition
- **Streaming cursor**: 500ms blink animation (opacity 0 ↔ 1)
- **Context chip add/remove**: 150ms scale + opacity
- **Status changes**: 300ms color transition on tool status icons

---

## Accessibility

### WCAG 2.1 AA Compliance

- **Color contrast**: all text meets 4.5:1 ratio (zinc-300 on zinc-950 = 11.5:1)
- **Focus indicators**: 2px blue-500 outline on all interactive elements
- **Keyboard navigation**: full app navigable via keyboard (Tab, Shift+Tab, Arrow keys)
- **Screen reader**: ARIA labels on all buttons, panels, and interactive elements
- **Reduced motion**: respect `prefers-reduced-motion` — disable animations
- **Font scaling**: UI responds to system font size preference

### ARIA Landmarks

```html
<header role="banner">           <!-- Title bar -->
<nav role="navigation">          <!-- Activity bar + sidebar -->
<main role="main">               <!-- Editor panel -->
<aside role="complementary">     <!-- Agent panel -->
<footer role="contentinfo">      <!-- Status bar -->
```

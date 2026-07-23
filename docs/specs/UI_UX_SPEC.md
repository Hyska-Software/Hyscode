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

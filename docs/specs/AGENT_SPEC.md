# Agent Specification

## Overview

The Agent Panel is the primary interface for AI interaction in HysCode. It supports three modes (Chat, Build, Review), displays streaming responses with tool call visualization, and provides an approval workflow for destructive operations.

---

## Agent Panel Layout

```
┌─────────────────────────────────────────────┐
│  Agent                    [Chat ▼] [⚙] [+] │
│  Claude Sonnet 4 · Anthropic                │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─ User─────────────────────────────────┐  │
│  │ Add a login page with email/password  │  │
│  │ authentication using JWT tokens.      │  │
│  │  📎 auth.ts  📎 routes.ts            │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌─ Assistant────────────────────────────┐  │
│  │ I'll create the login page. Let me    │  │
│  │ start by reading the current auth     │  │
│  │ setup...                              │  │
│  │                                       │  │
│  │ ┌─ Tool: read_file ──── ✓ 120ms ──┐  │  │
│  │ │  src/auth.ts (lines 1-45)       │  │  │
│  │ │  ▶ Show output                  │  │  │
│  │ └────────────────────────────────┘  │  │
│  │                                       │  │
│  │ ┌─ Tool: write_file ── ⏳ Pending ─┐  │  │
│  │ │  src/pages/login.tsx             │  │  │
│  │ │  [✓ Approve] [✕ Reject]         │  │  │
│  │ └────────────────────────────────┘  │  │
│  │                                       │  │
│  │ █ (streaming cursor)                  │  │
│  └───────────────────────────────────────┘  │
│                                             │
├─────────────────────────────────────────────┤
│  Context: auth.ts · routes.ts · +2 files    │
├─────────────────────────────────────────────┤
│  ┌───────────────────────────── [Send ➤] ┐  │
│  │ Type a message... (Ctrl+L to focus)   │  │
│  │                           [📎] [🔧]   │  │
│  └───────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│  Tokens: 12.4k in / 2.1k out · ~$0.04      │
└─────────────────────────────────────────────┘
```

---

## Conversation Modes

### Chat Mode (default)

Standard conversational interaction with the AI. Chat mode is intentionally non-mutating.

- Free-form text input
- Agent responds with text and optional tool calls
- Context chips for adding files/symbols
- Read-only filesystem, Git inspection, browser, and meta tools
- Mutating work requires switching to Build or Debug mode

### Build Mode (SDD)

Structured Spec-Driven Development workflow. Guides user through spec → plan → execute phases.

```
┌─────────────────────────────────────────────┐
│  Build Mode                                 │
│                                             │
│  Phase: ● Describe  ○ Spec  ○ Plan  ○ Exec │
│  ──────────────────────────────────────────  │
│                                             │
│  Describe the feature you want to build:    │
│  ┌───────────────────────────────────────┐  │
│  │ Add user authentication with email/   │  │
│  │ password login, JWT tokens, and a     │  │
│  │ protected dashboard page.             │  │
│  └───────────────────────────────────────┘  │
│                                [Generate Spec ➤]  │
└─────────────────────────────────────────────┘
```

After spec generation:
```
┌─────────────────────────────────────────────┐
│  Phase: ✓ Describe  ● Spec  ○ Plan  ○ Exec │
│  ──────────────────────────────────────────  │
│                                             │
│  Generated Spec (click to edit in editor):  │
│  ┌───────────────────────────────────────┐  │
│  │ # Authentication Feature              │  │
│  │ ## Purpose                            │  │
│  │ Add email/password authentication...  │  │
│  │ ## Acceptance Criteria                │  │
│  │ - [ ] Login page with email/password  │  │
│  │ - [ ] JWT token generation            │  │
│  │ ... (truncated, click to expand)      │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  [✏ Edit in Editor]  [✓ Approve]  [↺ Redo] │
└─────────────────────────────────────────────┘
```

After plan approval:
```
┌─────────────────────────────────────────────┐
│  Phase: ✓ Describe  ✓ Spec  ✓ Plan  ● Exec │
│  ──────────────────────────────────────────  │
│                                             │
│  Execution Progress (3 / 7 tasks)           │
│  ═══════════════════░░░░░░░░░░░░  43%       │
│                                             │
│  ✓ 1. Create auth utility functions         │
│  ✓ 2. Create login page component           │
│  ● 3. Add JWT middleware ← current          │
│    ┌─ Tool: write_file ✓ ──────────────┐    │
│    │  src/middleware/auth.ts            │    │
│    └──────────────────────────────────┘    │
│    ┌─ Tool: run_terminal ⏳ ───────────┐    │
│    │  npm test -- --filter auth        │    │
│    │  [✓ Approve] [✕ Reject]          │    │
│    └──────────────────────────────────┘    │
│  ○ 4. Create protected dashboard            │
│  ○ 5. Add route guards                      │
│  ○ 6. Write integration tests               │
│  ○ 7. Update documentation                  │
│                                             │
│  [⏸ Pause]  [⏭ Skip Task]  [✕ Cancel]      │
└─────────────────────────────────────────────┘
```

### Review Mode

Agent reviews existing code changes (git diff) and provides feedback.

- Automatically loads `git diff` output
- Agent highlights issues with severity levels (P0-P2)
- Inline comments linked to specific file:line locations
- Suggestions are clickable → opens file at that line

---

## Message Types

```typescript
type ChatMessage =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | SystemMessage;

interface UserMessage {
  id: string;
  role: 'user';
  content: string;
  attachments: ContextAttachment[];       // files/symbols added via chips
  timestamp: Date;
}

interface AssistantMessage {
  id: string;
  role: 'assistant';
  content: string;                        // may be streamed (partial)
  toolCalls: ToolCallDisplay[];
  isStreaming: boolean;
  model: string;
  tokenUsage?: TokenUsage;
  timestamp: Date;
}

interface ToolCallDisplay {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  status: 'pending_approval' | 'running' | 'completed' | 'failed' | 'rejected';
  durationMs?: number;
  isExpanded: boolean;
}
```

---

## Tool Call UI Components

### Tool Call Card

```
┌─ Tool: read_file ──────── ✓ 45ms ────────┐
│  src/components/Login.tsx (lines 1-80)    │
│  ▶ Show output                            │
└──────────────────────────────────────────┘

┌─ Tool: write_file ──────── ⏳ Pending ────┐
│  src/pages/login.tsx                      │
│  Preview: Creates login page component... │
│  [✓ Approve] [✕ Reject] [👁 Preview]     │
└──────────────────────────────────────────┘

┌─ Tool: run_terminal ────── ● Running ────┐
│  $ npm test -- --filter auth              │
│  ▼ Live output:                           │
│    PASS src/auth.test.ts (2.1s)           │
│    ✓ should validate email format         │
│    ✓ should hash password with bcrypt     │
└──────────────────────────────────────────┘
```

### Status Icons
- `⏳` Pending approval (blue pulse)
- `●` Running (animated spinner)
- `✓` Completed (green)
- `✕` Failed (red)
- `⊘` Rejected (gray)

---

## Context System

### Context Chips

Files and symbols added to the conversation context appear as chips:

```
Context: [auth.ts ✕] [routes.ts ✕] [LoginForm ✕] [+2 more] [+ Add]
```

### Adding Context
1. **Drag from file tree**: drag file onto agent panel
2. **@ mention**: type `@filename` in input to autocomplete
3. **# symbol**: type `#symbolName` to reference a function/class
4. **Right-click in editor**: "Add to Agent Context"
5. **Automatic**: agent's tool calls add files to context

### Context Budget Display
```
Context: 4 files · 3.2k tokens (of 180k available)
```

---

## Agent Input

```typescript
interface AgentInputProps {
  onSend: (message: string, attachments: ContextAttachment[]) => void;
  isStreaming: boolean;
  onCancel: () => void;
}
```

### Features
- **Multi-line input**: auto-expanding textarea (Shift+Enter for newline, Enter to send)
- **@ autocomplete**: file picker dropdown when typing `@`
- **# autocomplete**: symbol picker when typing `#`
- **Attach button**: file picker for adding context
- **Tool toggle**: enable/disable specific tools for this message
- **Stop button**: appears during streaming, cancels current generation
- **History**: Up/Down arrows cycle through previous messages

---

## Agent Settings

```
Settings > Agent
┌──────────────────────────────────────────────┐
│  AI Provider: [Anthropic ▼]                  │
│  Model: [claude-sonnet-4-20250514 ▼]         │
│                                              │
│  Temperature: [0.3] ──●────── [1.0]         │
│  Max Output Tokens: [16384]                  │
│                                              │
│  Auto-Approve:                               │
│  ○ Manual (approve all destructive tools)    │
│  ● Smart (auto-approve reads, ask for writes)│
│  ○ Auto (approve everything)                 │
│                                              │
│  System Prompt Override:                     │
│  ┌───────────────────────────────────────┐   │
│  │ (optional custom instructions)        │   │
│  └───────────────────────────────────────┘   │
│                                              │
│  Max Agent Iterations: [25]                  │
│  Turn Timeout: [5] minutes                   │
└──────────────────────────────────────────────┘
```

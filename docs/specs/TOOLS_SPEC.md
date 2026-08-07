# Tools Specification

## Overview

Tools are the mechanisms through which the AI agent interacts with the real development environment. Each tool has a formal definition (name, description, input schema, output format) used by the LLM for function calling.

---

## Tool Definition Format

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required: string[];
  };
  category: ToolCategory;
  requiresApproval: boolean;
  externalPathAccess?: {
    operation: 'read' | 'write' | 'execute';
    fields: Array<{ key: string; kind: 'target' | 'directory' }>;
  };
}

type ToolCategory = 'filesystem' | 'terminal' | 'git' | 'code' | 'browser' | 'mcp' | 'meta';
```

---

## Built-in Tools

### 1. read_file

**Category**: filesystem | **Approval**: no

```json
{
  "name": "read_file",
  "description": "Read the contents of a file. You can specify a line range to read only part of the file, or a max line limit. Line numbers are 1-indexed. Use limit to cap total lines when exploring large files.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute or workspace-relative path to the file"
      },
      "start_line": {
        "type": "integer",
        "description": "Starting line number (1-indexed, inclusive). Omit to read from beginning."
      },
      "end_line": {
        "type": "integer",
        "description": "Ending line number (1-indexed, inclusive). Omit to read to end."
      },
      "limit": {
        "type": "integer",
        "description": "Maximum number of lines to return. Overrides end_line if both are set. Useful for large files."
      }
    },
    "required": ["path"]
  }
}
```

**Output**: File content as string, with line numbers prepended and a header showing the range when truncated. Returns error if file doesn't exist.

---

### 1b. read_multiple_files

**Category**: filesystem | **Approval**: no

```json
{
  "name": "read_multiple_files",
  "description": "Read the contents of multiple files at once. Returns each file with its path and numbered content. Use this instead of multiple read_file calls to save iterations.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "paths": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Array of absolute or workspace-relative file paths"
      },
      "max_lines_per_file": {
        "type": "integer",
        "description": "Maximum lines to read per file (default: 200). Set higher for larger files."
      }
    },
    "required": ["paths"]
  }
}
```

**Output**: Concatenated file contents with `--- path ---` headers. Errors for individual files are inlined rather than failing the entire call.

---

### 2. write_file

**Category**: filesystem | **Approval**: yes

```json
{
  "name": "write_file",
  "description": "Write content to a file. If the file exists, it will be overwritten. If parent directories don't exist, they will be created.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute or workspace-relative path to the file"
      },
      "content": {
        "type": "string",
        "description": "The full content to write to the file"
      }
    },
    "required": ["path", "content"]
  }
}
```

---

### 3. edit_file

**Category**: filesystem | **Approval**: yes

```json
{
  "name": "edit_file",
  "description": "Make a targeted edit to a file by replacing an exact string with a new string. The old_string must match exactly (including whitespace and indentation). Include enough context lines to uniquely identify the location. Set replace_all=true to replace every occurrence.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute or workspace-relative path to the file"
      },
      "old_string": {
        "type": "string",
        "description": "The exact text to find and replace. Must match exactly one location in the file (unless replace_all is true)."
      },
      "new_string": {
        "type": "string",
        "description": "The text to replace old_string with"
      },
      "replace_all": {
        "type": "boolean",
        "description": "If true, replace every occurrence of old_string in the file. Default: false."
      }
    },
    "required": ["path", "old_string", "new_string"]
  }
}
```

**Output**: Success message with line range affected or count of replacements when replace_all is used. Error if old_string not found or matches multiple locations (unless replace_all is true).

---

### 3b. replace_lines

**Category**: filesystem | **Approval**: yes

```json
{
  "name": "replace_lines",
  "description": "Replace a specific range of lines in a file with new content. Line numbers are 1-indexed and inclusive. Use this when you need to edit a specific block of lines without matching by string content.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute or workspace-relative path to the file"
      },
      "start_line": {
        "type": "integer",
        "description": "Starting line number to replace (1-indexed, inclusive)"
      },
      "end_line": {
        "type": "integer",
        "description": "Ending line number to replace (1-indexed, inclusive). Omit to replace only start_line."
      },
      "new_content": {
        "type": "string",
        "description": "The new content to insert in place of the specified lines"
      }
    },
    "required": ["path", "start_line", "new_content"]
  }
}
```

**Output**: Success message with line range replaced. Error if line numbers are out of range.

---

### 3c. insert_lines

**Category**: filesystem | **Approval**: yes

```json
{
  "name": "insert_lines",
  "description": "Insert new content at a specific line position in a file. Line numbers are 1-indexed. Content is inserted AFTER the specified line. Use line=0 to insert at the beginning of the file.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute or workspace-relative path to the file"
      },
      "line": {
        "type": "integer",
        "description": "Line number after which to insert (1-indexed). Use 0 to insert at the top of the file."
      },
      "content": {
        "type": "string",
        "description": "The content to insert (can be multiple lines)"
      }
    },
    "required": ["path", "line", "content"]
  }
}
```

**Output**: Success message with insertion point. Error if line is out of range.

---

### 4. create_file

**Category**: filesystem | **Approval**: yes

```json
{
  "name": "create_file",
  "description": "Create a new file with the specified content. Fails if the file already exists. Parent directories are created automatically.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute or workspace-relative path for the new file"
      },
      "content": {
        "type": "string",
        "description": "The content for the new file"
      }
    },
    "required": ["path", "content"]
  }
}
```

---

### 5. list_directory

**Category**: filesystem | **Approval**: no

```json
{
  "name": "list_directory",
  "description": "List the contents of a directory. Returns file and folder names. Folders end with /. Supports recursive listing with file sizes when include_stats is true.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute or workspace-relative path to the directory"
      },
      "recursive": {
        "type": "boolean",
        "description": "If true, list all files recursively (default: false)"
      },
      "max_depth": {
        "type": "integer",
        "description": "Maximum depth for recursive listing (default: 3)"
      },
      "include_stats": {
        "type": "boolean",
        "description": "Include file sizes and modification times (default: false)"
      }
    },
    "required": ["path"]
  }
}
```

---

### 6. search_code

**Category**: filesystem | **Approval**: no

```json
{
  "name": "search_code",
  "description": "Search for text or regex patterns across files in the workspace or an explicitly authorized base directory. Returns matching lines with file paths, line numbers, and optional context lines around each match.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "pattern": {
        "type": "string",
        "description": "Text or regex pattern to search for"
      },
      "include_pattern": {
        "type": "string",
        "description": "Glob pattern to filter files (e.g., '**/*.ts')"
      },
      "exclude_pattern": {
        "type": "string",
        "description": "Glob pattern to exclude files (e.g., '**/node_modules/**')"
      },
      "base_path": {
        "type": "string",
        "description": "Directory to search in. Defaults to the workspace root and requires external approval when outside it."
      },
      "is_regex": {
        "type": "boolean",
        "description": "Whether pattern is a regex (default: false)"
      },
      "case_sensitive": {
        "type": "boolean",
        "description": "Case-sensitive search (default: false)"
      },
      "max_results": {
        "type": "integer",
        "description": "Maximum number of matches to return (default: 50, max: 200)"
      },
      "context_lines": {
        "type": "integer",
        "description": "Number of lines of context to show around each match (default: 0)"
      }
    },
    "required": ["pattern"]
  }
}
```

---

### 7. run_terminal_command

**Category**: terminal | **Approval**: yes

```json
{
  "name": "run_terminal_command",
  "description": "Execute a command in a visible terminal. Returns normalized combined PTY output and the exit code.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "description": "The command to execute"
      },
      "cwd": {
        "type": "string",
        "description": "Working directory (default: workspace root)"
      },
      "timeout_ms": {
        "type": "integer",
        "description": "Timeout in milliseconds (default: 30000)"
      },
      "new_terminal": { "type": "boolean" },
      "session_name": { "type": "string" },
      "background": { "type": "boolean" },
      "ready_pattern": { "type": "string" },
      "startup_timeout_ms": { "type": "integer" }
    },
    "required": ["command"]
  }
}
```

**Output**: Combined normalized PTY output plus metadata containing `exitCode`, `terminalId`, and
`background`. With `background=true`, the tool uses a dedicated persistent terminal and returns once
`ready_pattern` matches or observable startup is confirmed.

Agent terminals are distinct from manual TUI terminals. A runtime may reuse an agent PTY only when
conversation, owner, and normalized `cwd` all match; a manual terminal is never acquired by the
Harness. Every terminal summary exposes its role, working directory, owner, active tool call,
awaiting-input state, exit/truncation state, and effective read/write/respond/interrupt/kill/resize
permissions. Terminal access is checked against conversation, owner, and tool call rather than by
terminal id alone.

### 7b. read_terminal_output

Reads buffered output and lifecycle state from a terminal id returned by `run_terminal_command`.
Supports incremental reads through `after_sequence`, monotonic sequence reconciliation, and an
explicit truncation marker when the retained PTY buffer no longer contains the requested history.
This read-only tool does not require approval, but it remains owner-bound.

### 7c. stop_terminal_process

Interrupts a background process, waits briefly, and terminates the PTY if it remains alive. This
terminal mutation requires approval.

### 7d. respond_terminal_input

Sends an exact response to a resumable terminal interaction. Each call follows normal terminal
approval policy and displays the response before execution. Passwords, tokens, MFA codes, CAPTCHA
answers, and other sensitive values cannot be supplied by the agent and must be entered by the user.

When a terminal is `awaiting_input`, the bridge emits `terminal_updated` and the Harness emits
`terminal_progress`. The TUI switches to a dedicated input mode only when the terminal is not under
an active tool owner and approval mode is not `yolo`; typed sensitive values are masked and are not
written to transcript or model context. `/terminal` supports `list`, `open`, `focus`, `read`,
`interrupt`, and `kill`. `terminal_resize` forwards the TUI viewport dimensions to the PTY.

### 7e. Terminal bridge protocol

The bridge emits `runtime_ready` with the current terminal summaries and publishes
`terminal_updated` for `created`, `output`, `state`, and `exit`. Terminal subscriptions use replay:
the listener is registered before the snapshot, concurrent events are queued, and sequences already
included in the snapshot are discarded. Exits are emitted once and exited sessions remain readable
until explicit cleanup or shutdown.

The fullscreen VORTEX client embeds this bridge. `vortex --protocol ndjson` is the supported
non-interactive automation surface and accepts the same `initialize`, `send_message`, approval,
terminal-event, cancellation, and shutdown messages over stdin/stdout. Without the explicit
protocol option, a non-TTY launcher keeps its readiness-only behavior.

---

### 8. git_status

**Category**: git | **Approval**: no

```json
{
  "name": "git_status",
  "description": "Get the current git status of the workspace. Shows modified, added, deleted, and untracked files.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

---

### 9. git_diff

**Category**: git | **Approval**: no

```json
{
  "name": "git_diff",
  "description": "Get the git diff of uncommitted changes.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "staged": {
        "type": "boolean",
        "description": "If true, show diff of staged changes only (default: false, shows all)"
      },
      "path": {
        "type": "string",
        "description": "Optional: diff only this file"
      }
    },
    "required": []
  }
}
```

---

### 10. git_commit

**Category**: git | **Approval**: yes

```json
{
  "name": "git_commit",
  "description": "Stage files and create a git commit with the specified message.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "Commit message (follow conventional commits format)"
      },
      "paths": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Files to stage and commit. If empty, commits all staged changes."
      }
    },
    "required": ["message"]
  }
}
```

---

### 11. run_code

**Category**: code | **Approval**: yes

```json
{
  "name": "run_code",
  "description": "Execute a code snippet in a sandboxed environment. Supports JavaScript/TypeScript, Python, and shell scripts. Has no network access and limited CPU/memory.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "code": {
        "type": "string",
        "description": "The code to execute"
      },
      "language": {
        "type": "string",
        "enum": ["javascript", "typescript", "python", "bash"],
        "description": "Programming language of the code"
      },
      "timeout_ms": {
        "type": "integer",
        "description": "Execution timeout in milliseconds (default: 10000, max: 30000)"
      }
    },
    "required": ["code", "language"]
  }
}
```

---

### 12. web_search

**Category**: browser | **Approval**: no | **Engine**: provider abstraction (`SearchProvider` trait, Rust) — default DuckDuckGo HTML, no API key. 

```json
{
  "name": "web_search",
  "description": "Search the web for information. Returns a summary of top results. Use for looking up documentation, error solutions, or API references.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The search query"
      },
      "max_results": {
        "type": "integer",
        "description": "Maximum number of results to return (default: 5, clamped to 1–10 in the backend)"
      }
    },
    "required": ["query"]
  }
}
```

**Behavior**:
- Primary endpoint is `html.duckduckgo.com`; on blocked/empty/errored responses one fallback attempt goes to `lite.duckduckgo.com` (blocked less often).
- Result URLs are decoded from DuckDuckGo's `uddg=` redirect parameter (trailing `rut`/tracking params dropped, protocol-relative links made absolute).
- Zero-result responses that look like an anti-bot/anomaly page surface as `engine_blocked` errors — never as "no results found".
- After an engine block, a ~45s cooldown makes further `web_search` calls fail fast (no hammering the engine, no agent retry loops); the error message tells the agent to wait or rephrase.
- Errors use stable `[code]` prefixes (`engine_blocked`, `http_status`, `private_address`, `dns_resolution`, `network`, `invalid_url`, `unsupported_scheme`, `redirect_limit`, `invalid_redirect`, `empty_query`) so clients can classify failures.

### 12a. web_fetch

**Category**: browser | **Approval**: no

```json
{
  "name": "web_fetch",
  "description": "Fetch and read the content of a web page or API endpoint. Extracts clean readable text. Fails on HTTP 4xx/5xx and on blocked/private addresses.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "The full URL to fetch"
      },
      "max_length": {
        "type": "integer",
        "description": "Maximum characters to return (default: 10000, clamped to 100–100000 in the backend)"
      }
    },
    "required": ["url"]
  }
}
```

**Security model** (shared by `web_search` and `web_fetch`):
- SSRF validation lives **only in the Rust backend** (`commands/security.rs`): http/https schemes only; every URL (including each redirect hop) is DNS-resolved and every resolved address is checked against private/loopback/link-local/ULA/documentation/multicast ranges; IPv4-mapped IPv6 is checked via its embedded IPv4; resolution failures fail closed.
- Redirects are followed manually (max 5 hops) with per-hop re-validation — a public URL can never redirect into a private address.
- Response bodies are streamed with a 2 MB hard cap; non-HTML responses are passed through verbatim instead of being HTML-parsed.

---

### 13. mcp_call

**Category**: mcp | **Approval**: configurable

```json
{
  "name": "mcp_call",
  "description": "Call a tool provided by a connected MCP server. Use list_mcp_tools first to see available tools.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "server_id": {
        "type": "string",
        "description": "The MCP server ID"
      },
      "tool_name": {
        "type": "string",
        "description": "The tool name on that server"
      },
      "arguments": {
        "type": "object",
        "description": "Arguments to pass to the tool"
      }
    },
    "required": ["server_id", "tool_name"]
  }
}
```

---

### 14. activate_skill

**Category**: meta | **Approval**: no

```json
{
  "name": "activate_skill",
  "description": "Activate a skill to enhance your capabilities for the current conversation. Skills provide domain-specific instructions and best practices.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "skill_name": {
        "type": "string",
        "description": "Name of the skill to activate"
      }
    },
    "required": ["skill_name"]
  }
}
```

---

### 15. list_mcp_tools

**Category**: meta | **Approval**: no

```json
{
  "name": "list_mcp_tools",
  "description": "List all tools available from connected MCP servers.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

---

## Tool Execution Pipeline

```
Agent returns tool_call
  → Validate input against schema
  → Inspect declared path fields for external absolute paths
  → If an external path is not covered: enqueue mandatory external approval
  → Check normal approval requirement and combine it with the external request
  → If approved: create an authorized per-call path resolver
  → If denied: return a recoverable error to the agent
  → Route to handler (Tauri command or MCP call)
  → Capture output and timing
  → Log to telemetry (provider, tool, duration)
  → Return ToolResult to agent
  → Agent continues with next step
```

External access is operation-specific (`read`, `write`, or `execute`) and is
mandatory even in Auto-Approve/YOLO, Notify, Session Trust, and custom modes.
The user may allow the current call or allow the requested directory for the
current session only. Session grants are shared by parent and child harnesses,
cleared when a session changes, and never persisted. Write approvals must state
clearly that external data will be edited. For terminal calls only `cwd` is
classified; command text is intentionally not parsed.

---

## Error Handling

| Error                             | Behavior                                              |
| --------------------------------- | ----------------------------------------------------- |
| Invalid input (schema validation) | Return validation error to agent, agent retries       |
| File not found                    | Return error message, agent should try different path |
| Permission denied                 | Return error, suggest correct approach                |
| Timeout                           | Kill execution, return timeout error                  |
| Agent rejected tool call          | Return rejection with user's reason                   |
| Tool handler exception            | Return generic error, log details                     |

# MCP (Model Context Protocol) Architecture

## Overview

HysCode implements an **MCP client** that connects to external tool servers using the official `@modelcontextprotocol/sdk`. This allows the agent to dynamically discover and use tools provided by MCP servers — extending capabilities without modifying the core application.

---

## MCP Architecture in HysCode

```
┌────────────────────────────────────────┐
│          AGENT HARNESS                 │
│  Tool Router                           │
│    ├── Built-in tools (FS, Git, etc.)  │
│    └── MCP tools (dynamic)             │
│          │                             │
│    ┌─────▼──────┐                      │
│    │ MCP Client │                      │
│    │ (manager)  │                      │
│    └─────┬──────┘                      │
└──────────┼─────────────────────────────┘
           │
     ┌─────┼──────────────────┐
     │     │                  │
┌────▼───┐ ┌────▼───┐ ┌──────▼──────┐
│ stdio  │ │  SSE   │ │  WebSocket  │
│ server │ │ server │ │   server    │
└────────┘ └────────┘ └─────────────┘
  local      remote       remote
  process    HTTP         persistent
```

---

## MCP Client Manager

```typescript
interface McpClientManager {
  // Lifecycle
  connect(config: McpServerConfig): Promise<McpConnection>;
  disconnect(serverId: string): Promise<void>;
  reconnect(serverId: string): Promise<void>;

  // Discovery
  listServers(): McpConnection[];
  getServerTools(serverId: string): ToolDefinition[];
  getAllTools(): ToolDefinition[];          // merged from all connected servers

  // Execution
  callTool(serverId: string, toolName: string, args: unknown): Promise<ToolResult>;

  // Resources (MCP resources protocol)
  listResources(serverId: string): Promise<McpResource[]>;
  readResource(serverId: string, uri: string): Promise<McpResourceContent>;

  // Prompts (MCP prompts protocol)
  listPrompts(serverId: string): Promise<McpPrompt[]>;
  getPrompt(serverId: string, name: string, args?: Record<string, string>): Promise<McpPromptResult>;
}
```

---

## Server Configuration

```typescript
interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'websocket';

  // stdio transport
  command?: string;                       // e.g., "npx"
  args?: string[];                        // e.g., ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
  env?: Record<string, string>;           // environment variables

  // SSE transport
  url?: string;                           // e.g., "https://mcp-server.example.com/sse"
  headers?: Record<string, string>;       // auth headers

  // WebSocket transport
  wsUrl?: string;                         // e.g., "ws://localhost:8080/mcp"

  // Capability gating
  capabilities: McpCapabilities;
}

interface McpCapabilities {
  allowedTools: string[] | '*';           // tool names or wildcard
  allowedResources: string[] | '*';       // resource URI patterns
  maxConcurrentCalls: number;             // default: 5
  timeoutMs: number;                      // default: 30000
}
```

---

## Transport Implementations

### stdio (Local Process)

```typescript
// Spawns a local process and communicates via stdin/stdout (JSON-RPC)
// Best for: local tools, CLI wrappers, filesystem servers
// Lifecycle: process spawned on connect, killed on disconnect
// Via Tauri: uses pty_spawn command for process management

class StdioTransport implements McpTransport {
  async connect(config: McpServerConfig): Promise<void> {
    const ptyId = await invoke('pty_spawn', {
      command: config.command,
      args: config.args,
      env: config.env,
    });
    // Set up JSON-RPC message framing over stdout/stdin
  }
}
```

### SSE (Server-Sent Events)

```typescript
// Connects to a remote HTTP server using SSE for server→client and POST for client→server
// Best for: remote servers, cloud-hosted tools
// Via Tauri: uses tauri-plugin-http for both SSE stream and POST requests

class SseTransport implements McpTransport {
  async connect(config: McpServerConfig): Promise<void> {
    // POST to /sse endpoint to establish session
    // Listen on SSE stream for server messages
    // POST to /messages endpoint for client messages
  }
}
```

### WebSocket

```typescript
// Full-duplex connection for bidirectional real-time communication
// Best for: persistent connections, high-throughput tool servers

class WebSocketTransport implements McpTransport {
  async connect(config: McpServerConfig): Promise<void> {
    // Connect to wsUrl
    // JSON-RPC messages over WebSocket frames
  }
}
```

---

## Built-in MCP Servers

HysCode ships with pre-configured MCP servers that can be enabled from settings:

### Filesystem MCP Server
```json
{
  "id": "builtin-filesystem",
  "name": "Filesystem",
  "transport": "stdio",
  "command": "node",
  "args": ["node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"],
  "capabilities": { "allowedTools": "*", "maxConcurrentCalls": 10, "timeoutMs": 10000 }
}
```

**Tools provided**: `read_file`, `read_multiple_files`, `write_file`, `create_directory`, `list_directory`, `move_file`, `search_files`, `get_file_info`

### Git MCP Server
```json
{
  "id": "builtin-git",
  "name": "Git",
  "transport": "stdio",
  "command": "node",
  "args": ["node_modules/@anthropic/mcp-server-git/dist/index.js"],
  "capabilities": { "allowedTools": "*", "maxConcurrentCalls": 5, "timeoutMs": 30000 }
}
```

**Tools provided**: `git_status`, `git_diff`, `git_commit`, `git_log`, `git_branch_create`, `git_checkout`

### Browser MCP Server (Playwright)
```json
{
  "id": "builtin-browser",
  "name": "Browser",
  "transport": "stdio",
  "command": "node",
  "args": ["node_modules/@anthropic/mcp-server-playwright/dist/index.js"],
  "capabilities": {
    "allowedTools": ["navigate", "screenshot", "click", "type", "get_text"],
    "maxConcurrentCalls": 1,
    "timeoutMs": 60000
  }
}
```

---

## Dynamic Tool Registration

When an MCP server connects, its tools are dynamically merged into the Tool Router:

```typescript
// On MCP server connect
async function onServerConnected(connection: McpConnection) {
  const serverTools = await connection.listTools();

  for (const tool of serverTools) {
    toolRouter.register({
      name: `mcp_${connection.id}_${tool.name}`,   // namespaced
      description: tool.description,
      inputSchema: tool.inputSchema,
      category: 'mcp',
      requiresApproval: !connection.config.capabilities.allowedTools.includes(tool.name),
      handler: async (input) => {
        const result = await mcpManager.callTool(connection.id, tool.name, input);
        return { success: !result.isError, output: result.content };
      }
    });
  }

  // Re-generate tool definitions for next LLM call
  agentStore.refreshToolDefinitions();
}
```

---

## MCP Settings UI

```
Settings > MCP Servers
┌──────────────────────────────────────────────┐
│  MCP Servers                         [+ Add] │
│                                               │
│  ● Filesystem (built-in)          [Connected] │
│    Tools: 8 │ Calls: 142 │ Errors: 0         │
│                                               │
│  ● Git (built-in)                 [Connected] │
│    Tools: 6 │ Calls: 34 │ Errors: 1          │
│                                               │
│  ○ Browser (built-in)         [Disconnected]  │
│    Click to enable                            │
│                                               │
│  ● My Custom Server (stdio)       [Connected] │
│    npx my-mcp-server --port 3001              │
│    Tools: 3 │ [Edit] [Remove]                 │
└──────────────────────────────────────────────┘
```

---

## Security

1. **Capability gating**: each MCP server is restricted to declared allowed tools/resources
2. **No auto-connect**: external (non-built-in) servers require explicit user configuration
3. **Timeout enforcement**: tool calls that exceed timeout are killed
4. **Concurrent call limits**: prevent DoS from runaway agent loops
5. **Transport security**: SSE/WebSocket servers should use HTTPS/WSS (warning shown for HTTP in UI)
6. **Input validation**: tool inputs validated against declared JSON Schema before sending to server

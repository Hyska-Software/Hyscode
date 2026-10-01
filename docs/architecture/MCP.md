# MCP (Model Context Protocol) Architecture

## Overview

HysCode implements an MCP client that connects to configured remote tool servers and exposes their allowed tools to the Harness. MCP stdio is currently disabled because the interactive PTY contract is not a safe raw-process JSON-RPC transport.

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
│disabled│ │ server │ │   server    │
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
  getAllTools(): ToolDefinition[]; // merged from all connected servers

  // Execution
  callTool(serverId: string, toolName: string, args: unknown): Promise<ToolResult>;

  // Resources (MCP resources protocol)
  listResources(serverId: string): Promise<McpResource[]>;
  readResource(serverId: string, uri: string): Promise<McpResourceContent>;

  // Prompts (MCP prompts protocol)
  listPrompts(serverId: string): Promise<McpPrompt[]>;
  getPrompt(
    serverId: string,
    name: string,
    args?: Record<string, string>,
  ): Promise<McpPromptResult>;
}
```

---

## Server Configuration

```typescript
interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'websocket';

  // stdio configuration is retained for compatibility but connect fails closed
  command?: string; // e.g., "npx"
  args?: string[]; // e.g., ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
  env?: Record<string, string>; // environment variables

  // SSE transport
  url?: string; // e.g., "https://mcp-server.example.com/sse"
  headers?: Record<string, string>; // auth headers

  // WebSocket transport (custom authentication headers are unsupported)
  wsUrl?: string; // e.g., "ws://localhost:8080/mcp"

  // Capability gating
  capabilities: McpCapabilities;

  // Delegation gating (desktop settings)
  agentSafe: boolean; // expose tools to sub-agents when true
}

interface McpCapabilities {
  allowedTools: string[] | '*'; // tool names or wildcard
  allowedResources: string[] | '*'; // resource URI patterns
  maxConcurrentCalls: number; // default: 5
  timeoutMs: number; // default: 30000
}
```

MCP tools are registered in the parent harness by default. A delegated child
receives only tools from servers with `agentSafe: true`; the approval policy
still applies to every received MCP tool. This is separate from transport
capabilities because it controls which agent execution contexts may invoke the
server, not which protocol methods the server exposes.

---

## Transport Implementations

### stdio (Local Process) — Disabled

stdio is intentionally unavailable. The Desktop PTY contract is interactive and framed for user
terminals; it does not provide a safe raw-process stdin/stdout contract for JSON-RPC. `StdioTransport`
fails closed on connect and send. Do not route MCP stdio through `pty_spawn`. Re-enable only after
the host has a dedicated raw-process API with argument/environment validation, bounded startup and
shutdown, cancellation, output framing, and process-tree cleanup tests.

### SSE (Server-Sent Events)

```typescript
// Connects to a remote HTTP server using SSE for server→client and POST for client→server
// Best for: remote servers, cloud-hosted tools
// Uses authenticated fetch for both SSE stream and POST requests

class SseTransport implements McpTransport {
  async connect(config: McpServerConfig): Promise<void> {
    // POST to /sse endpoint to establish session
    // Listen on SSE stream for server messages
    // POST to /messages endpoint for client messages
  }
}
```

Authenticated SSE configuration secrets are resolved from the OS credential store and are never
persisted in settings. Authentication headers require HTTPS except for loopback development
servers. Redirects are rejected, and the negotiated message endpoint must remain on the original
authenticated origin. Connect, RPC, and cancellation paths have bounded deadlines; failure and
disconnect reject pending requests and clean up stream readers.

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

## Built-in Capabilities

Filesystem, Git, and browser capabilities are provided by HysCode's native Harness tools; they are
not spawned as built-in MCP servers. No stdio MCP server is enabled. Configured external MCP
servers use the SSE or WebSocket transports supported by the client.

---

## Dynamic Tool Registration

Connected server tools are namespaced and registered with the Harness. `McpClientManager`
filters discovery through `allowedTools` and checks the same allowlist again in `callTool`, so
registry visibility is not the security boundary. Harness approval remains an independent policy
check for every MCP tool call. Delegated Harnesses only receive tools from servers configured as
safe for delegation.

---

## MCP Settings UI

```
Settings > MCP Servers
┌──────────────────────────────────────────────┐
│  MCP Servers                         [+ Add] │
│                                               │
│  ● Docs server (SSE)              [Connected] │
│    Tools: 3 │ Calls: 14 │ Errors: 0          │
│                                               │
│  ○ Local server (stdio)  [Unavailable]        │
│    Raw-process transport is not implemented   │
└──────────────────────────────────────────────┘
```

---

## Security

1. **Capability gating**: tool and resource calls are checked against the configured allowlists.
2. **Delegation gating**: child agents only receive tools from servers marked safe for delegation.
3. **Deadlines and cancellation**: pending RPCs have bounded deadlines; cancellation and disconnect reject pending requests and release readers. A remote server may continue work after the client has cancelled, so remote side effects are not claimed to have stopped.
4. **Transport security**: authenticated SSE requires HTTPS except loopback; redirects and cross-origin negotiated endpoints are rejected. WebSocket requires WSS except loopback and does not accept custom auth headers.
5. **Secret storage**: Desktop MCP secrets are resolved from OS credential storage and are not stored in settings JSON.
6. **stdio disabled**: the PTY is never used as a JSON-RPC process channel.

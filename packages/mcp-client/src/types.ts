// ─── MCP Client Types ───────────────────────────────────────────────────────
// Types for the Model Context Protocol client implementation.

export type McpTransportType = 'stdio' | 'sse' | 'websocket';

export interface McpCapabilities {
  allowedTools: string[] | '*';
  allowedResources: string[] | '*';
  maxConcurrentCalls: number;
  timeoutMs: number;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportType;
  /** stdio: command to spawn */
  command?: string;
  /** stdio: command arguments */
  args?: string[];
  /** stdio: environment variables */
  env?: Record<string, string>;
  /** SSE: HTTP endpoint URL */
  url?: string;
  /** SSE: HTTP headers */
  headers?: Record<string, string>;
  /** WebSocket: URL */
  wsUrl?: string;
  /** Capability gating */
  capabilities: McpCapabilities;
  /** Auto-connect on startup */
  autoConnect?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: Uint8Array;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpPromptResult {
  messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
}

export interface McpConnection {
  config: McpServerConfig;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  tools: McpToolDefinition[];
  resources: McpResource[];
  prompts: McpPrompt[];
  error?: string;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'resource'; resource: McpResourceContent }>;
  isError?: boolean;
}

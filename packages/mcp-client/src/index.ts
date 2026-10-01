// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  McpTransportType,
  McpCapabilities,
  McpServerConfig,
  McpRequestOptions,
  McpToolDefinition,
  McpResource,
  McpResourceContent,
  McpPrompt,
  McpPromptResult,
  McpConnection,
  McpToolResult,
} from './types';

// ─── Manager ────────────────────────────────────────────────────────────────
export {
  McpClientManager,
  StdioTransport,
  FetchSseTransport,
  WebSocketTransport,
} from './manager';
export type { McpTransport } from './manager';;

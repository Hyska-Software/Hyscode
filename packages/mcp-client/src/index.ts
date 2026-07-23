// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  McpTransportType,
  McpCapabilities,
  McpServerConfig,
  McpToolDefinition,
  McpResource,
  McpResourceContent,
  McpPrompt,
  McpPromptResult,
  McpConnection,
  McpToolResult,
} from './types';

// ─── Manager ────────────────────────────────────────────────────────────────
export { McpClientManager, StdioTransport, SseTransport, WebSocketTransport } from './manager';
export type { McpTransport } from './manager';;

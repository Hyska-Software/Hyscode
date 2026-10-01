// ─── MCP Bridge ─────────────────────────────────────────────────────────────
// Singleton that owns the McpClientManager and syncs it with settings.

import { McpClientManager } from '@hyscode/mcp-client';
import type {
  McpToolDefinition,
  McpRequestOptions,
  McpServerConfig as McpCoreConfig,
} from '@hyscode/mcp-client';
import { tauriInvoke, tauriInvokeRaw } from './tauri-invoke';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { useSettingsStore } from '@/stores/settings-store';
import type { McpServerConfig } from '@/stores/settings-store';

let _instance: McpBridge | null = null;

export class McpBridge {
  private manager: McpClientManager;

  private constructor() {
    this.manager = new McpClientManager(
      tauriInvokeRaw,
      async (event: string, handler: (payload: unknown) => void) => {
        const unlisten = await tauriListen(event, (e) => handler(e.payload));
        return unlisten;
      },
    );
  }

  static init(): McpBridge {
    if (_instance) return _instance;
    _instance = new McpBridge();
    return _instance;
  }

  static get(): McpBridge {
    if (!_instance) throw new Error('McpBridge not initialized.');
    return _instance;
  }

  static destroy(): void {
    if (_instance) {
      void _instance.disconnectAllServers().catch((error) => {
        console.error('[McpBridge] Failed to disconnect MCP servers during shutdown:', error);
      });
      _instance = null;
    }
  }

  // ─── Adapter ────────────────────────────────────────────────────────

  /** Convert the simple settings-store config to the full MCP core config */
  private async toCoreConfig(server: McpServerConfig): Promise<McpCoreConfig> {
    let headers: Record<string, string> | undefined;
    if (server.authSecretAccount || server.authHeaderName) {
      if (!server.authSecretAccount || !server.authHeaderName) {
        throw new Error(`MCP server "${server.name}" has incomplete authentication settings.`);
      }
      if (server.transport === 'websocket') {
        throw new Error('MCP WebSocket authentication headers are unsupported.');
      }
      const secret = await tauriInvoke('keychain_get', {
        service: 'hyscode',
        account: server.authSecretAccount,
      });
      if (!secret) throw new Error(`MCP credential for "${server.name}" is missing from secure storage.`);
      headers = { [server.authHeaderName]: secret };
    }
    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      url: server.url,
      wsUrl: server.wsUrl,
      headers,
      capabilities: {
        allowedTools: '*',
        allowedResources: '*',
        maxConcurrentCalls: 5,
        timeoutMs: 30_000,
      },
    };
  }

  // ─── Connection Management ──────────────────────────────────────────

  /** Connect to all enabled MCP servers from settings */
  async connectAll(): Promise<void> {
    const servers = useSettingsStore.getState().mcpServers.filter((s) => s.enabled);
    const outcomes = await Promise.allSettled(servers.map((server) => this.connect(server)));
    const failures = outcomes.flatMap((outcome, index) =>
      outcome.status === 'rejected'
        ? [`${servers[index].name}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`]
        : [],
    );
    if (failures.length > 0) {
      throw new Error(`Some MCP servers could not connect:\n${failures.join('\n')}`);
    }
  }

  async connect(server: McpServerConfig): Promise<void> {
    const connection = await this.manager.connect(await this.toCoreConfig(server));
    if (connection.status !== 'connected') {
      throw new Error(connection.error ?? `MCP server "${server.name}" failed to connect.`);
    }
  }

  async disconnect(serverId: string): Promise<void> {
    await this.manager.disconnect(serverId);
  }

  async deleteServerCredential(server: McpServerConfig): Promise<void> {
    if (!server.authSecretAccount) return;
    await tauriInvoke('keychain_delete', {
      service: 'hyscode',
      account: server.authSecretAccount,
    });
  }

  async disconnectAllServers(): Promise<void> {
    const servers = this.manager.listServers();
    const results = await Promise.allSettled(
      servers.map((server) => this.manager.disconnect(server.config.id)),
    );
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${servers[index].config.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
        : [],
    );
    if (failures.length > 0) {
      throw new Error(`Some MCP servers failed to disconnect:\n${failures.join('\n')}`);
    }
  }

  // ─── Tool / Resource access ─────────────────────────────────────────

  getTools(): Array<McpToolDefinition & { serverId: string }> {
    return this.manager.getAllTools();
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: McpRequestOptions,
  ): Promise<unknown> {
    return this.manager.callTool(serverId, toolName, args, options);
  }

  getConnectedServerIds(): string[] {
    return this.manager.listServers()
      .filter((s) => s.status === 'connected')
      .map((s) => s.config.id);
  }
}

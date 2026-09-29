// ─── MCP Client Manager ─────────────────────────────────────────────────────
// Manages connections to MCP servers and provides unified tool access.
// Uses JSON-RPC 2.0 protocol over different transports.

import type {
  McpServerConfig,
  McpConnection,
  McpToolDefinition,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpPrompt,
  McpPromptResult,
} from './types';

// ─── JSON-RPC Types ─────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// ─── Transport Interface ────────────────────────────────────────────────────

export interface McpTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: JsonRpcRequest): Promise<JsonRpcResponse>;
  /** Fire-and-forget: send a JSON-RPC notification (no id, no response expected) */
  sendNotification(notification: JsonRpcNotification): Promise<void>;
  onNotification(handler: (notification: JsonRpcNotification) => void): void;
}

// ─── Stdio Transport ────────────────────────────────────────────────────────
// Spawns a local process and communicates via JSON-RPC over stdin/stdout.

export class StdioTransport implements McpTransport {
  private config: McpServerConfig;
  private invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  private listen: ((event: string, handler: (payload: unknown) => void) => Promise<() => void>) | undefined;
  private ptyId: string | null = null;
  private pendingRequests = new Map<number | string, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (reason: Error) => void;
  }>();
  private notificationHandler: ((n: JsonRpcNotification) => void) | null = null;
  private buffer = '';
  private unlistenPtyData: (() => void) | null = null;

  constructor(
    config: McpServerConfig,
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
    listen?: (event: string, handler: (payload: unknown) => void) => Promise<() => void>,
  ) {
    this.config = config;
    this.invoke = invoke;
    this.listen = listen;
  }

  async connect(): Promise<void> {
    const command = this.config.command?.trim();
    if (!command) throw new Error('stdio transport requires a non-empty command');
    // Minimal injection guard: reject path traversal / absolute paths outside
    // PATH lookup. Full allowlist enforcement lives in the host config layer.
    if (command.includes('..') || /[/\\]/.test(command)) {
      console.warn(`[StdioTransport] Suspicious stdio command "${command}" — allowing only bare binary names or validated paths.`);
      if (command.includes('..')) throw new Error(`stdio command "${command}" contains forbidden ".."`);
    }
    console.log(`[StdioTransport] Spawning "${command}" for server "${this.config.id}"`);

    this.ptyId = `mcp-${this.config.id}-${crypto.randomUUID()}`;
    const spawnPromise = this.invoke('pty_spawn', {
      id: this.ptyId,
      shell: command,
      args: this.config.args || [],
      cwd: undefined,
      cols: 80,
      rows: 24,
      env: this.config.env,
    });
    const timeoutMs = this.config.capabilities.timeoutMs ?? 10_000;
    await Promise.race([
      spawnPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`stdio connect timeout (${timeoutMs}ms)`)), timeoutMs),
      ),
    ]);

    // Wire up PTY data listener so JSON-RPC responses are received
    if (this.listen) {
      this.unlistenPtyData = await this.listen('pty:data', (payload: unknown) => {
        const data = payload as { pty_id: string; data: string };
        if (data.pty_id === this.ptyId) {
          this.handleData(data.data);
        }
      });
    }
  }

  async disconnect(): Promise<void> {
    if (this.unlistenPtyData) {
      this.unlistenPtyData();
      this.unlistenPtyData = null;
    }
    if (this.ptyId) {
      try {
        await this.invoke('pty_kill', { id: this.ptyId });
      } catch (err) {
        console.warn(`[StdioTransport] pty_kill failed for "${this.ptyId}":`, err);
      }
      this.ptyId = null;
    }
    // Reject pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Transport disconnected'));
    }
    this.pendingRequests.clear();
  }

  async send(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.ptyId) throw new Error('Transport not connected');

    const data = JSON.stringify(message) + '\n';
    await this.invoke('pty_write', { id: this.ptyId, data });

    // Wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error(`Request ${message.id} timed out`));
      }, this.config.capabilities.timeoutMs || 30000);

      this.pendingRequests.set(message.id, {
        resolve: (resp) => {
          clearTimeout(timeout);
          resolve(resp);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
    });
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  async sendNotification(notification: JsonRpcNotification): Promise<void> {
    if (!this.ptyId) throw new Error('Transport not connected');
    const data = JSON.stringify(notification) + '\n';
    await this.invoke('pty_write', { id: this.ptyId, data });
  }

  /** Called when data is received from the process stdout */
  handleData(data: string): void {
    this.buffer += data;

    // Process complete JSON lines
    while (true) {
      const newlineIdx = this.buffer.indexOf('\n');
      if (newlineIdx === -1) break;

      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        if ('id' in msg && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg as JsonRpcResponse);
        } else if ('method' in msg && !('id' in msg)) {
          this.notificationHandler?.(msg as JsonRpcNotification);
        }
      } catch (err) {
        console.warn('[StdioTransport] Skipping invalid JSON line:', err);
      }
    }
  }
}

// ─── SSE Transport ──────────────────────────────────────────────────────────
// HTTP-based transport using POST for requests, SSE for server messages.

export class SseTransport implements McpTransport {
  private config: McpServerConfig;
  private messagesUrl: string | null = null;
  private endpointPromise: Promise<void> | null = null;
  private eventSource: EventSource | null = null;
  private pendingRequests = new Map<number | string, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (reason: Error) => void;
  }>();
  private notificationHandler: ((n: JsonRpcNotification) => void) | null = null;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.url) throw new Error('SSE transport requires url');

    const baseUrl = this.config.url;
    const timeoutMs = this.config.capabilities.timeoutMs ?? 10_000;

    // Establish SSE connection
    this.eventSource = new EventSource(baseUrl);

    const endpointPromise = new Promise<void>((resolve) => {
      this.eventSource!.addEventListener('endpoint', (event: MessageEvent) => {
        // Server sends the messages endpoint URL
        try {
          this.messagesUrl = new URL(event.data, baseUrl).toString();
        } catch (err) {
          console.warn('[SseTransport] Invalid endpoint URL from server:', err);
          return;
        }
        resolve();
      });
    });
    this.endpointPromise = endpointPromise;

    this.eventSource.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if ('id' in msg && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg as JsonRpcResponse);
        } else if ('method' in msg && !('id' in msg)) {
          this.notificationHandler?.(msg as JsonRpcNotification);
        }
      } catch (err) {
        console.warn('[SseTransport] Skipping invalid SSE message:', err);
      }
    });

    // Wait for connection to establish
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`SSE connection timeout (${timeoutMs}ms)`)), timeoutMs);
      this.eventSource!.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.eventSource!.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('SSE connection failed'));
      });
    });
  }

  async disconnect(): Promise<void> {
    this.eventSource?.close();
    this.eventSource = null;
    this.messagesUrl = null;
    this.endpointPromise = null;
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Transport disconnected'));
    }
    this.pendingRequests.clear();
  }

  async send(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    // The server announces its POST endpoint via the `endpoint` SSE event —
    // never send before it arrives or the request has nowhere to go.
    if (!this.messagesUrl) {
      if (this.endpointPromise) {
        const timeoutMs = this.config.capabilities.timeoutMs ?? 10_000;
        await Promise.race([
          this.endpointPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('SSE send failed: not connected yet (no endpoint event)')), timeoutMs),
          ),
        ]);
      }
      if (!this.messagesUrl) throw new Error('SSE send failed: not connected yet (no endpoint event)');
    }
    const url = this.messagesUrl;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    // Response comes via SSE stream, wait for it
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error(`Request ${message.id} timed out`));
      }, this.config.capabilities.timeoutMs || 30000);

      this.pendingRequests.set(message.id, {
        resolve: (resp) => {
          clearTimeout(timeout);
          resolve(resp);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
    });
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  async sendNotification(notification: JsonRpcNotification): Promise<void> {
    const url = this.messagesUrl || this.config.url;
    if (!url) throw new Error('No messages endpoint');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.config.headers },
      body: JSON.stringify(notification),
    });
    if (!response.ok) {
      console.warn(`[SseTransport] sendNotification failed: HTTP ${response.status}`);
    }
  }
}

// ─── WebSocket Transport ────────────────────────────────────────────────────
// Bidirectional JSON-RPC over a single WebSocket connection.

export class WebSocketTransport implements McpTransport {
  private config: McpServerConfig;
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<number | string, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (reason: Error) => void;
  }>();
  private notificationHandler: ((n: JsonRpcNotification) => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnected = false;
  private messageQueue: string[] = [];
  private closed = false;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.closed = false;
    await this.openSocket(false);
  }

  private openSocket(isReconnect: boolean): Promise<void> {
    if (!this.config.wsUrl) return Promise.reject(new Error('WebSocket transport requires wsUrl'));

    this.ws = new WebSocket(this.config.wsUrl);

    this.ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data));
        if ('id' in msg && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg as JsonRpcResponse);
        } else if ('method' in msg && !('id' in msg)) {
          this.notificationHandler?.(msg as JsonRpcNotification);
        }
      } catch (err) {
        console.warn('[WebSocketTransport] Skipping invalid JSON message:', err);
      }
    });

    this.ws.addEventListener('close', () => {
      this.stopPing();
      // Auto-reconnect once per connection lifetime; queued messages flush on open.
      if (!this.closed && !this.reconnected && !isReconnect) {
        this.reconnected = true;
        console.warn('[WebSocketTransport] Connection closed — attempting one auto-reconnect…');
        this.openSocket(true).catch((err) => {
          console.warn('[WebSocketTransport] Auto-reconnect failed:', err);
        });
      }
    });

    // Wait for open or error
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);

      this.ws!.addEventListener('open', () => {
        clearTimeout(timeout);
        this.startPing();
        // Flush messages queued while disconnected.
        for (const queued of this.messageQueue.splice(0)) {
          try {
            this.ws?.send(queued);
          } catch (err) {
            console.warn('[WebSocketTransport] Failed to flush queued message:', err);
          }
        }
        resolve();
      }, { once: true });

      this.ws!.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket connection failed'));
      }, { once: true });
    });
  }

  private startPing(): void {
    this.stopPing();
    // Keep idle connections alive; servers may drop silent sockets.
    this.pingTimer = setInterval(() => {
      try {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));
        }
      } catch (err) {
        console.warn('[WebSocketTransport] ping failed:', err);
      }
    }, 30_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageQueue.length = 0;
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Transport disconnected'));
    }
    this.pendingRequests.clear();
  }

  async send(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    const payload = JSON.stringify(message);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      // Queue while the socket finishes connecting; flushed on open.
      console.warn('[WebSocketTransport] Socket connecting — queueing request', message.id);
      this.messageQueue.push(payload);
    } else {
      throw new Error('WebSocket not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error(`Request ${message.id} timed out`));
      }, this.config.capabilities.timeoutMs || 30000);

      this.pendingRequests.set(message.id, {
        resolve: (resp) => {
          clearTimeout(timeout);
          resolve(resp);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
    });
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  async sendNotification(notification: JsonRpcNotification): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(notification));
  }
}

// ─── MCP Client Manager ────────────────────────────────────────────────────

export class McpClientManager {
  private connections = new Map<string, McpConnection & { transport: McpTransport }>();
  private invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  private listen: ((event: string, handler: (payload: unknown) => void) => Promise<() => void>) | undefined;
  /** Per-server in-flight call counts for maxConcurrentCalls gating. */
  private activeCalls = new Map<string, number>();
  /** Per-server FIFO waiters for the concurrency semaphore. */
  private callWaiters = new Map<string, Array<() => void>>();

  constructor(
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
    listen?: (event: string, handler: (payload: unknown) => void) => Promise<() => void>,
  ) {
    this.invoke = invoke;
    this.listen = listen;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async connect(config: McpServerConfig): Promise<McpConnection> {
    // Create transport
    let transport: McpTransport;
    switch (config.transport) {
      case 'stdio':
        transport = new StdioTransport(config, this.invoke, this.listen);
        break;
      case 'sse':
        transport = new SseTransport(config);
        break;
      case 'websocket':
        transport = new WebSocketTransport(config);
        break;
      default:
        throw new Error(`Unsupported transport: ${config.transport}`);
    }

    const connection: McpConnection & { transport: McpTransport } = {
      config,
      status: 'connecting',
      tools: [],
      resources: [],
      prompts: [],
      transport,
    };

    this.connections.set(config.id, connection);

    try {
      // Connect transport
      await transport.connect();

      // Initialize MCP protocol
      await this.rpcCall(config.id, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        clientInfo: {
          name: 'HysCode',
          version: '0.1.0',
        },
      });

      // Send initialized notification (no id — JSON-RPC notifications must NOT have an id)
      await transport.sendNotification({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });

      // List tools
      connection.tools = await this.fetchTools(config.id);

      // List resources (if supported)
      try {
        connection.resources = await this.fetchResources(config.id);
      } catch (err) {
        console.warn(`[McpClientManager] resources/list failed for "${config.id}" (unsupported?):`, err);
      }

      // List prompts (if supported)
      try {
        connection.prompts = await this.fetchPrompts(config.id);
      } catch (err) {
        console.warn(`[McpClientManager] prompts/list failed for "${config.id}" (unsupported?):`, err);
      }

      connection.status = 'connected';
      return connection;
    } catch (err) {
      connection.status = 'error';
      connection.error = err instanceof Error ? err.message : String(err);
      console.warn(`[McpClientManager] connect failed for "${config.id}":`, err);
      // Don't leave a broken entry in the map — callers must not route to it.
      this.connections.delete(config.id);
      try {
        await transport.disconnect();
      } catch (disconnectErr) {
        console.warn(`[McpClientManager] transport cleanup failed for "${config.id}":`, disconnectErr);
      }
      return connection;
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    await conn.transport.disconnect();
    conn.status = 'disconnected';
    this.connections.delete(serverId);
  }

  async reconnect(serverId: string): Promise<McpConnection> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`Server "${serverId}" not found`);

    await this.disconnect(serverId);
    return this.connect(conn.config);
  }

  // ─── Discovery ──────────────────────────────────────────────────────

  listServers(): McpConnection[] {
    return Array.from(this.connections.values()).map(({ transport: _transport, ...conn }) => conn);
  }

  getServerTools(serverId: string): McpToolDefinition[] {
    const conn = this.connections.get(serverId);
    if (!conn || conn.status !== 'connected') return [];

    // Apply capability gating
    const { allowedTools } = conn.config.capabilities;
    if (allowedTools === '*') return conn.tools;
    return conn.tools.filter((t) => allowedTools.includes(t.name));
  }

  getAllTools(): Array<McpToolDefinition & { serverId: string }> {
    const tools: Array<McpToolDefinition & { serverId: string }> = [];
    for (const [serverId, conn] of this.connections) {
      if (conn.status !== 'connected') continue;
      const serverTools = this.getServerTools(serverId);
      tools.push(...serverTools.map((t) => ({ ...t, serverId })));
    }
    return tools;
  }

  // ─── Execution ──────────────────────────────────────────────────────

  async callTool(
    serverId: string,
    toolName: string,
    args?: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const conn = this.connections.get(serverId);
    if (!conn || conn.status !== 'connected') {
      throw new Error(`Server "${serverId}" not connected`);
    }

    // Check capability gating
    const { allowedTools } = conn.config.capabilities;
    if (allowedTools !== '*' && !allowedTools.includes(toolName)) {
      throw new Error(`Tool "${toolName}" not allowed for server "${serverId}"`);
    }

    await this.acquireSlot(serverId);
    try {
      const result = await this.rpcCall(serverId, 'tools/call', {
        name: toolName,
        arguments: args || {},
      });
      return result as McpToolResult;
    } finally {
      this.releaseSlot(serverId);
    }
  }

  private async acquireSlot(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    const max = conn?.config.capabilities.maxConcurrentCalls ?? Infinity;
    if (max <= 0) return;
    const active = this.activeCalls.get(serverId) ?? 0;
    if (active < max) {
      this.activeCalls.set(serverId, active + 1);
      return;
    }
    await new Promise<void>((resolve) => {
      const waiters = this.callWaiters.get(serverId) ?? [];
      waiters.push(() => {
        this.activeCalls.set(serverId, (this.activeCalls.get(serverId) ?? 0) + 1);
        resolve();
      });
      this.callWaiters.set(serverId, waiters);
    });
  }

  private releaseSlot(serverId: string): void {
    const active = this.activeCalls.get(serverId) ?? 1;
    this.activeCalls.set(serverId, Math.max(0, active - 1));
    const waiters = this.callWaiters.get(serverId);
    const next = waiters?.shift();
    if (next) next();
  }

  private assertResourceAllowed(serverId: string, uri: string): void {
    const conn = this.connections.get(serverId);
    const allowed = conn?.config.capabilities.allowedResources;
    if (!allowed || allowed === '*') return;
    const permitted = allowed.some((prefix) => uri === prefix || uri.startsWith(prefix));
    if (!permitted) {
      throw new Error(`Resource "${uri}" not allowed for server "${serverId}"`);
    }
  }

  // ─── Resources ────────────────────────────────────────────────────

  async listResources(serverId: string): Promise<McpResource[]> {
    const resources = await this.fetchResources(serverId);
    const conn = this.connections.get(serverId);
    const allowed = conn?.config.capabilities.allowedResources;
    if (!allowed || allowed === '*') return resources;
    return resources.filter((r) =>
      allowed.some((prefix) => r.uri === prefix || r.uri.startsWith(prefix)),
    );
  }

  async readResource(serverId: string, uri: string): Promise<McpResourceContent> {
    this.assertResourceAllowed(serverId, uri);
    const result = await this.rpcCall(serverId, 'resources/read', { uri });
    const contents = (result as { contents: McpResourceContent[] }).contents;
    if (!contents || !contents.length) {
      throw new Error(`MCP resources/read returned empty contents for "${uri}"`);
    }
    return contents[0];
  }

  // ─── Prompts ──────────────────────────────────────────────────────

  async listPrompts(serverId: string): Promise<McpPrompt[]> {
    return this.fetchPrompts(serverId);
  }

  async getPrompt(
    serverId: string,
    name: string,
    args?: Record<string, string>,
  ): Promise<McpPromptResult> {
    const result = await this.rpcCall(serverId, 'prompts/get', { name, arguments: args });
    return result as McpPromptResult;
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private async rpcCall(serverId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`Server "${serverId}" not found`);

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const response = await conn.transport.send(request);

    if (response.error) {
      throw new Error(`MCP error ${response.error.code}: ${response.error.message}`);
    }

    return response.result;
  }

  private async fetchTools(serverId: string): Promise<McpToolDefinition[]> {
    const result = await this.rpcCall(serverId, 'tools/list');
    const tools = (result as { tools: McpToolDefinition[] }).tools;
    if (!Array.isArray(tools)) {
      console.warn(`[McpClientManager] tools/list from "${serverId}" returned non-array tools; using []`);
      return [];
    }
    return tools;
  }

  private async fetchResources(serverId: string): Promise<McpResource[]> {
    const result = await this.rpcCall(serverId, 'resources/list');
    const resources = (result as { resources: McpResource[] }).resources;
    if (!Array.isArray(resources)) {
      console.warn(`[McpClientManager] resources/list from "${serverId}" returned non-array resources; using []`);
      return [];
    }
    return resources;
  }

  private async fetchPrompts(serverId: string): Promise<McpPrompt[]> {
    const result = await this.rpcCall(serverId, 'prompts/list');
    const prompts = (result as { prompts: McpPrompt[] }).prompts;
    if (!Array.isArray(prompts)) {
      console.warn(`[McpClientManager] prompts/list from "${serverId}" returned non-array prompts; using []`);
      return [];
    }
    return prompts;
  }
}

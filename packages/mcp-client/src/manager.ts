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
  McpRequestOptions,
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
  connect(options?: McpRequestOptions): Promise<void>;
  disconnect(): Promise<void>;
  send(message: JsonRpcRequest, options?: McpRequestOptions): Promise<JsonRpcResponse>;
  /** Fire-and-forget: send a JSON-RPC notification (no id, no response expected) */
  sendNotification(notification: JsonRpcNotification, options?: McpRequestOptions): Promise<void>;
  onNotification(handler: (notification: JsonRpcNotification) => void): void;
}

// ─── Stdio Transport ────────────────────────────────────────────────────────
// Spawns a local process and communicates via JSON-RPC over stdin/stdout.

export class StdioTransport implements McpTransport {
  constructor(
    _config: McpServerConfig,
    _invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
    _listen?: (event: string, handler: (payload: unknown) => void) => Promise<() => void>,
  ) {}

  async connect(): Promise<void> {
    throw new Error(
      'MCP stdio servers are disabled in this build: PTYs do not provide a safe raw ' +
        'stdin/stdout process contract. Migrate the server to SSE (http/https) or ' +
        'WebSocket (wss, ws on localhost) in Settings → MCP, or wait for the safe ' +
        'raw-process transport. Your existing stdio command/args were preserved and not executed.',
    );
  }

  async disconnect(): Promise<void> {
    return;
  }

  async send(_message: JsonRpcRequest): Promise<JsonRpcResponse> {
    throw new Error(
      'MCP stdio servers are disabled in this build. Migrate to SSE or WebSocket to re-enable this server.',
    );
  }

  onNotification(_handler: (notification: JsonRpcNotification) => void): void {}

  async sendNotification(_notification: JsonRpcNotification): Promise<void> {
    throw new Error(
      'MCP stdio servers are disabled in this build. Migrate to SSE or WebSocket to re-enable this server.',
    );
  }
}

type PendingHttpRequest = {
  resolve: (response: JsonRpcResponse) => void;
  reject: (reason: Error) => void;
};

function endpointUrl(value: string, base: string): string {
  const endpoint = new URL(value, base);
  const origin = new URL(base);
  if (
    endpoint.origin !== origin.origin ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    throw new Error('MCP SSE endpoint must remain on the authenticated server origin.');
  }
  return endpoint.toString();
}

/** Authenticated fetch-based SSE transport with bounded requests and cancellation. */
export class FetchSseTransport implements McpTransport {
  private readonly config: McpServerConfig;
  private messagesUrl: string | null = null;
  private connectionController: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private notificationHandler: ((notification: JsonRpcNotification) => void) | null = null;
  private readonly pendingRequests = new Map<number | string, PendingHttpRequest>();
  private failure: Error | null = null;
  private endpointPromise: Promise<string>;
  private resolveEndpoint: ((url: string) => void) | null = null;
  private rejectEndpoint: ((error: Error) => void) | null = null;
  private disconnected = true;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.endpointPromise = this.createEndpointPromise();
  }

  private createEndpointPromise(): Promise<string> {
    this.endpointPromise = new Promise<string>((resolve, reject) => {
      this.resolveEndpoint = resolve;
      this.rejectEndpoint = reject;
    });
    void this.endpointPromise.catch(() => undefined);
    return this.endpointPromise;
  }

  async connect(options: McpRequestOptions = {}): Promise<void> {
    if (!this.config.url) throw new Error('SSE transport requires url');
    const url = new URL(this.config.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new Error('MCP SSE URL must use HTTP(S) and cannot contain credentials or fragments.');
    }
    const hasCredentials = Object.keys(this.config.headers ?? {}).length > 0;
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (hasCredentials && url.protocol !== 'https:' && !localHost) {
      throw new Error('MCP authentication headers require HTTPS except for loopback development servers.');
    }
    for (const [name, value] of Object.entries(this.config.headers ?? {})) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) {
        throw new Error('MCP authentication headers contain an invalid name or value.');
      }
    }
    if (this.config.capabilities.timeoutMs <= 0) {
      throw new Error('MCP connection timeout must be greater than zero.');
    }

    const controller = new AbortController();
    this.connectionController = controller;
    this.disconnected = false;
    this.failure = null;
    this.createEndpointPromise();
    let timedOut = false;
    const timeoutMs = options.timeoutMs ?? this.config.capabilities.timeoutMs;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...this.config.headers,
        },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`MCP SSE connection failed with HTTP ${response.status}.`);
      }
      if (!response.body) throw new Error('MCP SSE response did not include a readable stream.');
      this.reader = response.body.getReader();
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      void this.readStream(url.toString());
    } catch (error) {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      this.disconnected = true;
      if (timedOut) throw new Error(`MCP SSE connection timed out after ${timeoutMs}ms.`);
      if (options.signal?.aborted) throw new Error('MCP SSE connection was cancelled.');
      throw error;
    }
  }

  private async readStream(baseUrl: string): Promise<void> {
    if (!this.reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!this.disconnected) {
        const { done, value } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const eventText = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this.handleSseEvent(eventText, baseUrl);
          boundary = buffer.indexOf('\n\n');
        }
      }
      if (!this.disconnected) this.fail(new Error('MCP SSE stream ended unexpectedly.'));
    } catch (error) {
      if (!this.disconnected) this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleSseEvent(text: string, baseUrl: string): void {
    let event = 'message';
    const data: string[] = [];
    for (const line of text.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      if (field === 'data') data.push(value);
    }
    if (data.length === 0) return;
    const payload = data.join('\n');
    if (event === 'endpoint') {
      try {
        this.messagesUrl = endpointUrl(payload, baseUrl);
        this.resolveEndpoint?.(this.messagesUrl);
        this.resolveEndpoint = null;
        this.rejectEndpoint = null;
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (event !== 'message') return;
    try {
      const message = JSON.parse(payload) as JsonRpcResponse | JsonRpcNotification;
      if ('id' in message && this.pendingRequests.has(message.id)) {
        const pending = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);
        pending.resolve(message as JsonRpcResponse);
      } else if ('method' in message && !('id' in message)) {
        this.notificationHandler?.(message as JsonRpcNotification);
      }
    } catch (error) {
      console.warn('[MCP SSE] Ignoring malformed JSON event:', error);
    }
  }

  private fail(error: Error): void {
    this.failure = error;
    this.rejectEndpoint?.(error);
    this.rejectEndpoint = null;
    this.resolveEndpoint = null;
    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
    this.disconnected = true;
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
    this.connectionController?.abort();
    this.connectionController = null;
    if (this.reader) {
      await this.reader.cancel().catch(() => undefined);
      this.reader = null;
    }
    this.rejectEndpoint?.(new Error('MCP transport disconnected.'));
    this.rejectEndpoint = null;
    this.resolveEndpoint = null;
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('MCP transport disconnected.'));
    }
    this.pendingRequests.clear();
    this.messagesUrl = null;
  }

  async send(message: JsonRpcRequest, options: McpRequestOptions = {}): Promise<JsonRpcResponse> {
    if (this.disconnected) throw this.failure ?? new Error('MCP transport not connected.');
    if (options.signal?.aborted) throw new Error('MCP request was cancelled.');
    const timeoutMs = options.timeoutMs ?? this.config.capabilities.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    const pending = new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pendingRequests.set(message.id, { resolve, reject });
    });
    void pending.catch(() => undefined);
    const onRequestAbort = (): void => {
      const request = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      const error = timedOut
        ? new Error(`MCP request ${message.id} timed out after ${timeoutMs}ms.`)
        : new Error('MCP request was cancelled.');
      request?.reject(error);
      if (!timedOut && !this.disconnected) {
        void this.sendNotification({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: message.id, reason: 'Request aborted by client.' },
        }).catch(() => undefined);
      }
    };
    controller.signal.addEventListener('abort', onRequestAbort, { once: true });

    try {
      const url = await Promise.race([
        this.endpointPromise,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(timedOut ? new Error(`MCP endpoint wait timed out after ${timeoutMs}ms.`) : new Error('MCP request was cancelled.')),
            { once: true },
          );
        }),
      ]);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.config.headers },
        body: JSON.stringify(message),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        const request = this.pendingRequests.get(message.id);
        this.pendingRequests.delete(message.id);
        const error = new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
        request?.reject(error);
        throw error;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const json = (await response.json()) as JsonRpcResponse;
        if (json.id !== message.id) {
          throw new Error('MCP HTTP response ID does not match the request ID.');
        }
        this.pendingRequests.delete(message.id);
        return json;
      }
      return await pending;
    } catch (error) {
      this.pendingRequests.delete(message.id);
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      controller.signal.removeEventListener('abort', onRequestAbort);
    }
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  async sendNotification(
    notification: JsonRpcNotification,
    options: McpRequestOptions = {},
  ): Promise<void> {
    if (this.disconnected) throw new Error('MCP transport not connected.');
    const timeoutMs = options.timeoutMs ?? this.config.capabilities.timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    try {
      const url = await Promise.race([
        this.endpointPromise,
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error('MCP notification timed out or was cancelled.')), { once: true }),
        ),
      ]);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.config.headers },
        body: JSON.stringify(notification),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}

// ─── SSE Transport ──────────────────────────────────────────────────────────
// HTTP-based transport using POST for requests, SSE for server messages.

export class SseTransport implements McpTransport {
  constructor(_config: McpServerConfig) {}

  async connect(): Promise<void> {
    throw new Error('The legacy EventSource MCP transport is disabled; use FetchSseTransport.');
  }

  async disconnect(): Promise<void> {}

  async send(_message: JsonRpcRequest): Promise<JsonRpcResponse> {
    throw new Error('The legacy EventSource MCP transport is disabled; use FetchSseTransport.');
  }

  onNotification(_handler: (notification: JsonRpcNotification) => void): void {}

  async sendNotification(_notification: JsonRpcNotification): Promise<void> {
    throw new Error('The legacy EventSource MCP transport is disabled; use FetchSseTransport.');
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
    if (Object.keys(this.config.headers ?? {}).length > 0) {
      throw new Error('MCP WebSocket transport cannot securely apply custom authentication headers.');
    }
    const wsUrl = this.config.wsUrl;
    if (!wsUrl) throw new Error('WebSocket transport requires wsUrl');
    const url = new URL(wsUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      !['wss:', ...(local ? ['ws:'] : [])].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error('MCP WebSocket URL must use wss (or ws on localhost) and contain no credentials.');
    }
    await this.openSocket(false, this.config.capabilities.timeoutMs);
  }

  private openSocket(isReconnect: boolean, timeoutMs = 10_000): Promise<void> {
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
        this.openSocket(true, timeoutMs).catch((err) => {
          console.warn('[WebSocketTransport] Auto-reconnect failed:', err);
        });
      }
    });

    // Wait for open or error
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`WebSocket connection timeout after ${timeoutMs}ms`)), timeoutMs);

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

  async send(message: JsonRpcRequest, options: McpRequestOptions = {}): Promise<JsonRpcResponse> {
    const payload = JSON.stringify(message);
    if (
      !this.ws ||
      (this.ws.readyState !== WebSocket.OPEN && this.ws.readyState !== WebSocket.CONNECTING)
    ) {
      throw new Error('WebSocket not connected');
    }

    const timeoutMs = options.timeoutMs ?? this.config.capabilities.timeoutMs ?? 30_000;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        this.pendingRequests.delete(message.id);
        cleanup();
        action();
      };
      const onAbort = (): void => {
        this.messageQueue = this.messageQueue.filter((queued) => {
          try {
            return JSON.parse(queued).id !== message.id;
          } catch {
            return true;
          }
        });
        if (this.ws?.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/cancelled',
              params: { requestId: message.id, reason: 'Request aborted by client.' },
            }));
          } catch (error) {
            console.warn('[WebSocketTransport] Could not send cancellation notification:', error);
          }
        }
        finish(() => reject(new Error('MCP WebSocket request was cancelled.')));
      };
      const timeout = setTimeout(
        () => finish(() => reject(new Error(`MCP WebSocket request ${message.id} timed out after ${timeoutMs}ms.`))),
        timeoutMs,
      );
      options.signal?.addEventListener('abort', onAbort, { once: true });
      this.pendingRequests.set(message.id, {
        resolve: (response) => finish(() => resolve(response)),
        reject: (error) => finish(() => reject(error)),
      });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      try {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(payload);
        else this.messageQueue.push(payload);
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  async sendNotification(
    notification: JsonRpcNotification,
    options: McpRequestOptions = {},
  ): Promise<void> {
    if (options.signal?.aborted) throw new Error('MCP WebSocket notification was cancelled.');
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
  private callWaiters = new Map<
    string,
    Array<{ signal?: AbortSignal; onAbort: () => void; resolve: () => void; reject: (error: Error) => void }>
  >();

  constructor(
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
    listen?: (event: string, handler: (payload: unknown) => void) => Promise<() => void>,
  ) {
    this.invoke = invoke;
    this.listen = listen;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async connect(config: McpServerConfig): Promise<McpConnection> {
    const timeoutMs = config.capabilities.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000) {
      throw new Error('MCP timeoutMs must be between 1 and 600000 milliseconds.');
    }
    if (!Number.isFinite(config.capabilities.maxConcurrentCalls) || config.capabilities.maxConcurrentCalls < 1) {
      throw new Error('MCP maxConcurrentCalls must be a positive integer.');
    }
    if (!Number.isInteger(config.capabilities.maxConcurrentCalls)) {
      throw new Error('MCP maxConcurrentCalls must be a positive integer.');
    }
    await this.disconnect(config.id);
    // Create transport
    let transport: McpTransport;
    switch (config.transport) {
      case 'stdio':
        transport = new StdioTransport(config, this.invoke, this.listen);
        break;
      case 'sse':
        transport = new FetchSseTransport(config);
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
      await transport.connect({ timeoutMs: config.capabilities.timeoutMs });

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
      return this.publicConnection(connection);
    } catch (err) {
      connection.status = 'error';
      connection.error = err instanceof Error ? err.message : String(err);
      console.warn(`[McpClientManager] connect failed for "${config.id}":`, err);
      // Don't leave a broken entry in the map — callers must not route to it.
      // Preserve the failed connection record so callers can inspect and retry
      // the actionable startup error instead of losing it during cleanup.
      try {
        await transport.disconnect();
      } catch (disconnectErr) {
        console.warn(`[McpClientManager] transport cleanup failed for "${config.id}":`, disconnectErr);
      }
      return this.publicConnection(connection);
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    const waiters = this.callWaiters.get(serverId) ?? [];
    this.callWaiters.delete(serverId);
    for (const waiter of waiters) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(new Error(`MCP server "${serverId}" disconnected while waiting for capacity.`));
    }
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
    return Array.from(this.connections.values()).map((connection) =>
      this.publicConnection(connection),
    );
  }

  private publicConnection(connection: McpConnection & { transport: McpTransport }): McpConnection {
    const { transport: _transport, ...publicConnection } = connection;
    return {
      ...publicConnection,
      config: {
        ...connection.config,
        headers: connection.config.headers
          ? Object.fromEntries(Object.keys(connection.config.headers).map((name) => [name, '[redacted]']))
          : undefined,
      },
    };
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
    options: McpRequestOptions = {},
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

    await this.acquireSlot(serverId, options.signal);
    try {
      const result = await this.rpcCall(serverId, 'tools/call', {
        name: toolName,
        arguments: args || {},
      }, options);
      return result as McpToolResult;
    } finally {
      this.releaseSlot(serverId);
    }
  }

  private async acquireSlot(serverId: string, signal?: AbortSignal): Promise<void> {
    const conn = this.connections.get(serverId);
    const max = conn?.config.capabilities.maxConcurrentCalls ?? Infinity;
    if (signal?.aborted) throw new Error('MCP tool call was cancelled before dispatch.');
    const active = this.activeCalls.get(serverId) ?? 0;
    if (active < max) {
      this.activeCalls.set(serverId, active + 1);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiters = this.callWaiters.get(serverId) ?? [];
      const waiter = {
        signal,
        resolve: () => {
          signal?.removeEventListener('abort', waiter.onAbort);
          this.activeCalls.set(serverId, (this.activeCalls.get(serverId) ?? 0) + 1);
          resolve();
        },
        reject,
        onAbort: (): void => {
          const current = this.callWaiters.get(serverId) ?? [];
          this.callWaiters.set(serverId, current.filter((candidate) => candidate !== waiter));
          reject(new Error('MCP tool call was cancelled while waiting for capacity.'));
        },
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      waiters.push(waiter);
      this.callWaiters.set(serverId, waiters);
      if (signal?.aborted) waiter.onAbort();
    });
  }

  private releaseSlot(serverId: string): void {
    const active = this.activeCalls.get(serverId) ?? 1;
    this.activeCalls.set(serverId, Math.max(0, active - 1));
    const waiters = this.callWaiters.get(serverId);
    let next = waiters?.shift();
    while (next?.signal?.aborted) {
      next.reject(new Error('MCP tool call was cancelled while waiting for capacity.'));
      next = waiters?.shift();
    }
    if (next) next.resolve();
  }

  private async rpcCall(
    serverId: string,
    method: string,
    params?: Record<string, unknown>,
    options: McpRequestOptions = {},
  ): Promise<unknown> {
    const conn = this.connections.get(serverId);
    if (!conn || conn.status === 'error' || conn.status === 'disconnected') {
      throw new Error(`Server "${serverId}" not connected`);
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    let response: JsonRpcResponse;
    try {
      response = await conn.transport.send(request, {
        ...options,
        timeoutMs: options.timeoutMs ?? conn.config.capabilities.timeoutMs,
      });
    } catch (error) {
      // Only poison the connection record for transport-level disconnects.
      // Transient per-request failures (timeout, HTTP 5xx, cancel) must not
      // flip a healthy connection to `error`: the SSE stream / WebSocket is
      // still usable for the next call.
      if (options.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/not connected|disconnected|stream ended|connection (failed|closed)/i.test(message)) {
        conn.status = 'error';
        conn.error = message;
      }
      throw error;
    }

    if (response.error) {
      throw new Error(`MCP error ${response.error.code}: ${response.error.message}`);
    }

    return response.result;
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

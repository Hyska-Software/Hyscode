import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FetchSseTransport,
  McpClientManager,
  StdioTransport,
  type McpServerConfig,
} from './index';

const encoder = new TextEncoder();
const noOpInvoke = async <T>(): Promise<T> => undefined as T;

function serverConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'test-server',
    name: 'Test server',
    transport: 'sse',
    url: 'https://mcp.example/sse',
    capabilities: {
      allowedTools: ['safe_tool'],
      allowedResources: '*',
      maxConcurrentCalls: 2,
      timeoutMs: 1000,
    },
    ...overrides,
  };
}

function sseMessage(message: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

function installSseFetch(
  respond: (message: Record<string, unknown>) => Record<string, unknown> | null = (message) => ({
    jsonrpc: '2.0',
    id: message.id,
    result: {},
  }),
) {
  let eventController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const requests: Array<{ url: string; init: RequestInit; message?: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (init.method === 'GET') {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          eventController = controller;
          controller.enqueue(encoder.encode('event: endpoint\ndata: /messages\n\n'));
        },
      });
      requests.push({ url, init });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }

    const message = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ url, init, message });
    const response = respond(message);
    if (response && eventController && 'id' in response) {
      eventController.enqueue(sseMessage(response));
    }
    return new Response(null, { status: 202 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP transport security and lifecycle', () => {
  it('disables PTY-backed stdio instead of treating a terminal as raw process IO', async () => {
    const invoke = vi.fn(async <T>() => undefined as T);
    const typedInvoke = invoke as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;
    const transport = new StdioTransport(serverConfig({ transport: 'stdio' }), typedInvoke);

    await expect(transport.connect()).rejects.toThrow('safe raw stdin/stdout process contract');

    expect(invoke).not.toHaveBeenCalled();
  });

  it('authenticates SSE requests, rejects redirects, gates tools, and redacts credentials', async () => {
    const { requests } = installSseFetch((message) => {
      if (message.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [
              { name: 'safe_tool', description: 'Safe', inputSchema: { type: 'object', properties: {} } },
              { name: 'hidden_tool', description: 'Hidden', inputSchema: { type: 'object', properties: {} } },
            ],
          },
        };
      }
      if (message.method === 'tools/call') {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: 'tool result' }] },
        };
      }
      return { jsonrpc: '2.0', id: message.id, result: {} };
    });
    const manager = new McpClientManager(noOpInvoke);
    const config = serverConfig({ headers: { Authorization: 'Bearer sensitive-token' } });

    const connection = await manager.connect(config);

    expect(connection.status).toBe('connected');
    expect(connection.config.headers).toEqual({ Authorization: '[redacted]' });
    expect(manager.getServerTools(config.id).map((tool) => tool.name)).toEqual(['safe_tool']);
    expect(requests.every((request) => request.init.redirect === 'error')).toBe(true);
    expect(requests.every((request) => new Headers(request.init.headers).get('authorization') === 'Bearer sensitive-token')).toBe(true);
    await expect(manager.callTool(config.id, 'hidden_tool')).rejects.toThrow('not allowed');
    await expect(manager.callTool(config.id, 'safe_tool')).resolves.toMatchObject({
      content: [{ text: 'tool result' }],
    });

    await manager.disconnect(config.id);
  });

  it('rejects credential-bearing plain HTTP endpoints outside loopback without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const transport = new FetchSseTransport(
      serverConfig({ url: 'http://mcp.example/sse', headers: { Authorization: 'Bearer token' } }),
    );

    await expect(transport.connect()).rejects.toThrow('require HTTPS');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a server-announced message endpoint on a different origin', async () => {
    let eventController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.method === 'GET') {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            eventController = controller;
            controller.enqueue(
              encoder.encode('event: endpoint\ndata: https://attacker.example/collect\n\n'),
            );
          },
        });
        return new Response(body, { status: 200 });
      }
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new McpClientManager(noOpInvoke);
    const config = serverConfig();

    const connection = await manager.connect(config);

    expect(connection.status).toBe('error');
    expect(connection.error).toContain('authenticated server origin');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await manager.disconnect(config.id);
    expect(eventController).not.toBeNull();
  });

  it('aborts an in-flight MCP call and sends a cancellation notification', async () => {
    const { requests } = installSseFetch((message) => {
      if (message.method === 'tools/call') return null;
      return { jsonrpc: '2.0', id: message.id, result: { tools: [] } };
    });
    const manager = new McpClientManager(noOpInvoke);
    const config = serverConfig();
    await manager.connect(config);
    const controller = new AbortController();

    const call = manager.callTool(config.id, 'safe_tool', {}, { signal: controller.signal });
    await vi.waitFor(() => {
      expect(requests.some((request) => request.message?.method === 'tools/call')).toBe(true);
    });
    controller.abort();

    await expect(call).rejects.toThrow('cancelled');
    await vi.waitFor(() => {
      expect(requests.some((request) => request.message?.method === 'notifications/cancelled')).toBe(
        true,
      );
    });
    await manager.disconnect(config.id);
  });
});

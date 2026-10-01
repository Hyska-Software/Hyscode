import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));

import { createTauriFetch } from './tauri-ai-transport';

type ChunkPayload = {
  requestId: string;
  data: string;
  done: boolean;
  error?: string | null;
  statusCode?: number | null;
  retryAfterMs?: number | null;
  errorKind?: string | null;
  errorPhase?: string | null;
};

describe('Tauri AI transport', () => {
  let onChunk: ((event: { payload: ChunkPayload }) => void) | null;

  beforeEach(() => {
    onChunk = null;
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.listen.mockImplementation(async (_event: string, handler: typeof onChunk) => {
      onChunk = handler;
      return () => {
        onChunk = null;
      };
    });
    mocks.invoke.mockImplementation(async (command: string, args: unknown) => {
      if (command === 'ai_stream_request') {
        const request = (args as { request: { requestId: string } }).request;
        onChunk?.({
          payload: {
            requestId: request.requestId,
            data: 'model-list',
            done: true,
            statusCode: 200,
          },
        });
      }
      return undefined;
    });
  });

  it('preserves GET for authenticated model-list requests and omits an empty body', async () => {
    const fetch = createTauriFetch();
    const response = await fetch('https://opencode.ai/zen/v1/models', {
      headers: { Authorization: 'Bearer provider-secret' },
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('model-list');
    expect(mocks.invoke).toHaveBeenCalledWith(
      'ai_stream_request',
      expect.objectContaining({
        request: expect.objectContaining({
          method: 'GET',
          body: '',
          url: 'https://opencode.ai/zen/v1/models',
          headers: {},
        }),
      }),
    );
  });

  it('preserves POST bodies when the input is a Request object', async () => {
    const fetch = createTauriFetch();
    const request = new Request('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer provider-secret' },
      body: '{"stream":true}',
    });

    const response = await fetch(request);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('model-list');
    expect(mocks.invoke).toHaveBeenCalledWith(
      'ai_stream_request',
      expect.objectContaining({
        request: expect.objectContaining({
          method: 'POST',
          body: '{"stream":true}',
          headers: { 'content-type': 'application/json' },
        }),
      }),
    );
  });

  it('does not start a native request for an already-aborted signal', async () => {
    const fetch = createTauriFetch();
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalledWith('ai_stream_request', expect.anything());
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from './types';
import { webFetchTool, webSearchTool } from './tools';

function mockContext(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>): ToolExecutionContext {
  return {
    workspacePath: '/workspace',
    conversationId: 'conv-1',
    toolCallId: 'tc-1',
    signal: new AbortController().signal,
    invoke,
  } as ToolExecutionContext;
}

describe('webSearchTool', () => {
  it('formats results with titles, URLs and snippets', async () => {
    const invoke = vi.fn().mockResolvedValue({
      query: 'rust async',
      results: [
        { title: 'Async Book', url: 'https://example.com/async', snippet: 'Learn async rust.' },
      ],
    });
    const result = await webSearchTool.execute({ query: 'rust async' }, mockContext(invoke));

    expect(result.success).toBe(true);
    expect(result.output).toContain('Search: "rust async"');
    expect(result.output).toContain('1. Async Book');
    expect(result.output).toContain('URL: https://example.com/async');
    expect(result.output).toContain('Learn async rust.');
    expect(result.metadata).toEqual({ query: 'rust async', resultCount: 1 });
    expect(invoke).toHaveBeenCalledWith('web_search', { query: 'rust async', maxResults: 5 });
  });

  it('clamps max_results to 1..10 before invoking', async () => {
    const invoke = vi.fn().mockResolvedValue({ query: 'q', results: [] });
    await webSearchTool.execute({ query: 'q', max_results: 0 }, mockContext(invoke));
    expect(invoke).toHaveBeenCalledWith('web_search', { query: 'q', maxResults: 1 });

    await webSearchTool.execute({ query: 'q', max_results: 999 }, mockContext(invoke));
    expect(invoke).toHaveBeenCalledWith('web_search', { query: 'q', maxResults: 10 });
  });

  it('reports empty results as a successful "no results" message', async () => {
    const invoke = vi.fn().mockResolvedValue({ query: 'nothing here', results: [] });
    const result = await webSearchTool.execute({ query: 'nothing here' }, mockContext(invoke));
    expect(result.success).toBe(true);
    expect(result.output).toContain('No results found');
  });

  it('maps engine_blocked backend errors to a friendly message', async () => {
    const invoke = vi.fn().mockRejectedValue(
      '[engine_blocked] The search engine blocked the request (anomaly/CAPTCHA detected). Try again later or rephrase the query.',
    );
    const result = await webSearchTool.execute({ query: 'x' }, mockContext(invoke));
    expect(result.success).toBe(false);
    expect(result.error).toContain('search engine blocked');
  });

  it('propagates unknown errors verbatim', async () => {
    const invoke = vi.fn().mockRejectedValue('random failure');
    const result = await webSearchTool.execute({ query: 'x' }, mockContext(invoke));
    expect(result.success).toBe(false);
    expect(result.error).toBe('random failure');
  });
});

describe('webFetchTool', () => {
  it('formats fetched page content', async () => {
    const invoke = vi.fn().mockResolvedValue({
      title: 'Docs',
      url: 'https://example.com/docs',
      text: 'Page body text.',
      length: 16,
      truncated: false,
      metadata: { content_type: 'text/html', status: 200 },
    });
    const result = await webFetchTool.execute(
      { url: 'https://example.com/docs', max_length: 5000 },
      mockContext(invoke),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Title: Docs');
    expect(result.output).toContain('URL: https://example.com/docs');
    expect(result.output).toContain('Status: 200 | text/html');
    expect(result.output).toContain('Page body text.');
    expect(invoke).toHaveBeenCalledWith('web_fetch', { url: 'https://example.com/docs', maxLength: 5000 });
  });

  it('rejects non-http(s) URLs without invoking the backend', async () => {
    const invoke = vi.fn();
    const result = await webFetchTool.execute({ url: 'file:///etc/passwd' }, mockContext(invoke));
    expect(result.success).toBe(false);
    expect(result.error).toBe('Only http and https URLs are allowed.');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs without invoking the backend', async () => {
    const invoke = vi.fn();
    const result = await webFetchTool.execute({ url: 'not a url' }, mockContext(invoke));
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid URL format.');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('maps http_status backend errors to a friendly message', async () => {
    const invoke = vi.fn().mockRejectedValue('[http_status] HTTP 404 error fetching https://example.com/missing');
    const result = await webFetchTool.execute({ url: 'https://example.com/missing' }, mockContext(invoke));
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP error');
    expect(result.error).toContain('404');
  });

  it('lets the backend own SSRF decisions (private host passed through)', async () => {
    const invoke = vi.fn().mockRejectedValue('[private_address] Fetching internal/private addresses is not allowed (127.0.0.1).');
    const result = await webFetchTool.execute({ url: 'http://127.0.0.1/' }, mockContext(invoke));
    expect(result.success).toBe(false);
    expect(result.error).toContain('internal/private addresses');
    expect(invoke).toHaveBeenCalledWith('web_fetch', { url: 'http://127.0.0.1/', maxLength: 10000 });
  });
});

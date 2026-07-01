// ─── Tauri AI Transport ───────────────────────────────────────────────────────
// A drop-in replacement for globalThis.fetch that routes AI provider requests
// through the Tauri Rust backend, bypassing browser CORS restrictions.
// The Rust command injects the API key from the keychain and streams the
// response back via `ai:chunk` Tauri events.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { FetchImpl } from '@hyscode/ai-providers';
import {
  DEFAULT_RESILIENCE_CONFIG,
  type ProviderErrorKind,
  type ProviderErrorPhase,
  type ResilienceConfig,
} from '@hyscode/ai-providers';
// FetchImpl is re-exported from ai-providers types

// ─── Types matching the Rust AiStreamChunk struct ─────────────────────────

interface AiStreamChunk {
  request_id: string;
  data: string;
  done: boolean;
  error?: string | null;
  status_code?: number | null;
  retry_after_ms?: number | null;
  error_kind?: ProviderErrorKind | null;
  error_phase?: ProviderErrorPhase | null;
}

// ─── Provider detection ───────────────────────────────────────────────────

function detectProvider(url: string): string {
  if (url.includes('api.anthropic.com')) return 'anthropic';
  if (url.includes('api.openai.com')) return 'openai';
  if (url.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('api.githubcopilot.com')) return 'github-copilot';
  if (url.includes('opencode.ai/zen/go')) return 'opencode-go';
  if (url.includes('opencode.ai/zen')) return 'opencode-zen';
  return 'ollama';
}

// ─── Header extraction ────────────────────────────────────────────────────
// Strip auth headers — Rust injects them from the keychain.

function extractHeaders(init?: RequestInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!init?.headers) return result;

  const authKeys = new Set(['x-api-key', 'authorization', 'x-goog-api-key']);
  const h = new Headers(init.headers as HeadersInit);
  h.forEach((value, key) => {
    if (!authKeys.has(key.toLowerCase())) {
      result[key] = value;
    }
  });
  return result;
}

// ─── Unique request ID ────────────────────────────────────────────────────

let _counter = 0;
function nextRequestId(): string {
  return `ai-${Date.now()}-${++_counter}`;
}

// ─── Transport factory ────────────────────────────────────────────────────

/**
 * Returns a `fetch`-compatible function that routes requests through the Tauri
 * `ai_stream_request` command instead of making direct browser HTTP calls.
 */
let activeResilienceConfig: ResilienceConfig = DEFAULT_RESILIENCE_CONFIG;

export function createTauriFetch(resilience: Partial<ResilienceConfig> = {}): FetchImpl {
  activeResilienceConfig = { ...DEFAULT_RESILIENCE_CONFIG, ...resilience };
  return async function tauriFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const config = activeResilienceConfig;
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    const body =
      typeof init?.body === 'string'
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : JSON.stringify(init?.body ?? '');

    const provider = detectProvider(url);
    const headers = extractHeaders(init);
    const requestId = nextRequestId();
    const encoder = new TextEncoder();

    // Queue for chunks produced by the event listener before they're consumed.
    const chunkQueue: Array<string | null | Error> = [];
    // Resolves when a new item is pushed to chunkQueue while a pull is waiting.
    let wakeConsumer: (() => void) | null = null;

    // Status resolution — wait for the first chunk to get the HTTP status code.
    let resolveStatus!: (code: number) => void;
    let rejectStatus!: (err: Error) => void;
    const statusPromise = new Promise<number>((res, rej) => {
      resolveStatus = res;
      rejectStatus = rej;
    });

    let statusResolved = false;
    let retryAfterMs: number | null = null;
    let transportErrorKind: ProviderErrorKind | null = null;
    let transportErrorPhase: ProviderErrorPhase | null = null;
    let disposed = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelNativeRequest = (): void => {
      void invoke('ai_stream_cancel', { requestId }).catch(() => undefined);
    };

    const clearIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    };

    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      clearIdleTimer();
      unlisten();
    };

    const resetIdleTimer = (): void => {
      clearIdleTimer();
      idleTimer = setTimeout(() => {
        cancelNativeRequest();
        enqueue(new Error(`Stream idle timeout after ${config.streamIdleTimeoutMs}ms`));
      }, config.streamIdleTimeoutMs);
    };

    function enqueue(item: string | null | Error): void {
      chunkQueue.push(item);
      if (wakeConsumer) {
        const fn = wakeConsumer;
        wakeConsumer = null;
        fn();
      }
    }

    function onChunk(chunk: AiStreamChunk): void {
      if (disposed) return;
      resetIdleTimer();
      if (!statusResolved) {
        statusResolved = true;
        retryAfterMs = chunk.retry_after_ms ?? null;
        transportErrorKind = chunk.error_kind ?? null;
        transportErrorPhase = chunk.error_phase ?? null;
        const code = chunk.status_code ?? 200;

        if (chunk.error && chunk.done) {
          if (chunk.status_code == null) {
            rejectStatus(new Error(chunk.error));
            dispose();
            return;
          }
          // HTTP-level error (4xx/5xx) — put the error body in the queue and close.
          resolveStatus(code);
          if (chunk.data) enqueue(chunk.data);
          enqueue(null);
          return;
        }

        resolveStatus(code);
        if (chunk.data) enqueue(chunk.data);
        if (chunk.done) enqueue(null);
        return;
      }

      if (chunk.error && !chunk.done) {
        enqueue(new Error(chunk.error));
        return;
      }
      if (chunk.done) {
        if (chunk.error) enqueue(new Error(chunk.error));
        enqueue(null);
        return;
      }
      if (chunk.data) {
        enqueue(chunk.data);
      }
    }

    // Register the event listener before invoking so no chunks are missed.
    const unlisten = await listen<AiStreamChunk>('ai:chunk', (event) => {
      if (event.payload.request_id === requestId) {
        onChunk(event.payload);
      }
    });

    // Going offline is not a retry attempt: wait until connectivity returns.
    try {
      await waitUntilOnline(init?.signal ?? undefined);
    } catch (error) {
      dispose();
      throw error;
    }

    // Start the streaming request in Rust.
    try {
      await invoke<void>('ai_stream_request', {
        request: {
          request_id: requestId,
          provider,
          url,
          headers,
          body,
          timeout_ms: config.requestTimeoutMs,
        },
      });
    } catch (err) {
      dispose();
      rejectStatus(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }

    // If the AbortSignal fires before the first chunk, reject the status promise.
    const signal = init?.signal;
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          cancelNativeRequest();
          dispose();
          if (!statusResolved) {
            statusResolved = true;
            rejectStatus(new Error('Request aborted'));
          } else {
            enqueue(new Error('Request aborted'));
          }
        },
        { once: true },
      );
    }

    // Await first chunk to determine HTTP status code.
    const statusCode = await statusPromise;

    // Build a ReadableStream that pulls from the chunk queue.
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        // Wait until a chunk is available.
        while (chunkQueue.length === 0) {
          if (signal?.aborted) {
            dispose();
            controller.close();
            return;
          }
          await new Promise<void>((res) => {
            wakeConsumer = res;
          });
        }

        const item = chunkQueue.shift()!;
        if (item === null) {
          dispose();
          controller.close();
        } else if (item instanceof Error) {
          dispose();
          controller.error(item);
        } else {
          controller.enqueue(encoder.encode(item));
        }
      },
      cancel() {
        cancelNativeRequest();
        dispose();
      },
    });

    const responseHeaders: Record<string, string> = { 'content-type': 'text/event-stream' };
    if (retryAfterMs != null) responseHeaders['retry-after'] = String(retryAfterMs / 1000);
    if (transportErrorKind) responseHeaders['x-hyscode-error-kind'] = transportErrorKind;
    if (transportErrorPhase) responseHeaders['x-hyscode-error-phase'] = transportErrorPhase;
    return new Response(stream, {
      status: statusCode,
      headers: responseHeaders,
    });
  };
}

function waitUntilOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      window.removeEventListener('online', handleOnline);
      signal?.removeEventListener('abort', handleAbort);
    };
    const handleOnline = (): void => {
      cleanup();
      resolve();
    };
    const handleAbort = (): void => {
      cleanup();
      reject(signal?.reason ?? new DOMException('Request aborted', 'AbortError'));
    };
    window.addEventListener('online', handleOnline, { once: true });
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

import { type RetryConfig, ProviderError, classifyProviderErrorKind } from './types';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  retryableStatuses: [429, 500, 502, 503, 529],
};

function jitter(delayMs: number): number {
  return delayMs * (0.5 + Math.random() * 0.5);
}

function getDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(jitter(exponential), config.maxDelayMs);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const cfg: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Never retry aborted requests — the caller explicitly cancelled.
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || err.message === 'Request aborted')
      ) {
        throw err;
      }

      if (err instanceof ProviderError) {
        // Auth errors should not be retried
        if (err.statusCode === 401 || err.statusCode === 403) {
          throw err;
        }
        // Only retry if the status is in the retryable list
        if (err.statusCode && !cfg.retryableStatuses.includes(err.statusCode)) {
          throw err;
        }
        if (!err.statusCode) throw err;
      } else {
        // Unknown transport errors may occur after the provider accepted a billable
        // request. Do not retry without an explicit pre-response retryable status.
        throw err;
      }

      if (attempt < cfg.maxRetries) {
        const delay =
          err instanceof ProviderError && err.retryAfterMs != null
            ? err.retryAfterMs
            : getDelay(attempt, cfg);
        cfg.onRetry?.(attempt + 1, err, delay);
        await abortableDelay(delay, cfg.signal);
        cfg.onRetryStart?.(attempt + 1);
      }
    }
  }

  throw lastError;
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function normalizeProviderError(
  error: unknown,
  provider: string,
  phase: 'connecting' | 'streaming' | 'parsing',
): ProviderError {
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const classifiedKind = classifyProviderErrorKind(message);
  const kind =
    phase === 'connecting' && classifiedKind === 'stream_interrupted'
      ? 'connection'
      : classifiedKind;
  const cancelled = kind === 'cancelled';
  const retryable =
    phase === 'connecting' && !cancelled && ['connection', 'offline', 'timeout'].includes(kind);
  return new ProviderError(message, provider, undefined, retryable, undefined, kind, phase);
}

/**
 * Parse SSE (Server-Sent Events) stream into individual events.
 * Accumulates data per event frame (blank-line-delimited) per the SSE spec.
 * Handles both `data: value` and `data:value` (space is optional per spec).
 * Multi-line events (multiple `data:` lines in one frame) are joined with `\n`.
 */
export async function* parseSSEStream(
  response: Response,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';

  function extractFrameData(frame: string): string | null {
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      const trimmed = line.trimEnd();
      if (trimmed.startsWith(':')) continue; // SSE comment
      if (trimmed.startsWith('data:')) {
        // Strip the single optional space after the colon.
        const value = trimmed.slice(5).replace(/^ /, '');
        dataLines.push(value);
      }
    }
    return dataLines.length > 0 ? dataLines.join('\n') : null;
  }

  function* processBuffer(): Iterable<string> {
    // Extract complete SSE event frames (separated by \n\n).
    let frameEnd: number;
    while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);

      const data = extractFrameData(frame);
      if (data === null) continue;
      if (data === '[DONE]') return;
      yield data;
    }
  }

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      yield* processBuffer();
    }

    // Flush decoder and process any remaining complete frames.
    buffer += decoder.decode();
    yield* processBuffer();

    // Handle a final partial frame with no trailing \n\n.
    if (buffer.trim()) {
      const data = extractFrameData(buffer);
      if (data !== null && data !== '[DONE]') {
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse NDJSON (newline-delimited JSON) stream.
 * Used by Ollama which returns one JSON object per line.
 */
export async function* parseNDJSONStream(
  response: Response,
  signal?: AbortSignal,
): AsyncIterable<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed);
        } catch (error) {
          throw new ProviderError(
            `Malformed NDJSON response: ${error instanceof Error ? error.message : String(error)}`,
            'ollama',
            undefined,
            false,
            undefined,
            'invalid_response',
            'parsing',
          );
        }
      }
    }

    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim());
      } catch (error) {
        throw new ProviderError(
          `Malformed final NDJSON response: ${error instanceof Error ? error.message : String(error)}`,
          'ollama',
          undefined,
          false,
          undefined,
          'invalid_response',
          'parsing',
        );
      }
    }
  } finally {
    reader.releaseLock();
  }
}

import { type RetryConfig, ProviderError, classifyProviderErrorKind } from './types';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  retryableStatuses: [429, 500, 502, 503, 529],
  requestTimeoutMs: 120_000,
  streamIdleTimeoutMs: 90_000,
};

function jitter(delayMs: number): number {
  return delayMs * (0.5 + Math.random() * 0.5);
}

function getDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(jitter(exponential), config.maxDelayMs);
}

export async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const cfg: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await withRequestTimeout(fn, cfg.requestTimeoutMs, cfg.signal);
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
        if (err.statusCode !== undefined) {
          // HTTP retries are limited to explicitly retryable statuses.
          if (!cfg.retryableStatuses.includes(err.statusCode)) {
            throw err;
          }
        } else if (!err.retryable) {
          // A status-less retryable ProviderError is produced only for a
          // pre-response transport failure. Once content has streamed, the
          // normalized error is non-retryable to avoid duplicate charges.
          throw err;
        }
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

/**
 * Race a single attempt against `requestTimeoutMs`. Uses a `setTimeout` that
 * rejects with a timeout ProviderError so slow connects don't hang forever.
 * When the caller passes its own `signal`, an abort still wins immediately.
 */
function withRequestTimeout<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  requestTimeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
  }
  if (!requestTimeoutMs || requestTimeoutMs <= 0) return fn(signal);

  const timeoutController = new AbortController();
  const attemptSignal = signal
    ? combineAbortSignals(signal, timeoutController.signal)
    : timeoutController.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeoutError = new ProviderError(
        `Request timed out after ${requestTimeoutMs}ms`,
        'unknown',
        undefined,
        true,
        undefined,
        'timeout',
        'connecting',
      );
      timeoutController.abort(timeoutError);
      reject(timeoutError);
    }, requestTimeoutMs);
    onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Request aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([Promise.resolve().then(() => fn(attemptSignal)), timeoutPromise]).finally(
    () => {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    },
  );
}

function combineAbortSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  const abortSignal = AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  };
  if (abortSignal.any) return abortSignal.any([first, second]);

  const controller = new AbortController();
  const sources = [first, second];
  const listeners = new Map<AbortSignal, () => void>();
  const cleanup = () => {
    for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
    listeners.clear();
  };
  for (const source of sources) {
    const abort = () => {
      if (!controller.signal.aborted) controller.abort(source.reason);
      cleanup();
    };
    if (source.aborted) {
      abort();
      break;
    }
    listeners.set(source, abort);
    source.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

function createReaderCancellation(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): { cancel: () => Promise<void>; dispose: () => void } {
  let cancelPromise: Promise<void> | undefined;
  const cancel = (): Promise<void> => {
    cancelPromise ??= reader.cancel().then(
      () => undefined,
      () => undefined,
    );
    return cancelPromise;
  };
  const onAbort = () => {
    void cancel();
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  return {
    cancel,
    dispose: () => signal?.removeEventListener('abort', onAbort),
  };
}

/**
 * Wrap an async iterable so a stalled stream (no chunks for
 * `streamIdleTimeoutMs`) aborts via the returned controller. Callers forward
 * `controller.signal` into the fetch and break the loop on abort.
 */
export function withStreamIdleTimeout<T>(
  stream: AsyncIterable<T>,
  streamIdleTimeoutMs: number | undefined,
  signal?: AbortSignal,
): { stream: AsyncIterable<T>; controller: AbortController } {
  const controller = new AbortController();
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  if (!streamIdleTimeoutMs || streamIdleTimeoutMs <= 0) return { stream, controller };
  const wrapped: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      const iter = stream[Symbol.asyncIterator]();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const reset = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(
          () =>
            controller.abort(
              new ProviderError(
                `Stream idle for ${streamIdleTimeoutMs}ms`,
                'unknown',
                undefined,
                true,
                undefined,
                'timeout',
                'streaming',
              ),
            ),
          streamIdleTimeoutMs,
        );
      };
      reset();
      return {
        next: async (...args: []) => {
          try {
            const result = await iter.next(...args);
            if (!result.done) reset();
            else if (timer) clearTimeout(timer);
            return result;
          } catch (err) {
            if (timer) clearTimeout(timer);
            throw err;
          }
        },
        return: async (value?: unknown) => {
          if (timer) clearTimeout(timer);
          return iter.return?.(value as never) ?? ({ done: true, value } as IteratorResult<T>);
        },
        throw: async (e?: unknown) => {
          if (timer) clearTimeout(timer);
          if (iter.throw) return iter.throw(e);
          throw e;
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
  return { stream: wrapped, controller };
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
  let streamDone = false;
  const cancellation = createReaderCancellation(reader, signal);

  function extractFrameData(frame: string): string | null {
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
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
    // Extract complete SSE event frames. Per the SSE spec, frames are separated
    // by a blank line, which may use LF (\n\n) or CRLF (\r\n\r\n) endings.
    let frameMatch: RegExpExecArray | null;
    while ((frameMatch = /\r?\n\r?\n/.exec(buffer)) !== null) {
      const frame = buffer.slice(0, frameMatch.index);
      buffer = buffer.slice(frameMatch.index + frameMatch[0].length);

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
        streamDone = true;
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
    cancellation.dispose();
    try {
      if (!streamDone || signal?.aborted) await cancellation.cancel();
    } finally {
      reader.releaseLock();
    }
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
  let streamDone = false;
  const cancellation = createReaderCancellation(reader, signal);

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }

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
    cancellation.dispose();
    try {
      if (!streamDone || signal?.aborted) await cancellation.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

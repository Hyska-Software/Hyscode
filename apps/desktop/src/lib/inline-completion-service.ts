import {
  getProviderRegistry,
  ProviderError,
  type Message,
  type ProviderRegistry,
  type ProviderErrorDetails,
} from '@hyscode/ai-providers';
import { initProviders } from './init-providers';
import {
  type InlineCompletionContext,
} from './inline-completion-context';
import { buildInlineCompletionUserMessage, INLINE_COMPLETION_SYSTEM_PROMPT } from './inline-completion-prompt';
import { normalizeInlineCompletion } from './inline-completion-output';
import { resolveInlineCompletionTarget } from './inline-completion-target';

const INLINE_COMPLETION_REQUEST_TIMEOUT_MS = 12_000;

export type { InlineCompletionContext } from './inline-completion-context';
export type { InlineCompletionTarget } from './inline-completion-target';

export type InlineCompletionResult = {
  status: 'ready' | 'empty' | 'cancelled' | 'unavailable';
  text: string;
  message?: string;
};

export type InlineCompletionRequestOptions = {
  providerId?: string | null;
  modelId?: string | null;
  activeProviderId?: string | null;
  activeModelId?: string | null;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  registry?: ProviderRegistry;
  initialize?: () => Promise<void>;
};

function createStreamError(
  error: string,
  providerId: string,
  details?: ProviderErrorDetails,
): ProviderError {
  return new ProviderError(
    details?.technicalMessage ?? error,
    details?.provider ?? providerId,
    details?.statusCode,
    details?.retryable ?? false,
    details?.retryAfterMs,
    details?.kind,
    details?.phase ?? 'streaming',
    details?.userMessage,
    details?.requestId,
  );
}

function clampMaxTokens(value: number | undefined): number {
  return Math.min(512, Math.max(16, Math.trunc(value ?? 128)));
}

function clampTemperature(value: number | undefined): number {
  return Math.min(1, Math.max(0, value ?? 0.2));
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error('Inline completion cancelled.'));

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('Inline completion cancelled.'));
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Request a bounded, non-agentic inline completion from the configured target.
 * The service never falls back to a registry default and never inserts thinking
 * content as code.
 */
export async function fetchInlineCompletion(
  context: InlineCompletionContext,
  options: InlineCompletionRequestOptions,
): Promise<InlineCompletionResult> {
  if (options.signal?.aborted) return { status: 'cancelled', text: '' };

  const registry = options.registry ?? getProviderRegistry();
  let targetResolution;
  try {
    targetResolution = await abortable(
      resolveInlineCompletionTarget({
        inlineProviderId: options.providerId,
        inlineModelId: options.modelId,
        activeProviderId: options.activeProviderId,
        activeModelId: options.activeModelId,
        registry,
        initialize: options.initialize ?? initProviders,
      }),
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) return { status: 'cancelled', text: '' };
    const details = error instanceof ProviderError ? error.toDetails() : undefined;
    return {
      status: 'unavailable',
      text: '',
      message: details?.userMessage ?? 'AI providers are not ready. Check Settings → AI.',
    };
  }

  if (targetResolution.status === 'unavailable') {
    return { status: 'unavailable', text: '', message: targetResolution.message };
  }
  if (options.signal?.aborted) return { status: 'cancelled', text: '' };

  const requestController = new AbortController();
  const abortListener = (): void => requestController.abort();
  const timeout = setTimeout(() => requestController.abort(), INLINE_COMPLETION_REQUEST_TIMEOUT_MS);
  options.signal?.addEventListener('abort', abortListener, { once: true });
  const requestSignal = requestController.signal;

  const messages: Message[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: buildInlineCompletionUserMessage(context) }],
    },
  ];

  let completionText = '';

  try {
    const stream = registry.chat({
      providerId: targetResolution.target.providerId,
      model: targetResolution.target.modelId,
      messages,
      systemPrompt: INLINE_COMPLETION_SYSTEM_PROMPT,
      maxTokens: clampMaxTokens(options.maxTokens),
      maxTurns: 1,
      temperature: clampTemperature(options.temperature),
      thinking: { enabled: false, level: 'none', type: 'disabled', display: 'omitted' },
      retry: { maxRetries: 0 },
      signal: requestSignal,
    });

    for await (const chunk of stream) {
      if (requestSignal.aborted) return { status: 'cancelled', text: '' };

      if (chunk.type === 'text_delta') {
        completionText += chunk.text;
      } else if (chunk.type === 'error') {
        throw createStreamError(chunk.error, targetResolution.target.providerId, chunk.details);
      }
      // thinking_delta, tool calls and usage are intentionally ignored. Inline
      // completion only accepts plain text and never executes provider tools.
    }
  } catch (error) {
    if (requestSignal.aborted) return { status: 'cancelled', text: '' };
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      error instanceof Error ? error.message : 'Inline completion failed.',
      targetResolution.target.providerId,
      undefined,
      false,
      undefined,
      undefined,
      'streaming',
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortListener);
  }

  const normalized = normalizeInlineCompletion({
    rawText: completionText,
    prefix: context.prefix,
    suffix: context.suffix,
  });

  return normalized.status === 'ready'
    ? { status: 'ready', text: normalized.text }
    : { status: 'empty', text: '' };
}

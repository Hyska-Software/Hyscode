// ─── Tauri Codex Transport ────────────────────────────────────────────────────
// Bridges the CodexProvider to the Tauri `codex_run` command.
// Returns an AsyncIterable<StreamChunk> that maps sidecar NDJSON events to
// the standard StreamChunk union used by the provider layer.
// The Codex agent runs in the active workspace root (read from the file
// store) so the CLI operates on the user's project instead of the app dir.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { StreamChunk } from '@hyscode/ai-providers';
import type { CodexInvoke } from '@hyscode/ai-providers';
import { useFileStore } from '@/stores/file-store';

interface CodexChunk {
  requestId: string;
  type: string;
  content?: string | null;
  toolName?: string | null;
  toolInput?: string | null;
  callId?: string | null;
  stopReason?: string | null;
  error?: string | null;
  done: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
  threadId?: string | null;
}

let _counter = 0;
function nextRequestId(): string {
  return `codex-${Date.now()}-${++_counter}`;
}

/**
 * Creates the CodexInvoke function that bridges TS ↔ Tauri sidecar.
 */
export function createCodexInvoke(): CodexInvoke {
  return function codexInvoke(params) {
    const requestId = nextRequestId();

    // Return an async iterable
    return {
      [Symbol.asyncIterator]() {
        const queue: Array<StreamChunk | null> = [];
        let resolve: (() => void) | null = null;
        let unlisten: (() => void) | null = null;
        let abortHandler: (() => void) | null = null;
        let started = false;

        function cleanupAbortListener(): void {
          if (abortHandler && params.signal) {
            params.signal.removeEventListener('abort', abortHandler);
            abortHandler = null;
          }
        }

        function enqueue(item: StreamChunk | null): void {
          queue.push(item);
          if (resolve) {
            const fn = resolve;
            resolve = null;
            fn();
          }
        }

        function mapChunk(chunk: CodexChunk): void {
          switch (chunk.type) {
            case 'thread_started':
              if (chunk.threadId && params.sessionId) {
                invoke<void>('codex_store_thread', {
                  sessionId: params.sessionId,
                  fingerprint: params.sessionFingerprint,
                  threadId: chunk.threadId,
                }).catch(() => {
                  // Runtime continuity is already held in Rust; persistence is best effort.
                });
              }
              break;

            case 'text':
              if (chunk.content) {
                enqueue({ type: 'text_delta', text: chunk.content });
              }
              break;

            case 'thinking':
              if (chunk.content) {
                enqueue({ type: 'thinking_delta', text: chunk.content });
              }
              break;

            case 'tool_use':
              if (chunk.callId && chunk.toolName) {
                enqueue({ type: 'tool_call_start', id: chunk.callId, name: chunk.toolName });
                if (chunk.toolInput) {
                  enqueue({ type: 'tool_call_delta', id: chunk.callId, input: chunk.toolInput });
                }
                enqueue({ type: 'tool_call_end', id: chunk.callId });
              }
              break;

            case 'message_boundary':
              enqueue({ type: 'message_boundary' });
              break;

            case 'usage':
              if (
                typeof chunk.inputTokens === 'number' ||
                typeof chunk.outputTokens === 'number'
              ) {
                enqueue({
                  type: 'usage',
                  usage: {
                    inputTokens: chunk.inputTokens ?? 0,
                    outputTokens: chunk.outputTokens ?? 0,
                    totalTokens: (chunk.inputTokens ?? 0) + (chunk.outputTokens ?? 0),
                    cacheReadTokens: chunk.cacheReadTokens ?? undefined,
                    cacheWriteTokens: chunk.cacheWriteTokens ?? undefined,
                    reasoningTokens: chunk.reasoningTokens ?? undefined,
                  },
                });
              }
              break;

            case 'done':
              enqueue({
                type: 'done',
                stopReason: (chunk.stopReason as 'end_turn') ?? 'end_turn',
              });
              enqueue(null); // signal end
              break;

            case 'error':
              enqueue({ type: 'error', error: chunk.error ?? 'Unknown sidecar error' });
              enqueue(null);
              break;
          }
        }

        async function start(): Promise<void> {
          if (started) return;
          started = true;

          // Listen for codex:chunk events
          unlisten = (await listen<CodexChunk>('codex:chunk', (event) => {
            if (event.payload.requestId === requestId) {
              mapChunk(event.payload);
            }
          })) as unknown as () => void;

          // Stop support: abort the sidecar process (Rust kills the child and
          // emits a terminal "Cancelled by user" chunk, ending the stream).
          const onAbort = () => {
            invoke<void>('codex_cancel', { requestId }).catch(() => {
              // The process may already have exited — the stream ends on its own.
            });
          };
          abortHandler = onAbort;
          const signal = params.signal;
          if (signal?.aborted) {
            onAbort();
          } else {
            signal?.addEventListener('abort', onAbort, { once: true });
          }

          // Run Codex in the active workspace root (falls back to app dir).
          const cwd = useFileStore.getState().rootPath ?? undefined;

          // Invoke the Rust command
          try {
            await invoke<void>('codex_run', {
              request: {
                requestId,
                model: params.model,
                systemPrompt: params.systemPrompt,
                prompt: params.prompt,
                apiKey: params.apiKey,
                cwd,
                reasoningEffort: params.reasoningEffort,
                sandboxMode: params.sandboxMode,
                sessionId: params.sessionId,
                sessionFingerprint: params.sessionFingerprint,
                continuationPrompt: params.continuationPrompt,
              },
            });
          } catch (err) {
            cleanupAbortListener();
            unlisten?.();
            enqueue({
              type: 'error',
              error: err instanceof Error ? err.message : String(err),
            });
            enqueue(null);
          }
        }

        return {
          async next(): Promise<IteratorResult<StreamChunk>> {
            await start();

            while (queue.length === 0) {
              await new Promise<void>((r) => {
                resolve = r;
              });
            }

            const item = queue.shift()!;
            if (item === null) {
              cleanupAbortListener();
              unlisten?.();
              return { done: true, value: undefined };
            }
            return { done: false, value: item };
          },

          async return(): Promise<IteratorResult<StreamChunk>> {
            cleanupAbortListener();
            unlisten?.();
            return { done: true, value: undefined };
          },

          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
    };
  };
}

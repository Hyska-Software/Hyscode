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
  request_id: string;
  type: string;
  content?: string | null;
  tool_name?: string | null;
  tool_input?: string | null;
  call_id?: string | null;
  stop_reason?: string | null;
  error?: string | null;
  done: boolean;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  reasoning_tokens?: number | null;
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
        let started = false;

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
              if (chunk.call_id && chunk.tool_name) {
                enqueue({ type: 'tool_call_start', id: chunk.call_id, name: chunk.tool_name });
                if (chunk.tool_input) {
                  enqueue({ type: 'tool_call_delta', id: chunk.call_id, input: chunk.tool_input });
                }
                enqueue({ type: 'tool_call_end', id: chunk.call_id });
              }
              break;

            case 'message_boundary':
              enqueue({ type: 'message_boundary' });
              break;

            case 'usage':
              if (
                typeof chunk.input_tokens === 'number' ||
                typeof chunk.output_tokens === 'number'
              ) {
                enqueue({
                  type: 'usage',
                  usage: {
                    inputTokens: chunk.input_tokens ?? 0,
                    outputTokens: chunk.output_tokens ?? 0,
                    totalTokens: (chunk.input_tokens ?? 0) + (chunk.output_tokens ?? 0),
                    cacheReadTokens: chunk.cache_read_tokens ?? undefined,
                    reasoningTokens: chunk.reasoning_tokens ?? undefined,
                  },
                });
              }
              break;

            case 'done':
              enqueue({
                type: 'done',
                stopReason: (chunk.stop_reason as 'end_turn') ?? 'end_turn',
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
            if (event.payload.request_id === requestId) {
              mapChunk(event.payload);
            }
          })) as unknown as () => void;

          // Run Codex in the active workspace root (falls back to app dir).
          const cwd = useFileStore.getState().rootPath ?? undefined;

          // Invoke the Rust command
          try {
            await invoke<void>('codex_run', {
              request: {
                request_id: requestId,
                model: params.model,
                system_prompt: params.systemPrompt,
                prompt: params.prompt,
                api_key: params.apiKey,
                cwd,
                reasoning_effort: params.reasoningEffort,
              },
            });
          } catch (err) {
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
              unlisten?.();
              return { done: true, value: undefined };
            }
            return { done: false, value: item };
          },

          async return(): Promise<IteratorResult<StreamChunk>> {
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

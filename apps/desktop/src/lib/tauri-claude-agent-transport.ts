// ─── Tauri Claude Agent Transport ──────────────────────────────────────────────
// Bridges the ClaudeAgentProvider to the Tauri `claude_agent_run` command.
// Returns an AsyncIterable<StreamChunk> that maps sidecar NDJSON events to
// the standard StreamChunk union used by the provider layer.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { StreamChunk } from '@hyscode/ai-providers';
import type { ClaudeAgentInvoke } from '@hyscode/ai-providers';

interface ClaudeAgentChunk {
  requestId: string;
  type: string;
  content?: string | null;
  toolName?: string | null;
  toolInput?: string | null;
  callId?: string | null;
  stopReason?: string | null;
  error?: string | null;
  done: boolean;
}

let _counter = 0;
function nextRequestId(): string {
  return `agent-${Date.now()}-${++_counter}`;
}

/**
 * Creates the ClaudeAgentInvoke function that bridges TS ↔ Tauri sidecar.
 */
export function createClaudeAgentInvoke(): ClaudeAgentInvoke {
  return function claudeAgentInvoke(params) {
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

        function mapChunk(chunk: ClaudeAgentChunk): void {
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
              if (chunk.callId && chunk.toolName) {
                enqueue({ type: 'tool_call_start', id: chunk.callId, name: chunk.toolName });
                if (chunk.toolInput) {
                  enqueue({ type: 'tool_call_delta', id: chunk.callId, input: chunk.toolInput });
                }
                enqueue({ type: 'tool_call_end', id: chunk.callId });
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

          // Listen for agent:chunk events
          unlisten = (await listen<ClaudeAgentChunk>('agent:chunk', (event) => {
            if (event.payload.requestId === requestId) {
              mapChunk(event.payload);
            }
          })) as unknown as () => void;

          // Invoke the Rust command
          try {
            await invoke<void>('claude_agent_run', {
              request: {
                requestId,
                model: params.model,
                systemPrompt: params.systemPrompt,
                messages: params.messages,
                maxTurns: params.maxTurns,
                cwd: params.cwd,
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

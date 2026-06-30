#!/usr/bin/env node
// ─── Claude Agent Sidecar ────────────────────────────────────────────────────
// Standalone process that wraps @anthropic-ai/claude-agent-sdk.
// Reads a JSON request from stdin, calls the SDK's query() function,
// and writes NDJSON events to stdout for the Tauri host to consume.

import { query } from '@anthropic-ai/claude-agent-sdk';

// ─── Protocol Types ──────────────────────────────────────────────────────────

interface SidecarRequest {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  maxTurns?: number;
  cwd?: string;
  allowedTools?: string[];
}

interface SidecarEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'usage' | 'done' | 'error';
  content?: string;
  toolName?: string;
  toolInput?: string;
  callId?: string;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
  error?: string;
}

function emit(event: SidecarEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let request: SidecarRequest;
  try {
    request = JSON.parse(input);
  } catch {
    emit({ type: 'error', error: 'Invalid JSON input' });
    process.exit(1);
  }

  // Set the API key as environment variable for the SDK
  process.env.ANTHROPIC_API_KEY = request.apiKey;

  // Change working directory if specified
  if (request.cwd) {
    try {
      process.chdir(request.cwd);
    } catch {
      // Ignore if directory doesn't exist; SDK will use current dir
    }
  }

  const prompt = request.messages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}:\n${message.content}`)
    .join('\n\n');

  try {
    const result = query({
      prompt,
      options: {
        model: request.model,
        systemPrompt: request.systemPrompt ?? 'You are a helpful coding assistant.',
        maxTurns: request.maxTurns ?? 10,
        abortController: new AbortController(),
        cwd: request.cwd,
        allowedTools: request.allowedTools,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: request.apiKey,
          CLAUDE_AGENT_SDK_CLIENT_APP: 'hyscode/0.3.1',
        },
      },
    });

    // Process the result messages
    for await (const msg of result) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            emit({ type: 'text', content: block.text });
          } else if (block.type === 'thinking') {
            emit({ type: 'thinking', content: block.thinking });
          } else if (block.type === 'tool_use') {
            emit({
              type: 'tool_use',
              callId: block.id,
              toolName: block.name,
              toolInput: JSON.stringify(block.input),
            });
          }
        }
      } else if (msg.type === 'user' && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_result') {
            emit({
              type: 'tool_result',
              callId: block.tool_use_id,
              content:
                typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            });
          }
        }
      } else if (msg.type === 'result') {
        emit({
          type: 'usage',
          inputTokens: msg.usage.input_tokens,
          outputTokens: msg.usage.output_tokens,
        });
        if (msg.subtype !== 'success') {
          emit({ type: 'error', error: msg.errors.join('\n') || msg.subtype });
          return;
        }
        emit({ type: 'done', stopReason: msg.stop_reason ?? 'end_turn' });
        return;
      }
    }

    emit({ type: 'done', stopReason: 'end_turn' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: 'error', error: message });
    process.exit(1);
  }
}

main();

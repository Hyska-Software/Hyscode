#!/usr/bin/env node
// ─── Codex Sidecar ───────────────────────────────────────────────────────────
// Standalone process that wraps @openai/codex-sdk.
// Reads a JSON request from stdin, runs one agentic Codex turn, and writes
// NDJSON events to stdout for the Tauri host to consume.
//
// The SDK spawns the `codex` CLI. The CLI is NOT bundled with HysCode — it is
// installed by the user (npm install -g @openai/codex or the official
// installer). This sidecar locates the executable on the system and passes it
// via `codexPathOverride` (the SDK's own createRequire() resolution does not
// work inside a Bun-compiled binary).

import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Codex } from '@openai/codex-sdk';

// ─── Protocol Types ──────────────────────────────────────────────────────────

interface SidecarRequest {
  apiKey?: string;
  model: string;
  systemPrompt?: string;
  prompt: string;
  cwd?: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
}

interface SidecarEvent {
  type: 'text' | 'tool_use' | 'thinking' | 'message_boundary' | 'usage' | 'done' | 'error';
  content?: string;
  toolName?: string;
  toolInput?: string;
  callId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  reasoningTokens?: number;
  stopReason?: string;
  error?: string;
}

function emit(event: SidecarEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

// ─── Codex CLI Discovery ─────────────────────────────────────────────────────

function findCodexCli(): string | null {
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);

  // 1) System PATH — real binary, or npm `.cmd` shim resolved to the real one
  for (const dir of pathDirs) {
    const candidate = path.join(dir, exe);
    if (existsSync(candidate)) return candidate;
    if (process.platform === 'win32') {
      const shim = path.join(dir, 'codex.cmd');
      if (existsSync(shim)) {
        const real = resolveNpmShim(shim);
        if (real) return real;
      }
    }
  }

  // 2) ~/.codex/bin — where the official installer puts the binary
  const homeBin = path.join(os.homedir(), '.codex', 'bin', exe);
  if (existsSync(homeBin)) return homeBin;

  // 3) ChatGPT/Codex desktop app bundled CLI (Windows)
  if (process.platform === 'win32') {
    const appBinRoot = path.join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin');
    if (existsSync(appBinRoot)) {
      for (const entry of readdirSync(appBinRoot)) {
        const candidate = path.join(appBinRoot, entry, exe);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  // 4) VS Code ChatGPT extension bundled CLI (Windows)
  if (process.platform === 'win32') {
    const extRoot = path.join(os.homedir(), '.vscode', 'extensions');
    if (existsSync(extRoot)) {
      for (const entry of readdirSync(extRoot)) {
        if (!entry.startsWith('openai.chatgpt-')) continue;
        const binRoot = path.join(extRoot, entry, 'bin');
        if (!existsSync(binRoot)) continue;
        for (const sub of readdirSync(binRoot)) {
          const candidate = path.join(binRoot, sub, exe);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }

  // 5) Legacy: vendored runtime next to this binary (pre-unbundling builds)
  const legacy = path.join(path.dirname(process.execPath), 'codex-cli-runtime', 'bin', exe);
  if (existsSync(legacy)) return legacy;

  return null;
}

/** Resolve the real Codex binary behind an npm `.cmd` shim. */
function resolveNpmShim(shim: string): string | null {
  const vendor = path.join(
    path.dirname(shim),
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
  );
  if (!existsSync(vendor)) return null;
  for (const triple of readdirSync(vendor)) {
    const candidate = path.join(vendor, triple, 'bin', 'codex.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
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

  // Locate the user-installed Codex CLI: system PATH, ~/.codex/bin, the
  // ChatGPT/Codex desktop app, or the VS Code extension bundled CLI.
  const cliPath = findCodexCli();
  if (!cliPath) {
    const checkedLocations = process.platform === 'win32'
      ? 'system PATH, ~/.codex/bin, %LOCALAPPDATA%\\OpenAI\\Codex\\bin, and the VS Code ChatGPT extension'
      : 'system PATH and ~/.codex/bin';
    emit({
      type: 'error',
      error:
        `Codex CLI not found. Checked: ${checkedLocations}. ` +
        'Install it with: npm install -g @openai/codex (or run the official ' +
        'installer — see https://developers.openai.com/codex/cli). ' +
        'Then restart VORTEX.',
    });
    process.exit(1);
  }

  // Prepend the system prompt to the user prompt (Codex has no separate
  // system-prompt option; it reads AGENTS.md rules from the working dir).
  const finalPrompt = request.systemPrompt
    ? `${request.systemPrompt}\n\n${request.prompt}`
    : request.prompt;

  try {
    const codex = new Codex({
      codexPathOverride: cliPath,
      ...(request.apiKey ? { apiKey: request.apiKey } : {}),
    });

    const thread = codex.startThread({
      model: request.model,
      workingDirectory: request.cwd,
      skipGitRepoCheck: true,
      // The sandbox maps the HysCode agent mode (chat/review/plan → restricted,
      // build/debug → full access). The sidecar runs without a UI — Codex must
      // never block on its own approval prompts, so approval stays 'never'.
      sandboxMode: request.sandboxMode ?? 'danger-full-access',
      approvalPolicy: 'never',
      modelReasoningEffort: request.reasoningEffort,
    });

    // A single `runStreamed` call is one agentic turn; the Codex agent
    // executes its own tools (shell, apply_patch, mcp, ...) internally.
    const { events } = await thread.runStreamed(finalPrompt);

    // Codex streams one `agent_message` per interim step. Each becomes its
    // own chat message: emit `message_boundary` lazily BEFORE the next
    // agent_message so the final message has no trailing boundary.
    let pendingBoundary = false;

    for await (const event of events) {
      switch (event.type) {
        case 'item.started': {
          const item = event.item;
          if (item.type === 'command_execution') {
            emit({
              type: 'tool_use',
              callId: item.id,
              toolName: 'shell',
              toolInput: JSON.stringify({ command: item.command, status: item.status }),
            });
          } else if (item.type === 'file_change') {
            emit({
              type: 'tool_use',
              callId: item.id,
              toolName: 'apply_patch',
              toolInput: JSON.stringify({ changes: item.changes }),
            });
          } else if (item.type === 'mcp_tool_call') {
            emit({
              type: 'tool_use',
              callId: item.id,
              toolName: `mcp:${item.server}/${item.tool}`,
              toolInput: JSON.stringify(item.arguments),
            });
          } else if (item.type === 'web_search') {
            emit({
              type: 'tool_use',
              callId: item.id,
              toolName: 'web_search',
              toolInput: JSON.stringify({ query: item.query }),
            });
          }
          break;
        }

        case 'item.completed': {
          const item = event.item;
          if (item.type === 'agent_message') {
            if (item.text) {
              if (pendingBoundary) {
                emit({ type: 'message_boundary' });
              }
              emit({ type: 'text', content: item.text });
              pendingBoundary = true;
            }
          } else if (item.type === 'reasoning') {
            emit({ type: 'thinking', content: item.text });
          }
          break;
        }

        case 'turn.completed': {
          emit({
            type: 'usage',
            inputTokens: event.usage.input_tokens,
            outputTokens: event.usage.output_tokens,
            cacheReadTokens: event.usage.cached_input_tokens,
            reasoningTokens: event.usage.reasoning_output_tokens,
          });
          emit({ type: 'done', stopReason: 'end_turn' });
          return;
        }

        case 'turn.failed': {
          emit({ type: 'error', error: event.error.message || 'Codex turn failed' });
          process.exit(1);
          return;
        }

        case 'error': {
          emit({ type: 'error', error: event.message || 'Codex stream error' });
          process.exit(1);
          return;
        }

        default:
          // thread.started / turn.started / item.updated / todo_list — no-op
          break;
      }
    }

    // Stream ended without an explicit completion — still a valid end.
    emit({ type: 'done', stopReason: 'end_turn' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: 'error', error: message });
    process.exit(1);
  }
}

main();

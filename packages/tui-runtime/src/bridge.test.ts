import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface, type Interface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider, getProviderRegistry } from '@hyscode/ai-providers';
import { TuiBridge } from './bridge';
import type { BridgeEvent, BridgeResponse, GitSummary, ProjectSummary, RuntimeReadyPayload, SessionRecord } from './protocol';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

function successfulResult<T>(response: BridgeResponse): T {
  if (!response.ok) throw new Error(response.error);
  return response.result as T;
}

type FixtureBehavior = 'tool' | 'terminal' | 'cancel';

type ProviderFixture = {
  baseUrl: string;
  requests: Array<Record<string, unknown>>;
  setBehavior: (behavior: FixtureBehavior) => void;
  close: () => Promise<void>;
};

type JsonMessage = Record<string, unknown>;

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function writeSse(response: ServerResponse, payload: Record<string, unknown>): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function finishSse(response: ServerResponse): void {
  response.write('data: [DONE]\n\n');
  response.end();
}

async function startProviderFixture(): Promise<ProviderFixture> {
  const requests: Array<Record<string, unknown>> = [];
  let behavior: FixtureBehavior = 'tool';
  const server: Server = createServer((request, response) => {
    void (async () => {
      const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
      requests.push(body);
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      if (behavior === 'cancel') {
        writeSse(response, {
          choices: [{ delta: { content: 'A partial response' }, finish_reason: null }],
        });
        return;
      }

      if (behavior === 'terminal' && requests.length === 1) {
        const command = process.platform === 'win32'
          ? 'Write-Output terminal-fixture'
          : "printf 'terminal-fixture\\n'";
        writeSse(response, {
          choices: [{ delta: { content: 'I will run the terminal fixture.' }, finish_reason: null }],
        });
        writeSse(response, {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'fixture-terminal-call',
                type: 'function',
                function: { name: 'run_terminal_command' },
              }],
            },
            finish_reason: null,
          }],
        });
        writeSse(response, {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: JSON.stringify({ command }) },
              }],
            },
            finish_reason: null,
          }],
        });
        writeSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        writeSse(response, {
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        });
        finishSse(response);
        return;
      }

      if (requests.length === 1) {
        writeSse(response, {
          choices: [{ delta: { content: 'I will update the fixture file.' }, finish_reason: null }],
        });
        writeSse(response, {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'fixture-write-call',
                type: 'function',
                function: { name: 'write_file' },
              }],
            },
            finish_reason: null,
          }],
        });
        writeSse(response, {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '{"path":"fixture-output.txt","content":"updated by fixture"}' },
              }],
            },
            finish_reason: null,
          }],
        });
        writeSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        writeSse(response, {
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        });
        finishSse(response);
        return;
      }

      const messages = Array.isArray(body.messages) ? body.messages : [];
      const hasToolResult = messages.some((message) => (
        typeof message === 'object'
        && message !== null
        && (message as { role?: unknown }).role === 'tool'
      ));
      if (!hasToolResult) {
        response.statusCode = 500;
        response.end('The fixture expected a tool result.');
        return;
      }
      writeSse(response, {
        choices: [{
          delta: {
            content: behavior === 'terminal'
              ? 'The terminal fixture completed successfully.'
              : 'The fixture file was updated successfully.',
          },
          finish_reason: null,
        }],
      });
      writeSse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      writeSse(response, {
        choices: [],
        usage: { prompt_tokens: 20, completion_tokens: 9, total_tokens: 29 },
      });
      finishSse(response);
    })().catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500);
      response.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Provider fixture did not expose a TCP address.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    setBehavior: (nextBehavior) => { behavior = nextBehavior; },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function waitForEvent(
  events: BridgeEvent[],
  predicate: (event: BridgeEvent) => boolean,
  timeoutMs = 5_000,
): Promise<BridgeEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = events.find(predicate);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for bridge event.');
}

async function waitForProcessMessage(
  input: Interface,
  buffered: JsonMessage[],
  predicate: (message: JsonMessage) => boolean,
  timeoutMs = 5_000,
): Promise<JsonMessage> {
  const existingIndex = buffered.findIndex(predicate);
  if (existingIndex >= 0) return buffered.splice(existingIndex, 1)[0];
  return new Promise<JsonMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      input.removeListener('line', onLine);
      reject(new Error('Timed out waiting for runtime bridge process message.'));
    }, timeoutMs);
    const onLine = (line: string) => {
      try {
        const message = JSON.parse(line) as JsonMessage;
        if (predicate(message)) {
          clearTimeout(timer);
          input.removeListener('line', onLine);
          resolve(message);
        } else {
          buffered.push(message);
        }
      } catch {
        buffered.push({ type: 'invalid', line });
      }
    };
    input.on('line', onLine);
  });
}

describe('shared harness bridge protocol', () => {
  it('starts the real Bun NDJSON bridge and completes protocol lifecycle requests', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-process-'));
    temporaryDirectories.push(directory);
    const repositoryRoot = existsSync(path.join(process.cwd(), 'packages'))
      ? process.cwd()
      : path.resolve(process.cwd(), '..', '..');
    const source = path.join(repositoryRoot, 'packages', 'tui-runtime', 'src', 'main.ts');
    const child = spawn(process.env.BUN_BINARY || 'bun', [source], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        HYSCODE_CONFIG_PATH: path.join(directory, 'settings.json'),
        HYSCODE_KEYCHAIN_PATH: path.join(directory, 'keychain.json'),
        HYSCODE_TUI_DATA_PATH: path.join(directory, 'tui-data.json'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const input = createInterface({ input: child.stdout });
    const buffered: JsonMessage[] = [];
    child.stderr.resume();
    const send = (message: JsonMessage): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    try {
      send({ id: 'initialize', method: 'initialize', params: { workspacePath: directory, projectId: 'process-fixture' } });
      const initialized = await waitForProcessMessage(input, buffered, (message) => message.id === 'initialize');
      expect(initialized.ok).toBe(true);
      expect(buffered.some((message) => message.event === 'runtime_ready')).toBe(true);

      send({ id: 'projects', method: 'project_list', params: {} });
      const projects = await waitForProcessMessage(input, buffered, (message) => message.id === 'projects');
      expect(projects.ok).toBe(true);
      expect(projects.result).toEqual(expect.arrayContaining([expect.objectContaining({ workspacePath: directory, sessionCount: 1 })]));

      send({ id: 'shutdown', method: 'shutdown', params: {} });
      expect((await waitForProcessMessage(input, buffered, (message) => message.id === 'shutdown')).ok).toBe(true);
    } finally {
      input.close();
      if (!child.killed) child.kill();
    }
  });

  it('initializes the real provider registry and supports mode and session lifecycle commands', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-bridge-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('HYSCODE_CONFIG_PATH', path.join(directory, 'settings.json'));
    vi.stubEnv('HYSCODE_KEYCHAIN_PATH', path.join(directory, 'keychain.json'));
    vi.stubEnv('HYSCODE_TUI_DATA_PATH', path.join(directory, 'tui-data.json'));

    const events: Array<{ type: string; event?: string }> = [];
    const bridge = new TuiBridge((message) => {
      if (message.type === 'event') events.push({ type: message.type, event: message.event });
    });
    const initialized = successfulResult<RuntimeReadyPayload>(await bridge.handle({
      id: 'initialize',
      method: 'initialize',
      params: { workspacePath: directory, projectId: 'fixture-project', agentType: 'chat' },
    }));
    expect(initialized.protocolVersion).toBe(1);
    expect(initialized.workspacePath).toBe(directory);
    expect(initialized.activeThinking).toEqual({ enabled: false });
    expect(initialized.activeThemeId).toBe('hyscode-dark');
    expect(initialized.themes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'aura', source: 'builtin' }),
    ]));
    expect(initialized.recentSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: initialized.session?.id, title: 'New session' }),
    ]));
    expect(initialized.git).toEqual({ available: false, branch: '', insertions: 0, deletions: 0, changedFiles: 0 });
    expect(initialized.session?.messageCount).toBe(0);
    expect(events.some((event) => event.event === 'runtime_ready')).toBe(true);

    expect(successfulResult<GitSummary>(await bridge.handle({ id: 'git', method: 'git_summary', params: {} }))).toEqual(initialized.git);

    const themed = successfulResult<RuntimeReadyPayload>(await bridge.handle({
      id: 'theme',
      method: 'set_config',
      params: { themeId: 'nord' },
    }));
    expect(themed.activeThemeId).toBe('nord');

    const sidebar = successfulResult<RuntimeReadyPayload>(await bridge.handle({
      id: 'sidebar',
      method: 'set_config',
      params: { sidebarVisible: false },
    }));
    expect(sidebar.sidebarVisible).toBe(false);

    const mode = successfulResult<RuntimeReadyPayload>(await bridge.handle({
      id: 'mode',
      method: 'set_mode',
      params: { agentType: 'review' },
    }));
    expect(mode.activeAgentType).toBe('review');

    const created = successfulResult<SessionRecord>(await bridge.handle({ id: 'new', method: 'session_new', params: {} }));
    expect(created.id).not.toBe(initialized.session?.id);
    const sessions = successfulResult<SessionRecord[]>(await bridge.handle({ id: 'list', method: 'session_list', params: {} }));
    expect(sessions).toHaveLength(2);
    expect(successfulResult<SessionRecord | null>(await bridge.handle({ id: 'load', method: 'session_load', params: { id: created.id } }))?.id).toBe(created.id);

    const projects = successfulResult<ProjectSummary[]>(await bridge.handle({ id: 'projects', method: 'project_list', params: {} }));
    expect(projects).toMatchObject([{ workspacePath: directory, sessionCount: 2 }]);
    const secondDirectory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-project-'));
    temporaryDirectories.push(secondDirectory);
    const switched = successfulResult<RuntimeReadyPayload>(await bridge.handle({
      id: 'switch',
      method: 'project_switch',
      params: { workspacePath: secondDirectory },
    }));
    expect(switched.workspacePath).toBe(secondDirectory);
    expect(successfulResult<SessionRecord[]>(await bridge.handle({ id: 'other-list', method: 'session_list', params: {} }))).toHaveLength(1);
    expect(successfulResult<ProjectSummary[]>(await bridge.handle({ id: 'other-projects', method: 'project_list', params: {} }))).toHaveLength(2);

    await bridge.handle({ id: 'shutdown', method: 'shutdown', params: {} });
    const persistedSettings = JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8')) as { agentType: string; themeId: string; sidebarVisible: boolean };
    expect(persistedSettings.agentType).toBe('review');
    expect(persistedSettings.themeId).toBe('nord');
    expect(persistedSettings.sidebarVisible).toBe(false);
  }, 15_000);

  it('exposes context attachments and session management through the standalone protocol', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-context-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'context.txt');
    await writeFile(filePath, 'context fixture', 'utf8');
    vi.stubEnv('HYSCODE_CONFIG_PATH', path.join(directory, 'settings.json'));
    vi.stubEnv('HYSCODE_KEYCHAIN_PATH', path.join(directory, 'keychain.json'));
    vi.stubEnv('HYSCODE_TUI_DATA_PATH', path.join(directory, 'tui-data.json'));
    const events: BridgeEvent[] = [];
    const bridge = new TuiBridge((message) => { if (message.type === 'event') events.push(message); });
    const initialized = successfulResult<RuntimeReadyPayload>(await bridge.handle({
      id: 'initialize',
      method: 'initialize',
      params: { workspacePath: directory, projectId: 'context-fixture' },
    }));
    const context = successfulResult<{ attachments: Array<{ id: string; kind: string; path?: string }> }>(await bridge.handle({
      id: 'attach',
      method: 'context_attach',
      params: { kind: 'auto', path: filePath },
    }));
    expect(context.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'file', path: filePath })]));
    expect(events.some((event) => event.event === 'context_updated')).toBe(true);

    const renamed = successfulResult<SessionRecord>(await bridge.handle({
      id: 'rename',
      method: 'session_rename',
      params: { id: initialized.session?.id, title: 'Context fixture session' },
    }));
    expect(renamed.title).toBe('Context fixture session');
    const exported = successfulResult<{ path: string; content: string }>(await bridge.handle({
      id: 'export',
      method: 'session_export',
      params: { id: renamed.id },
    }));
    expect(exported.content).toContain('# Context fixture session');
    expect(await readFile(exported.path, 'utf8')).toContain('# Context fixture session');
    expect(successfulResult<{ attachments: unknown[] }>(await bridge.handle({ id: 'remove', method: 'context_remove', params: { id: context.attachments[0]?.id } })).attachments).toHaveLength(0);
    await bridge.handle({ id: 'shutdown', method: 'shutdown', params: {} });
  });

  it('streams through the real provider adapter, pauses for approval, executes a tool, and persists completion', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-turn-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'AGENTS.md'), 'Always verify the fixture output.', 'utf8');
    const fixture = await startProviderFixture();
    const registry = getProviderRegistry();
    vi.stubEnv('HYSCODE_CONFIG_PATH', path.join(directory, 'settings.json'));
    vi.stubEnv('HYSCODE_KEYCHAIN_PATH', path.join(directory, 'keychain.json'));
    vi.stubEnv('HYSCODE_TUI_DATA_PATH', path.join(directory, 'tui-data.json'));

    const events: BridgeEvent[] = [];
    const bridge = new TuiBridge((message) => {
      if (message.type === 'event') events.push(message);
    });
    try {
      const initialized = successfulResult<RuntimeReadyPayload>(await bridge.handle({
        id: 'initialize',
        method: 'initialize',
        params: { workspacePath: directory, projectId: 'turn-fixture', agentType: 'build', approvalMode: 'manual' },
      }));
      registry.register(new OpenAIProvider('fixture-key', fixture.baseUrl));
      const configured = successfulResult<RuntimeReadyPayload>(await bridge.handle({
        id: 'config',
        method: 'set_config',
        params: {
          providerId: 'openai',
          modelId: 'gpt-5.4-mini',
          thinking: { enabled: true, level: 'high' },
        },
      }));
      expect(configured.activeProviderId).toBe('openai');
      expect(configured.activeThinking).toEqual({ enabled: true, level: 'high' });
      expect(
        (JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8')) as {
          thinkingSettings: Record<string, unknown>;
        }).thinkingSettings['openai::gpt-5.4-mini'],
      ).toEqual({ enabled: true, level: 'high' });

      const rejected = await bridge.handle({
        id: 'invalid-thinking',
        method: 'set_config',
        params: {
          providerId: 'openai',
          modelId: 'gpt-5.4-mini',
          thinking: { enabled: true, level: 'adaptive' },
        },
      });
      expect(rejected.ok).toBe(false);

      const disabled = successfulResult<RuntimeReadyPayload>(await bridge.handle({
        id: 'disable-thinking',
        method: 'set_config',
        params: {
          providerId: 'openai',
          modelId: 'gpt-5.4-mini',
          thinking: { enabled: false, level: 'high' },
        },
      }));
      expect(disabled.activeThinking).toEqual({ enabled: false, level: 'high' });
      expect(
        (JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8')) as {
          thinkingSettings: Record<string, unknown>;
        }).thinkingSettings['openai::gpt-5.4-mini'],
      ).toEqual({ enabled: false, level: 'high' });

      const turnPromise = bridge.handle({
        id: 'turn',
        method: 'send_message',
        params: { message: 'Write fixture-output.txt with the updated fixture content.' },
      });
      const interaction = await waitForEvent(events, (event) => event.event === 'interaction');
      expect(interaction.event).toBe('interaction');
      if (interaction.event !== 'interaction') throw new Error('Expected approval interaction.');
      expect(interaction.payload.kind).toBe('approval');
      if (interaction.payload.kind !== 'approval') throw new Error('Expected tool approval interaction.');
      expect(interaction.payload.toolCall.toolName).toBe('write_file');

      const resolved = successfulResult<{ resolved: boolean }>(await bridge.handle({
        id: 'approval',
        method: 'resolve_interaction',
        params: { requestId: interaction.payload.requestId, approved: true },
      }));
      expect(resolved.resolved).toBe(true);

      const turn = successfulResult<{ status: string; response: string }>(await turnPromise);
      expect(turn.status).toBe('complete');
      expect(turn.response).toContain('updated successfully');
      expect(await readFile(path.join(directory, 'fixture-output.txt'), 'utf8')).toBe('updated by fixture');
      expect(fixture.requests.length).toBeGreaterThanOrEqual(2);
      const firstRequestMessages = Array.isArray(fixture.requests[0]?.messages)
        ? fixture.requests[0].messages as Array<{ role?: string; content?: string }>
        : [];
      expect(firstRequestMessages.find((message) => message.role === 'system')?.content).toContain(
        'Always verify the fixture output.',
      );
      const toolResultRequest = fixture.requests.find((request) => (
        Array.isArray(request.messages)
        && (request.messages as Array<{ role?: string }>).some((message) => message.role === 'tool')
      ));
      expect(toolResultRequest).toBeDefined();
      expect(events.some((event) => event.event === 'harness_event' && event.payload.type === 'stream_chunk')).toBe(true);
      expect(events.some((event) => event.event === 'harness_event' && event.payload.type === 'tool_call_result')).toBe(true);
      expect(events.some((event) => event.event === 'harness_event' && event.payload.type === 'turn_end')).toBe(true);

      const session = successfulResult<SessionRecord | null>(await bridge.handle({
        id: 'load-current',
        method: 'session_load',
        params: { id: initialized.session?.id },
      }));
      expect(session?.messages).toHaveLength(5);
      expect(session?.messages.filter((message) => message.role === 'user')).toHaveLength(1);
      expect(session?.messages.filter((message) => message.role === 'tool')).toHaveLength(1);
    } finally {
      registry.unregister('openai');
      await bridge.handle({ id: 'shutdown', method: 'shutdown', params: {} });
      await fixture.close();
    }
  });

  it('executes a real Harness terminal through CliHost and isolates it from a user terminal', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-terminal-'));
    temporaryDirectories.push(directory);
    const fixture = await startProviderFixture();
    fixture.setBehavior('terminal');
    const registry = getProviderRegistry();
    vi.stubEnv('HYSCODE_CONFIG_PATH', path.join(directory, 'settings.json'));
    vi.stubEnv('HYSCODE_KEYCHAIN_PATH', path.join(directory, 'keychain.json'));
    vi.stubEnv('HYSCODE_TUI_DATA_PATH', path.join(directory, 'tui-data.json'));

    const events: BridgeEvent[] = [];
    const bridge = new TuiBridge((message) => {
      if (message.type === 'event') events.push(message);
    });
    try {
      const initialized = successfulResult<RuntimeReadyPayload>(await bridge.handle({
        id: 'initialize',
        method: 'initialize',
        params: { workspacePath: directory, projectId: 'terminal-fixture', agentType: 'build', approvalMode: 'yolo' },
      }));
      const userTerminal = successfulResult<{
        terminalId: string;
        role?: string;
        cwd?: string;
      }>(await bridge.handle({
        id: 'open-user-terminal',
        method: 'terminal_open',
        params: { forceNew: true },
      }));
      expect(userTerminal.role).toBe('user');
      expect(userTerminal.cwd).toBe(process.platform === 'win32' ? directory.toLowerCase() : directory);

      await bridge.handle({ id: 'new-session', method: 'session_new', params: {} });
      const deniedSnapshot = await bridge.handle({
        id: 'denied-user-snapshot',
        method: 'terminal_snapshot',
        params: { terminalId: userTerminal.terminalId },
      });
      expect(deniedSnapshot.ok).toBe(false);
      expect(deniedSnapshot).toMatchObject({ error: expect.stringContaining('another conversation') });
      await bridge.handle({ id: 'restore-session', method: 'session_load', params: { id: initialized.session?.id } });

      registry.register(new OpenAIProvider('fixture-key', fixture.baseUrl));
      await bridge.handle({
        id: 'config',
        method: 'set_config',
        params: { providerId: 'openai', modelId: 'gpt-5.4-mini', approvalMode: 'yolo' },
      });

      const turnPromise = bridge.handle({
        id: 'terminal-turn',
        method: 'send_message',
        params: { message: 'Run the terminal fixture.' },
      });
      const created = await waitForEvent(
        events,
        (event) => event.event === 'terminal_updated' && event.payload.cause === 'created' && event.payload.terminal.role === 'agent',
        20_000,
      );
      if (created.event !== 'terminal_updated') throw new Error('Expected an agent terminal event.');
      expect(created.payload.terminal.terminalId).not.toBe(userTerminal.terminalId);
      expect(created.payload.terminal.ownerConversationId).toBe(initialized.session?.id);

      const output = await waitForEvent(
        events,
        (event) => event.event === 'harness_event'
          && event.payload.type === 'terminal_progress'
          && event.payload.progress.chunk.includes('terminal-fixture'),
        20_000,
      );
      if (output.event !== 'harness_event' || output.payload.type !== 'terminal_progress') {
        throw new Error('Expected normalized terminal progress.');
      }
      expect(output.payload.progress.state).toBe('running');

      const turn = successfulResult<{ status: string; response: string }>(await turnPromise);
      expect(turn.status).toBe('complete');
      expect(turn.response).toContain('terminal fixture completed');

      const terminals = successfulResult<Array<{
        terminalId: string;
        role?: string;
        alive: boolean;
        outputPreview: string;
      }>>(await bridge.handle({ id: 'list-terminals', method: 'terminal_list', params: {} }));
      expect(terminals).toEqual(expect.arrayContaining([
        expect.objectContaining({ terminalId: userTerminal.terminalId, role: 'user' }),
        expect.objectContaining({ role: 'agent', alive: true }),
      ]));
      const agentTerminal = terminals.find((terminal) => terminal.role === 'agent');
      expect(agentTerminal?.outputPreview).toContain('terminal-fixture');

      const refreshed = successfulResult<RuntimeReadyPayload>(await bridge.handle({
        id: 'runtime-refresh',
        method: 'set_config',
        params: {},
      }));
      expect(refreshed.terminals).toEqual(expect.arrayContaining([
        expect.objectContaining({ terminalId: userTerminal.terminalId, role: 'user' }),
        expect.objectContaining({ role: 'agent' }),
      ]));

      const agentId = agentTerminal?.terminalId;
      if (!agentId) throw new Error('The agent terminal was not listed.');
      expect(successfulResult<{ killed: boolean }>(await bridge.handle({
        id: 'kill-agent-terminal',
        method: 'terminal_kill',
        params: { terminalId: agentId },
      })).killed).toBe(true);
      const afterKill = successfulResult<{ alive: boolean; exitCode: number | null }>(await bridge.handle({
        id: 'snapshot-agent-terminal',
        method: 'terminal_snapshot',
        params: { terminalId: agentId },
      }));
      expect(afterKill.alive).toBe(false);
      expect(afterKill.exitCode).not.toBeUndefined();
    } finally {
      registry.unregister('openai');
      await bridge.handle({ id: 'shutdown', method: 'shutdown', params: {} });
      await fixture.close();
    }
  }, 30_000);

  it('cancels an active streamed turn through the shared harness and completes the session lifecycle', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-cancel-'));
    temporaryDirectories.push(directory);
    const fixture = await startProviderFixture();
    fixture.setBehavior('cancel');
    const registry = getProviderRegistry();
    vi.stubEnv('HYSCODE_CONFIG_PATH', path.join(directory, 'settings.json'));
    vi.stubEnv('HYSCODE_KEYCHAIN_PATH', path.join(directory, 'keychain.json'));
    vi.stubEnv('HYSCODE_TUI_DATA_PATH', path.join(directory, 'tui-data.json'));

    const events: BridgeEvent[] = [];
    const bridge = new TuiBridge((message) => {
      if (message.type === 'event') events.push(message);
    });
    try {
      await bridge.handle({
        id: 'initialize',
        method: 'initialize',
        params: { workspacePath: directory, projectId: 'cancel-fixture', agentType: 'chat' },
      });
      registry.register(new OpenAIProvider('fixture-key', fixture.baseUrl));
      await bridge.handle({
        id: 'config',
        method: 'set_config',
        params: { providerId: 'openai', modelId: 'gpt-5.4-mini' },
      });

      const turnPromise = bridge.handle({
        id: 'turn',
        method: 'send_message',
        params: { message: 'Wait for the fixture response.' },
      });
      await waitForEvent(events, (event) => event.event === 'harness_event' && event.payload.type === 'stream_chunk');
      expect(successfulResult<{ cancelled: boolean }>(await bridge.handle({ id: 'cancel', method: 'cancel', params: {} })).cancelled).toBe(true);
      const turn = successfulResult<{ status: string; response: string }>(await turnPromise);
      expect(turn.status).toBe('cancelled');
      expect(turn.response).toBe('Request cancelled.');
      expect(events.some((event) => event.event === 'harness_event' && event.payload.type === 'turn_end')).toBe(true);
    } finally {
      registry.unregister('openai');
      await bridge.handle({ id: 'shutdown', method: 'shutdown', params: {} });
      await fixture.close();
    }
  });
});

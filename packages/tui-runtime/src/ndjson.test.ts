import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runNdjsonBridge } from './ndjson';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

type JsonMessage = Record<string, unknown>;

async function waitForMessage(
  messages: JsonMessage[],
  predicate: (message: JsonMessage) => boolean,
  timeoutMs = 5_000,
): Promise<JsonMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = messages.findIndex(predicate);
    if (index >= 0) return messages.splice(index, 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for NDJSON message.');
}

describe('NDJSON runtime protocol', () => {
  it('runs initialize, terminal lifecycle, resize, and shutdown over one stream', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-ndjson-'));
    temporaryDirectories.push(directory);
    const input = new PassThrough();
    const output = new PassThrough();
    const messages: JsonMessage[] = [];
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/u).filter(Boolean)) messages.push(JSON.parse(line) as JsonMessage);
    });
    const bridgePromise = runNdjsonBridge({
      input,
      output,
      initializeDefaults: { workspacePath: directory, projectId: 'ndjson-default' },
    });
    const send = (message: JsonMessage): void => { input.write(`${JSON.stringify(message)}\n`); };

    send({
      id: 'initialize',
      method: 'initialize',
      params: {
        projectId: 'ndjson-fixture',
        configPath: path.join(directory, 'settings.json'),
      },
    });
    const initialized = await waitForMessage(messages, (message) => message.type === 'response' && message.id === 'initialize');
    expect(initialized.ok).toBe(true);
    expect(initialized.result).toMatchObject({ workspacePath: directory, projectId: 'ndjson-fixture' });
    expect(messages.some((message) => message.event === 'runtime_ready')).toBe(true);

    send({ id: 'open', method: 'terminal_open', params: { forceNew: true } });
    const opened = await waitForMessage(messages, (message) => message.type === 'response' && message.id === 'open');
    expect(opened).toMatchObject({ ok: true, result: { role: 'user' } });
    const terminalId = ((opened.result as { terminalId?: string }).terminalId);
    expect(terminalId).toBeTruthy();

    send({ id: 'resize', method: 'terminal_resize', params: { terminalId, cols: 100, rows: 28 } });
    expect(await waitForMessage(messages, (message) => message.type === 'response' && message.id === 'resize')).toMatchObject({ ok: true, result: { resized: true } });

    send({ id: 'shutdown', method: 'shutdown', params: {} });
    expect(await waitForMessage(messages, (message) => message.type === 'response' && message.id === 'shutdown')).toMatchObject({ ok: true, result: { shutdown: true } });
    input.end();
    await bridgePromise;
    output.end();
  }, 20_000);
});

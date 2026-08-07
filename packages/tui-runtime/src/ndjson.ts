import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { TuiBridge } from './bridge';
import type { BridgeRequest } from './protocol';

export type NdjsonBridgeOptions = {
  input?: Readable;
  output?: Writable;
  initializeDefaults?: Record<string, unknown>;
};

/**
 * Runs the typed runtime protocol over newline-delimited JSON. The same loop
 * is used by the compatibility entrypoint and by the packaged VORTEX CLI so
 * non-TTY automation has the same Harness and terminal lifecycle as the TUI.
 */
export async function runNdjsonBridge(options: NdjsonBridgeOptions = {}): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const write = (value: unknown): void => {
    output.write(`${JSON.stringify(value)}\n`);
  };
  const bridge = new TuiBridge(write);
  const reader = createInterface({ input, crlfDelay: Infinity });
  let serialized: Promise<void> = Promise.resolve();

  await new Promise<void>((resolve) => {
    reader.on('line', (line) => {
      const method = readMethod(line);
      const task = () => handleLine(bridge, line, write, options.initializeDefaults ?? {});
      if (method === 'cancel' || method === 'resolve_interaction' || method === 'host_response' || method === 'host_event') {
        void task();
      } else {
        serialized = serialized.then(task);
      }
    });
    reader.on('close', () => {
      void serialized
        .then(() => bridge.handle({ id: 'stdin-close', method: 'shutdown' }))
        .catch(() => undefined)
        .finally(resolve);
    });
  });
}

function readMethod(line: string): string | null {
  try {
    const request = JSON.parse(line) as { method?: unknown };
    return typeof request.method === 'string' ? request.method : null;
  } catch {
    return null;
  }
}

async function handleLine(
  bridge: TuiBridge,
  line: string,
  write: (value: unknown) => void,
  initializeDefaults: Record<string, unknown>,
): Promise<void> {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line) as BridgeRequest;
    const normalizedRequest = request.method === 'initialize'
      ? { ...request, params: { ...initializeDefaults, ...(request.params ?? {}) } }
      : request;
    write(await bridge.handle(normalizedRequest));
  } catch (error) {
    write({ type: 'event', event: 'fatal', payload: { message: error instanceof Error ? error.message : String(error) } });
  }
}

import { createInterface } from 'node:readline';
import { TuiBridge } from './bridge';
import type { BridgeRequest } from './protocol';

// Compatibility entrypoint for integrations that still speak the typed
// NDJSON protocol. The production TypeScript TUI imports TuiBridge directly
// and does not launch this process.
const bridge = new TuiBridge((message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
});

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let serializedRequests: Promise<void> = Promise.resolve();

input.on('line', (line) => {
  const method = readMethod(line);
  if (method === 'cancel' || method === 'resolve_interaction' || method === 'host_response' || method === 'host_event') {
    void handleLine(line);
    return;
  }
  serializedRequests = serializedRequests.then(() => handleLine(line));
});

input.on('close', () => {
  void serializedRequests.then(() => bridge.handle({ id: 'stdin-close', method: 'shutdown' })).catch(() => undefined);
});

function readMethod(line: string): string | null {
  try {
    const request = JSON.parse(line) as { method?: unknown };
    return typeof request.method === 'string' ? request.method : null;
  } catch {
    return null;
  }
}

async function handleLine(line: string): Promise<void> {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line) as BridgeRequest;
    const response = await bridge.handle(request);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ type: 'event', event: 'fatal', payload: { message: error instanceof Error ? error.message : String(error) } })}\n`);
  }
}

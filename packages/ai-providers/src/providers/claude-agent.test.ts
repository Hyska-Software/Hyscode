import { describe, expect, it } from 'vitest';

import type { ChatParams, StreamChunk } from '../types';
import { ClaudeAgentProvider } from './claude-agent';

function params(maxTurns?: number): ChatParams {
  return {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
    maxTurns,
  };
}

describe('ClaudeAgentProvider interaction limit', () => {
  it.each([undefined, 12])('forwards maxTurns=%s without adding a fallback', async (maxTurns) => {
    let receivedMaxTurns: number | undefined;
    const provider = new ClaudeAgentProvider('key', async function* (request) {
      receivedMaxTurns = request.maxTurns;
      yield { type: 'done', stopReason: 'end_turn' } satisfies StreamChunk;
    });

    for await (const _chunk of provider.chat(params(maxTurns))) {
      // Consume the provider stream.
    }

    expect(receivedMaxTurns).toBe(maxTurns);
  });
});

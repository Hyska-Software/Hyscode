import { describe, expect, it } from 'vitest';

import type { ChatParams, StreamChunk } from '../types';
import { CodexProvider } from './codex';
import type { CodexInvoke } from './codex';

function params(model = 'gpt-5.6-terra'): ChatParams {
  return {
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
  };
}

function captureInvoke() {
  const calls: Array<Parameters<CodexInvoke>[0]> = [];
  const invoke: CodexInvoke = async function* (request) {
    calls.push(request);
    yield { type: 'done', stopReason: 'end_turn' } satisfies StreamChunk;
  };
  return { calls, invoke };
}

async function consume(provider: CodexProvider, chatParams: ChatParams): Promise<void> {
  for await (const _chunk of provider.chat(chatParams)) {
    // Consume the provider stream.
  }
}

describe('CodexProvider configuration', () => {
  it('isConfigured with an API key', () => {
    expect(new CodexProvider('key').isConfigured()).toBe(true);
  });

  it('isConfigured with a detected ChatGPT login', () => {
    expect(new CodexProvider('', undefined, true).isConfigured()).toBe(true);
  });

  it('not configured without key or login', () => {
    expect(new CodexProvider('').isConfigured()).toBe(false);
  });

  it('prefers an explicit API key over the login flag', () => {
    const provider = new CodexProvider('key', undefined, true);
    expect(provider.isConfigured()).toBe(true);
  });
});

describe('CodexProvider chat', () => {
  it('flattens messages into a prompt and forwards system prompt', async () => {
    const { calls, invoke } = captureInvoke();
    const provider = new CodexProvider('key', invoke);

    await consume(
      provider,
      {
        model: 'gpt-5.6-sol',
        systemPrompt: 'You are helpful.',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
        ],
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('gpt-5.6-sol');
    expect(calls[0].systemPrompt).toBe('You are helpful.');
    expect(calls[0].prompt).toContain('User:\nhello');
    expect(calls[0].prompt).toContain('Assistant:\nhi there');
  });

  it('omits apiKey when the provider has none (ChatGPT login mode)', async () => {
    const { calls, invoke } = captureInvoke();
    const provider = new CodexProvider('', invoke, true);

    await consume(provider, params());

    expect(calls[0].apiKey).toBeUndefined();
  });

  it('falls back to the first catalog model for an empty model id', async () => {
    const { calls, invoke } = captureInvoke();
    const provider = new CodexProvider('key', invoke);

    await consume(provider, { ...params(), model: '' });

    // The SDK treats '' as "no --model flag" — never forward it.
    expect(calls[0].model).toBe('gpt-5.6-sol');
  });

  it('forwards the abort signal so stop cancels the sidecar process', async () => {
    const { calls, invoke } = captureInvoke();
    const provider = new CodexProvider('key', invoke);
    const controller = new AbortController();

    await consume(provider, { ...params(), signal: controller.signal });

    expect(calls[0].signal).toBe(controller.signal);
  });

  it('maps the harness agent mode to the Codex sandbox', async () => {
    const cases: Array<[string | undefined, string]> = [
      ['chat', 'read-only'],
      ['review', 'read-only'],
      ['plan', 'workspace-write'],
      ['build', 'danger-full-access'],
      ['debug', 'danger-full-access'],
      [undefined, 'danger-full-access'],
      ['unknown-mode', 'danger-full-access'],
    ];

    for (const [mode, expected] of cases) {
      const { calls, invoke } = captureInvoke();
      const provider = new CodexProvider('key', invoke);
      await consume(provider, { ...params(), ...(mode ? { agentMode: mode } : {}) });
      expect(calls[0].sandboxMode).toBe(expected);
    }
  });

  it('forwards the API key when present', async () => {
    const { calls, invoke } = captureInvoke();
    const provider = new CodexProvider('sk-123', invoke);

    await consume(provider, params());

    expect(calls[0].apiKey).toBe('sk-123');
  });

  it('maps thinking level to reasoning effort', async () => {
    const { calls, invoke } = captureInvoke();
    const provider = new CodexProvider('key', invoke);

    await consume(
      provider,
      {
        ...params(),
        thinking: { enabled: true, level: 'high' },
      },
    );

    expect(calls[0].reasoningEffort).toBe('high');
  });

  it('forwards the stable HysCode session and continuation context', async () => {
    const { calls, invoke } = captureInvoke();
    const provider = new CodexProvider('key', invoke);

    await consume(
      provider,
      {
        ...params(),
        sessionId: 'conversation-1',
        sessionFingerprint: 'prefix-1',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'first request' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'previous answer' }] },
          { role: 'user', content: [{ type: 'text', text: 'latest request' }] },
        ],
      },
    );

    expect(calls[0]).toMatchObject({
      sessionId: 'conversation-1',
      sessionFingerprint: 'prefix-1',
      continuationPrompt: 'latest request',
    });
    expect(calls[0].prompt).toContain('User:\nfirst request');
  });

  it('omits reasoning effort for non-mapped levels', async () => {
    const { calls, invoke } = captureInvoke();
    const provider = new CodexProvider('key', invoke);

    await consume(
      provider,
      {
        ...params(),
        thinking: { enabled: true, level: 'enabled' },
      },
    );

    expect(calls[0].reasoningEffort).toBeUndefined();
  });

  it('yields an error chunk without a sidecar transport', async () => {
    const provider = new CodexProvider('key');

    const chunks: StreamChunk[] = [];
    for await (const chunk of provider.chat(params())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
  });
});

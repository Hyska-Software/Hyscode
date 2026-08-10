/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ContextTab } from './context-tab';
import { useAgentStore, type ChatMessage, type TokenUsage } from '@/stores/agent-store';

afterEach(() => {
  cleanup();
  useAgentStore.getState().resetProjectState();
});

describe('ContextTab', () => {
  it('renders an explicit empty state without fabricating session data', () => {
    const { container } = render(<ContextTab />);

    expect(container.textContent).toContain('No context data yet');
    expect(container.textContent).toContain('Not available');
  });

  it('renders live message and token data from the active agent store', () => {
    const messages: ChatMessage[] = [
      { id: 'message-1', role: 'user', content: 'Inspect this file', timestamp: 1 },
      { id: 'message-2', role: 'assistant', content: 'I inspected it.', timestamp: 2 },
    ];
    const usage: TokenUsage = {
      inputTokens: 1_200,
      outputTokens: 240,
      totalTokens: 1_440,
      reasoningTokens: 80,
    };

    useAgentStore.setState({
      messages,
      tokenUsage: usage,
      conversationId: null,
      contextFiles: ['src/app.ts'],
      gatheredContext: [{ path: 'src/app.ts', relevance: 0.9, tokenEstimate: 320 }],
      pendingToolCalls: [],
    });

    const { container } = render(<ContextTab />);
    const text = container.textContent ?? '';

    expect(text).toContain('Latest assistant turn');
    expect(text).toContain('Messages');
    expect(text).toContain('Tool calls');
    expect(text).toContain('Workspace files');
    expect(text).toContain('1,200');
    expect(text).toContain('80');
    expect(text).toContain('Not available');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { defaultPerTabState, useAgentStore } from './agent-store';

describe('agent tab turn ownership', () => {
  beforeEach(() => {
    const initial = defaultPerTabState('chat');
    useAgentStore.setState({
      ...initial,
      openTabs: [
        { id: 'active', title: 'Active' },
        { id: 'other', title: 'Other' },
      ],
      activeTabId: 'active',
      tabStates: { other: defaultPerTabState('chat') },
    });
  });

  it('does not close the tab that owns an active turn', () => {
    useAgentStore.getState().setStreaming(true);
    useAgentStore.getState().closeTab('active');

    expect(useAgentStore.getState().activeTabId).toBe('active');
    expect(useAgentStore.getState().openTabs).toHaveLength(2);
  });

  it('allows closing the owning tab after the turn ends', () => {
    useAgentStore.getState().closeTab('active');

    expect(useAgentStore.getState().activeTabId).toBe('other');
    expect(useAgentStore.getState().openTabs).toHaveLength(1);
  });

  it('tracks degraded connection and recoverable error state per tab', () => {
    useAgentStore.getState().setConnectionState('degraded', 'Stream interrupted');
    useAgentStore.getState().setRecoverableError({
      error: {
        kind: 'stream_interrupted',
        phase: 'streaming',
        provider: 'test',
        retryable: false,
        technicalMessage: 'connection reset',
        userMessage: 'The response connection was interrupted.',
      },
      action: 'continue',
      partialText: 'partial',
      retryCount: 0,
      possibleDuplicateCharge: false,
    });
    expect(useAgentStore.getState().connectionState).toBe('degraded');
    expect(useAgentStore.getState().recoverableError?.action).toBe('continue');
  });

  it('applies a mode switch only from the confirmed request', () => {
    const request = {
      id: 'switch-1',
      fromMode: 'review' as const,
      toMode: 'build' as const,
      reason: 'Implement reviewed fixes',
      contextSummary: 'Validated findings',
    };
    useAgentStore.getState().setMode('review');
    useAgentStore.getState().setPendingModeSwitch(request);

    expect(useAgentStore.getState().mode).toBe('review');
    useAgentStore.getState().setPendingModeSwitch(null);
    expect(useAgentStore.getState().mode).toBe('review');

    useAgentStore.getState().resolveModeSwitch(request, true);
    expect(useAgentStore.getState().mode).toBe('build');
    expect(useAgentStore.getState().delegationChain).toEqual([
      { fromMode: 'review', toMode: 'build', reason: 'Implement reviewed fixes' },
    ]);
  });

  it('resolves only edit sessions and summary files owned by one turn', () => {
    const makeSession = (id: string, turnId: string) => ({
      id,
      turnId,
      filePath: `${id}.ts`,
      toolName: 'write_file',
      toolCallId: `tool-${id}`,
      originalContent: 'before',
      newContent: 'after',
      phase: 'pending_review' as const,
      isNewFile: false,
      hunks: [{ type: 'modify' as const, oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
      createdAt: 0,
    });
    useAgentStore.setState({
      agentEditSessions: [makeSession('a', 'turn-a'), makeSession('b', 'turn-b')],
    });
    useAgentStore.getState().addMessage({
      id: 'assistant-a',
      role: 'assistant',
      content: 'done',
      timestamp: 0,
      turnSummary: {
        turnId: 'turn-a',
        status: 'complete',
        durationMs: 10,
        toolCallCount: 1,
        files: [
          {
            sessionId: 'a',
            filePath: 'a.ts',
            kind: 'edited',
            added: 1,
            removed: 1,
            originalContent: 'before',
            newContent: 'after',
            hunks: [{ type: 'modify', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
            resolution: 'pending',
          },
        ],
      },
    });

    useAgentStore.getState().resolveTurnEditSessions('turn-a', false);

    expect(useAgentStore.getState().agentEditSessions.map((item) => item.phase)).toEqual([
      'rejected',
      'pending_review',
    ]);
    expect(useAgentStore.getState().messages[0].turnSummary?.files[0].resolution).toBe('undone');
  });

  it('does not duplicate streamed assistant text when a tool message becomes last', () => {
    useAgentStore.getState().beginAssistantMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 0,
    });
    useAgentStore.getState().appendStreamingText('Inspecting the project.');
    useAgentStore.getState().addMessage({
      id: 'tool-1',
      role: 'tool',
      content: '',
      blocks: [{ type: 'tool_result', toolCallId: 'call-1', output: 'result' }],
      timestamp: 1,
    });

    useAgentStore.getState().flushStreamingText();

    const state = useAgentStore.getState();
    expect(state.messages.map((message) => message.role)).toEqual(['assistant', 'tool']);
    expect(state.messages[0].content).toBe('Inspecting the project.');
    expect(state.streamingText).toBe('');
  });

  it('keeps text, thinking, blocks, and tool calls bound to their assistant iteration', () => {
    useAgentStore.getState().beginAssistantMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 0,
    });
    useAgentStore.getState().appendStreamingText('First iteration.');
    useAgentStore.getState().addToolCall({
      id: 'call-1',
      name: 'read_file',
      input: { path: 'src/app.ts' },
      status: 'running',
    });
    useAgentStore.getState().setStreamingAssistantBlocks([
      { type: 'text', text: 'First iteration.' },
      { type: 'tool_call', id: 'call-1', name: 'read_file', input: { path: 'src/app.ts' } },
    ]);
    useAgentStore.getState().addMessage({
      id: 'tool-1',
      role: 'tool',
      content: '',
      blocks: [{ type: 'tool_result', toolCallId: 'call-1', output: 'result' }],
      timestamp: 1,
    });
    useAgentStore.getState().flushStreamingText();
    useAgentStore.getState().beginAssistantMessage({
      id: 'assistant-2',
      role: 'assistant',
      content: '',
      timestamp: 2,
    });
    useAgentStore.getState().appendThinkingText('New reasoning.');
    useAgentStore.getState().appendStreamingText('Final response.');
    useAgentStore
      .getState()
      .setStreamingAssistantBlocks([{ type: 'text', text: 'Final response.' }]);

    const assistants = useAgentStore
      .getState()
      .messages.filter((message) => message.role === 'assistant');
    expect(assistants).toHaveLength(2);
    expect(assistants[0]).toMatchObject({
      id: 'assistant-1',
      content: 'First iteration.',
      toolCalls: [{ id: 'call-1' }],
    });
    expect(assistants[0].blocks).toHaveLength(2);
    expect(assistants[1]).toMatchObject({
      id: 'assistant-2',
      content: 'Final response.',
      thinking: 'New reasoning.',
      blocks: [{ type: 'text', text: 'Final response.' }],
    });
  });

  it('reconciles terminal content with the active assistant when a tool message is last', () => {
    useAgentStore.getState().beginAssistantMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 0,
    });
    useAgentStore.getState().appendStreamingText('Partial response.');
    useAgentStore.getState().addMessage({
      id: 'tool-1',
      role: 'tool',
      content: '',
      blocks: [{ type: 'tool_result', toolCallId: 'call-1', output: 'result' }],
      timestamp: 1,
    });
    useAgentStore.getState().flushStreamingText();
    useAgentStore.getState().updateLastAssistantContent('Iteration limit reached.');

    const state = useAgentStore.getState();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({
      id: 'assistant-1',
      content: 'Iteration limit reached.',
      isError: false,
    });
    expect(state.messages[1].role).toBe('tool');
  });
});

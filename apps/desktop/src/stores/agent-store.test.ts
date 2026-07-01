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
});

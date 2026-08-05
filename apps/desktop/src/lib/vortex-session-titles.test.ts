import { describe, expect, it } from 'vitest';
import { resolveVortexSessionTitle } from './vortex-session-titles';

describe('VORTEX session title resolution', () => {
  it('keeps an explicit meaningful title ahead of persisted and derived values', () => {
    expect(
      resolveVortexSessionTitle({
        explicitTitle: 'Manually renamed session',
        persistedTitle: 'Persisted title',
        firstUserMessage: 'First message',
      }),
    ).toBe('Manually renamed session');
  });

  it('ignores generic titles when a first user message can provide a fallback', () => {
    expect(
      resolveVortexSessionTitle({
        explicitTitle: 'New Chat',
        persistedTitle: 'New Conversation',
        tabTitle: 'New Chat',
        firstUserMessage: 'Restore the previous VORTEX session',
      }),
    ).toBe('Restore the previous VORTEX session');
  });

  it('keeps empty sessions on the default title', () => {
    expect(resolveVortexSessionTitle({ persistedTitle: 'New Chat', tabTitle: 'New Chat' })).toBe('New Chat');
  });
});

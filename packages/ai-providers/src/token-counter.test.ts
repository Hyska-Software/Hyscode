import { describe, expect, it } from 'vitest';
import { estimateMessageTokens } from './token-counter';

describe('estimateMessageTokens', () => {
  it('counts provider reasoning blocks', () => {
    const withoutThinking = estimateMessageTokens([{ role: 'assistant', content: [] }]);
    const withThinking = estimateMessageTokens([
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'x'.repeat(400) }] },
    ]);
    expect(withThinking - withoutThinking).toBe(100);
  });
});

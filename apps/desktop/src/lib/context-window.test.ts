import { describe, expect, it } from 'vitest';
import { resolveContextWindow } from './context-window';

describe('resolveContextWindow', () => {
  it('resolves DeepSeek V4 Flash to its registered one-million-token window', () => {
    expect(resolveContextWindow(null, 'deepseek-v4-flash')).toBe(1_000_000);
  });

  it('keeps the free DeepSeek V4 Flash variant at 128k', () => {
    expect(resolveContextWindow(null, 'deepseek-v4-flash-free')).toBe(128_000);
  });

  it('returns unknown for an unregistered model', () => {
    expect(resolveContextWindow(null, 'unregistered-model')).toBeNull();
  });
});

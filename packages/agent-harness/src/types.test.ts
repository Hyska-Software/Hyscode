import { describe, expect, it } from 'vitest';
import { CATEGORY_RISK, SAFE_TOOLS } from './types';
import { webFetchTool, webSearchTool } from './tools';

/**
 * Single source of truth for tool risk classification.
 * The smart-approval mode in the desktop app derives its safe set from
 * SAFE_TOOLS, so web tools must agree across all three declarations.
 */
describe('web tool approval classification', () => {
  it('declares browser category as safe', () => {
    expect(CATEGORY_RISK.browser).toBe('safe');
  });

  it('keeps web_search and web_fetch in SAFE_TOOLS', () => {
    expect(SAFE_TOOLS.has('web_search')).toBe(true);
    expect(SAFE_TOOLS.has('web_fetch')).toBe(true);
  });

  it('marks web tools as requiring no approval and safe risk', () => {
    for (const tool of [webSearchTool, webFetchTool]) {
      expect(tool.requiresApproval).toBe(false);
      expect(tool.category).toBe('browser');
    }
  });

  it('does not allow the risk classification to drift to moderate/destructive', () => {
    // If someone reclassifies browser tools, the smart-mode auto-approval
    // (and this test) must be revisited deliberately.
    for (const tool of [webSearchTool, webFetchTool]) {
      expect(CATEGORY_RISK[tool.category]).not.toBe('moderate');
      expect(CATEGORY_RISK[tool.category]).not.toBe('destructive');
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  CATEGORY_RISK,
  DESTRUCTIVE_TOOLS,
  GIT_MUTATION_TOOLS,
  SAFE_TOOLS,
} from './types';
import { getAllBuiltinTools, webFetchTool, webSearchTool } from './tools';

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

describe('git tool approval classification', () => {
  const gitTools = getAllBuiltinTools().filter((tool) => tool.category === 'git');

  it('declares risk on every git tool handler', () => {
    for (const tool of gitTools) {
      expect(tool.riskLevel).toBeDefined();
    }
  });

  it('keeps read-only git tools in SAFE_TOOLS', () => {
    const readOnly = ['git_status', 'git_diff', 'git_log', 'git_show', 'git_blame', 'git_fetch'];
    for (const name of readOnly) {
      const tool = gitTools.find((t) => t.definition.name === name);
      expect(tool?.riskLevel).toBe('safe');
      expect(SAFE_TOOLS.has(name)).toBe(true);
    }
  });

  it('keeps every destructive git tool in DESTRUCTIVE_TOOLS', () => {
    for (const tool of gitTools) {
      if (tool.riskLevel === 'destructive') {
        expect(DESTRUCTIVE_TOOLS.has(tool.definition.name)).toBe(true);
      }
    }
  });

  it('marks every GIT_MUTATION_TOOLS entry as requiring approval', () => {
    const byName = new Map(gitTools.map((tool) => [tool.definition.name, tool]));
    for (const name of GIT_MUTATION_TOOLS) {
      const tool = byName.get(name);
      expect(tool, `missing handler for ${name}`).toBeDefined();
      expect(tool!.requiresApproval, `${name} must require approval`).toBe(true);
    }
  });
});

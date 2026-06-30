import { describe, expect, it } from 'vitest';
import { estimateToolDefinitionTokens, type ToolDefinition } from '@hyscode/ai-providers';
import { selectToolDefinitions } from './tool-selection';

type EvalCase = { name: string; prompt: string; required: string[] };

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} capability ${'schema documentation '.repeat(20)}`,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, path: { type: 'string' } },
    },
  };
}

const corpus: EvalCase[] = [
  { name: 'chat', prompt: 'explain the current file', required: ['read_file'] },
  {
    name: 'build',
    prompt: 'edit the TypeScript implementation',
    required: ['read_file', 'edit_file'],
  },
  {
    name: 'debug',
    prompt: 'run tests and inspect the failure',
    required: ['run_terminal_command'],
  },
  { name: 'review', prompt: 'review the git diff', required: ['git_diff'] },
  { name: 'mcp', prompt: 'use MCP github issues', required: ['mcp__github__issues'] },
  {
    name: 'large-file',
    prompt: 'search and read the large source file',
    required: ['search_code', 'read_file'],
  },
];

describe('cost optimization eval corpus', () => {
  it('preserves required capabilities while reducing median schema tokens by at least 30 percent', () => {
    const tools = [
      ...[
        'read_file',
        'edit_file',
        'run_terminal_command',
        'git_diff',
        'search_code',
        'search_tools',
        'invoke_external_tool',
      ].map(tool),
      tool('mcp__github__issues'),
      ...Array.from({ length: 19 }, (_, index) => tool(`mcp__server__tool_${index}`)),
      ...Array.from({ length: 8 }, (_, index) => tool(`docker_tool_${index}`)),
      ...Array.from({ length: 6 }, (_, index) => tool(`web_tool_${index}`)),
    ];
    const baseline = estimateToolDefinitionTokens(tools);
    const reductions = corpus
      .map((scenario) => {
        const selected = selectToolDefinitions(tools, scenario.prompt, new Set());
        const names = new Set(selected.map((entry) => entry.name));
        for (const required of scenario.required)
          expect(names.has(required), scenario.name).toBe(true);
        return 1 - estimateToolDefinitionTokens(selected) / baseline;
      })
      .sort((left, right) => left - right);
    const median = reductions[Math.floor(reductions.length / 2)];
    expect(median).toBeGreaterThanOrEqual(0.3);
  });
});

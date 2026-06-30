import { describe, expect, it } from 'vitest';
import { estimateToolDefinitionTokens, type ToolDefinition } from '@hyscode/ai-providers';
import { selectToolDefinitions } from './tool-selection';

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `Tool ${name} ${'description '.repeat(30)}`,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  };
}

describe('selectToolDefinitions', () => {
  it('reduces irrelevant dynamic schemas by at least 30 percent', () => {
    const tools = [
      tool('read_file'),
      tool('edit_file'),
      ...Array.from({ length: 20 }, (_, index) => tool(`mcp__server__tool_${index}`)),
      ...Array.from({ length: 8 }, (_, index) => tool(`docker_tool_${index}`)),
    ];
    const selected = selectToolDefinitions(tools, 'update the local TypeScript file', new Set());
    expect(estimateToolDefinitionTokens(selected)).toBeLessThanOrEqual(
      estimateToolDefinitionTokens(tools) * 0.7,
    );
    expect(selected.map((entry) => entry.name)).toEqual(['read_file', 'edit_file']);
  });

  it('restores MCP tools when explicitly requested', () => {
    const tools = [tool('read_file'), tool('mcp__github__issues')];
    expect(selectToolDefinitions(tools, 'use MCP to inspect issues', new Set())).toHaveLength(2);
  });
});

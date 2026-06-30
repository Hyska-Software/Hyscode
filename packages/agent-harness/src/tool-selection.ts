import type { ToolDefinition } from '@hyscode/ai-providers';
import type { AgentType } from './types';

const CORE_TOOLS = new Set([
  'read_file',
  'read_multiple_files',
  'list_directory',
  'find_files',
  'search_code',
  'get_file_info',
  'get_diagnostics',
  'git_status',
  'git_diff',
  'manage_tasks',
  'ask_user',
  'list_skills',
  'activate_skill',
  'gather_context',
  'drop_context',
  'list_context',
  'request_mode_switch',
  'search_tools',
  'invoke_external_tool',
  'detect_project_type',
]);
const MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'replace_lines',
  'insert_lines',
  'create_file',
  'delete_file',
  'rename_file',
  'copy_file',
]);
const EXECUTION_TOOLS = new Set(['run_terminal_command', 'run_code']);

export function selectToolDefinitions(
  tools: ToolDefinition[],
  userMessage: string,
  recentlyUsed: ReadonlySet<string>,
  mode: AgentType = 'build',
): ToolDefinition[] {
  return selectToolPlan(tools, userMessage, recentlyUsed, mode).tools;
}

export type ToolSelectionDecision = {
  name: string;
  selected: boolean;
  reason: 'core' | 'mode-bundle' | 'recent' | 'explicit' | 'ranked-external' | 'not-relevant';
};

export function selectToolPlan(
  tools: ToolDefinition[],
  userMessage: string,
  recentlyUsed: ReadonlySet<string>,
  mode: AgentType = 'build',
): { tools: ToolDefinition[]; decisions: ToolSelectionDecision[] } {
  const text = userMessage.toLowerCase();
  const wantsGit = /\bgit\b|commit|branch|merge|push|pull|stash|blame/.test(text);
  const wantsDocker = /docker|container|image/.test(text);
  const wantsWeb = /https?:\/\/|\bweb\b|internet|pesquis|search online/.test(text);
  const wantsMcp = /\bmcp\b/.test(text);
  const wantsMutation =
    ['build', 'debug'].includes(mode) ||
    /\b(edit|write|create|delete|remove|rename|copy|modify|fix|implement)/.test(text);
  const wantsExecution =
    ['build', 'debug'].includes(mode) ||
    /\b(run|test|build|execute|terminal|command|compile)/.test(text);
  const rankedMcp = wantsMcp
    ? tools
        .filter((tool) => tool.name.startsWith('mcp__'))
        .map((tool) => ({ tool, score: relevanceScore(tool, text) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, 8)
        .map(({ tool }) => tool.name)
    : [];
  const selectedMcp = new Set(rankedMcp);

  const decisions: ToolSelectionDecision[] = [];
  const selected = tools.filter((tool) => {
    if (CORE_TOOLS.has(tool.name)) {
      decisions.push({ name: tool.name, selected: true, reason: 'core' });
      return true;
    }
    if (MUTATION_TOOLS.has(tool.name) && wantsMutation) {
      decisions.push({ name: tool.name, selected: true, reason: 'mode-bundle' });
      return true;
    }
    if (EXECUTION_TOOLS.has(tool.name) && wantsExecution) {
      decisions.push({ name: tool.name, selected: true, reason: 'mode-bundle' });
      return true;
    }
    if (recentlyUsed.has(tool.name)) {
      decisions.push({ name: tool.name, selected: true, reason: 'recent' });
      return true;
    }
    if (
      text.includes(tool.name.toLowerCase()) ||
      text.includes(tool.name.toLowerCase().replace(/_/g, ' '))
    ) {
      decisions.push({ name: tool.name, selected: true, reason: 'explicit' });
      return true;
    }
    const dynamicSelected = tool.name.startsWith('mcp__')
      ? selectedMcp.has(tool.name)
      : tool.name.startsWith('docker_')
        ? wantsDocker
        : tool.name.startsWith('git_')
          ? wantsGit
          : tool.name.startsWith('web_')
            ? wantsWeb
            : false;
    decisions.push({
      name: tool.name,
      selected: dynamicSelected,
      reason: dynamicSelected ? 'ranked-external' : 'not-relevant',
    });
    return dynamicSelected;
  });
  return { tools: selected, decisions };
}

function relevanceScore(tool: ToolDefinition, message: string): number {
  const terms = new Set(
    message.split(/[^a-z0-9_-]+/).filter((term) => term.length > 2 && term !== 'mcp'),
  );
  const haystack = `${tool.name} ${tool.description}`.toLowerCase();
  return Array.from(terms).reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

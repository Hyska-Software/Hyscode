import type { ToolDefinition } from '@hyscode/ai-providers';

const CORE_TOOLS = new Set([
  'read_file',
  'read_multiple_files',
  'list_directory',
  'find_files',
  'search_code',
  'get_file_info',
  'write_file',
  'edit_file',
  'replace_lines',
  'insert_lines',
  'create_file',
  'run_terminal_command',
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
]);

export function selectToolDefinitions(
  tools: ToolDefinition[],
  userMessage: string,
  recentlyUsed: ReadonlySet<string>,
): ToolDefinition[] {
  const text = userMessage.toLowerCase();
  const wantsGit = /\bgit\b|commit|branch|merge|push|pull|stash|blame/.test(text);
  const wantsDocker = /docker|container|image/.test(text);
  const wantsWeb = /https?:\/\/|\bweb\b|internet|pesquis|search online/.test(text);
  const wantsMcp = /\bmcp\b/.test(text);

  return tools.filter((tool) => {
    if (
      CORE_TOOLS.has(tool.name) ||
      recentlyUsed.has(tool.name) ||
      text.includes(tool.name.toLowerCase())
    )
      return true;
    if (tool.name.startsWith('mcp__')) return wantsMcp;
    if (tool.name.startsWith('docker_')) return wantsDocker;
    if (tool.name.startsWith('git_')) return wantsGit;
    if (tool.name.startsWith('web_')) return wantsWeb;
    return true;
  });
}

import { describe, expect, it } from 'vitest';
import { adaptSystemPromptForAgentic, getAllAgentDefinitions } from './agents';

// Every HysCode-tool reference that must not survive the agentic adaptation.
const HYSCODE_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'replace_lines',
  'insert_lines',
  'search_code',
  'grep_search',
  'find_files',
  'list_directory',
  'gather_context',
  'drop_context',
  'list_context',
  'list_skills',
  'activate_skill',
  'create_skill',
  'web_fetch',
  'run_terminal_command',
  'run_code',
  'get_diagnostics',
  'request_mode_switch',
  'spawn_subagent',
  'ask_user',
  'remember',
  'recall',
  'forget',
  'list_memories',
  'git_status',
  'git_diff',
  'read_terminal_output',
  'respond_terminal_input',
  'stop_terminal_process',
  'docker_run',
];

describe('adaptSystemPromptForAgentic', () => {
  for (const def of getAllAgentDefinitions()) {
    it(`adapts the ${def.type} prompt: no HysCode tool references, Codex guidance present`, () => {
      const original = def.basePrompt;
      const adapted = adaptSystemPromptForAgentic(original);

      // The adapter engaged: agentic edition installed, role section preserved.
      expect(adapted).toContain('## Your Role:');
      expect(adapted).toContain('running as an autonomous Codex agent');
      expect(adapted).toContain('apply_patch');

      for (const tool of HYSCODE_TOOL_NAMES) {
        expect(adapted, `"${tool}" still referenced in the ${def.type} prompt`).not.toContain(tool);
      }

      // Sanity: the original really references HysCode tools, so the
      // completeness assertion above is meaningful.
      expect(original).toContain('read_file');
    });
  }

  it('leaves prompts without the HysCode markers untouched', () => {
    const foreign = 'You are a helpful assistant.\nUse your own tools.\n## Your Role: X';
    expect(adaptSystemPromptForAgentic(foreign)).toBe(foreign);
  });
});

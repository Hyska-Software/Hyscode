import { describe, expect, it } from 'vitest';
import { matchingCommands, parseCliArgs, parseSlashCommand, resolveCommandName } from './commands';

describe('TUI command and CLI parsing', () => {
  it('parses workspace options without changing the caller working directory', () => {
    expect(parseCliArgs(['--workspace', 'C:/A Project', '--mode', 'build'], 'C:/repo')).toEqual({
      kind: 'run',
      options: { workspace: 'C:\\A Project', mode: 'build' },
    });
  });

  it('rejects invalid modes and supports help/version surfaces', () => {
    expect(() => parseCliArgs(['--mode', 'unknown'])).toThrow('Invalid mode');
    expect(parseCliArgs(['--help']).kind).toBe('help');
    expect(parseCliArgs(['--version'], process.cwd(), '9.9.9')).toEqual({ kind: 'version', text: 'hyscode-tui 9.9.9' });
  });

  it('parses quoted slash command arguments and filters the visual palette', () => {
    expect(parseSlashCommand('/project "C:/A Project"')).toEqual({ name: '/project', args: '"C:/A Project"' });
    expect(matchingCommands('/diag').map((command) => command.name)).toEqual(['/diagnostics']);
    expect(resolveCommandName('/q')).toBe('/quit');
    expect(resolveCommandName('/resume')).toBe('/sessions');
  });
});

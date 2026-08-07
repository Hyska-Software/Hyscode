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
    expect(parseCliArgs(['--help'])).toMatchObject({ kind: 'help', text: expect.stringContaining('Usage: vortex') });
    expect(parseCliArgs(['--help'])).toMatchObject({ kind: 'help', text: expect.stringContaining('Update installed or scheduled') });
    expect(parseCliArgs(['--version'], process.cwd(), '9.9.9')).toEqual({ kind: 'version', text: 'vortex 9.9.9' });
  });

  it('recognizes update subcommands before workspace arguments', () => {
    expect(parseCliArgs(['update', '--check', '--channel', 'pre-release', '--config', 'settings.json'], 'C:/repo')).toEqual({
      kind: 'update',
      options: {
        checkOnly: true,
        assumeYes: false,
        channel: 'pre-release',
        configPath: 'C:\\repo\\settings.json',
      },
    });
    expect(parseCliArgs(['C:/workspace'])).toMatchObject({ kind: 'run', options: { workspace: expect.stringContaining('workspace') } });
    expect(() => parseCliArgs(['update', '--channel', 'nightly'])).toThrow('Invalid update channel');
  });

  it('selects the explicit NDJSON protocol for non-interactive automation', () => {
    expect(parseCliArgs(['--workspace', 'C:/workspace', '--protocol', 'ndjson', '--mode', 'build'], 'C:/repo')).toEqual({
      kind: 'run',
      options: { workspace: 'C:\\workspace', mode: 'build', protocol: 'ndjson' },
    });
    expect(() => parseCliArgs(['--protocol', 'json'])).toThrow('Unsupported protocol');
  });

  it('parses quoted slash command arguments and filters the visual palette', () => {
    expect(parseSlashCommand('/project "C:/A Project"')).toEqual({ name: '/project', args: '"C:/A Project"' });
    expect(matchingCommands('/diag').map((command) => command.name)).toEqual(['/diagnostics']);
    expect(resolveCommandName('/q')).toBe('/quit');
    expect(resolveCommandName('/resume')).toBe('/sessions');
  });
});

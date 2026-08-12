import { describe, expect, it } from 'vitest';

import { resolveTerminalShell } from './terminal-shell';

describe('resolveTerminalShell', () => {
  it('resolves configured PowerShell paths to PowerShell framing', () => {
    expect(resolveTerminalShell('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'windows')).toEqual({
      command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      frameLanguage: 'powershell',
    });
    expect(resolveTerminalShell('pwsh', 'windows').frameLanguage).toBe('powershell');
  });

  it('resolves configured POSIX shells to bash framing', () => {
    expect(resolveTerminalShell('/usr/local/bin/zsh', 'posix')).toEqual({
      command: '/usr/local/bin/zsh',
      frameLanguage: 'bash',
    });
  });

  it('uses platform defaults when no shell is configured', () => {
    expect(resolveTerminalShell('', 'windows')).toEqual({ command: 'powershell.exe', frameLanguage: 'powershell' });
    expect(resolveTerminalShell(undefined, 'posix')).toEqual({ command: '/bin/bash', frameLanguage: 'bash' });
    expect(resolveTerminalShell(undefined, 'posix', '/bin/bash')).toEqual({ command: '/bin/bash', frameLanguage: 'bash' });
  });

  it('rejects shells whose framing contract is unknown', () => {
    expect(() => resolveTerminalShell('cmd.exe', 'windows')).toThrow('Unsupported terminal shell');
    expect(() => resolveTerminalShell('/usr/bin/fish', 'posix')).toThrow('Unsupported terminal shell');
  });
});

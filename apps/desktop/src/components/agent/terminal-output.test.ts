import { describe, expect, it } from 'vitest';

import { sanitizeTerminalOutput } from './terminal-output';

describe('terminal output presentation', () => {
  it('removes framing and PowerShell wrapper noise while preserving command output', () => {
    const output = [
      '$global:LASTEXITCODE = 0;',
      '__HYSCODE_BEGIN_abc__',
      '$hysOk = $?;',
      '$hysCode = if ($hysOk) { [int]$LASTEXITCODE }',
      'installed 42 packages',
      '__HYSCODE_END_abc__:0',
    ].join('\r\n');

    expect(sanitizeTerminalOutput(output)).toBe('installed 42 packages');
  });

  it('strips ANSI without changing normal multiline output', () => {
    expect(sanitizeTerminalOutput('\u001b[32mready\u001b[0m\nhttp://localhost:5173')).toBe(
      'ready\nhttp://localhost:5173',
    );
  });
});

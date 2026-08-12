import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';

import {
  appendBounded,
  buildTerminalFrame,
  frameMarker,
  isSensitiveTerminalPrompt,
  looksLikeTerminalPrompt,
  MAX_CAPTURE_CHARS,
  normalizeTerminalOutput,
  parseTerminalFrame,
  stripAnsi,
} from './terminal-protocol';

describe('frameMarker', () => {
  it('builds unique begin/end markers from a nonce', () => {
    expect(frameMarker('BEGIN', 'abc')).toBe('__HYSCODE_BEGIN_abc__');
    expect(frameMarker('END', 'abc')).toBe('__HYSCODE_END_abc__');
    expect(frameMarker('BEGIN', 'abc')).not.toBe(frameMarker('BEGIN', 'def'));
  });
});

describe('stripAnsi', () => {
  it('strips CSI sequences', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red');
    expect(stripAnsi('\u001b[2J\u001b[Htop')).toBe('top');
  });

  it('strips OSC sequences', () => {
    expect(stripAnsi('\u001b]0;title\u0007body')).toBe('body');
    expect(stripAnsi('\u001b]8;;http://x\u001b\\link')).toBe('link');
  });

  it('removes carriage returns and preserves plain text', () => {
    expect(stripAnsi('line1\r\nline2\r')).toBe('line1\nline2');
    expect(stripAnsi('plain text 42')).toBe('plain text 42');
  });
});

describe('appendBounded', () => {
  it('appends while under the cap', () => {
    expect(appendBounded('ab', 'cd')).toBe('abcd');
  });

  it('keeps only the tail when the cap is exceeded', () => {
    const base = 'x'.repeat(MAX_CAPTURE_CHARS);
    const result = appendBounded(base, 'tail');
    expect(result.length).toBe(MAX_CAPTURE_CHARS);
    expect(result.endsWith('tail')).toBe(true);
  });
});

describe('buildTerminalFrame', () => {
  it('builds a bash frame with markers and exit capture', () => {
    const frame = buildTerminalFrame('npm test', 'bash', 'n1');
    expect(frame).toContain("printf '\\n__HYSCODE_BEGIN_n1__\\n'");
    expect(frame).toContain('npm test');
    expect(frame).toContain("trap 'hys_code=$?;");
    expect(frame).toContain('eval "$hys_command"');
    expect(frame).toContain("__HYSCODE_END_n1__:%s");
    expect(frame).toContain("' 0");
    expect(frame).toContain('set +e');
  });

  it('builds a PowerShell frame with completion in a finally block', () => {
    const frame = buildTerminalFrame('Get-ChildItem', 'powershell', 'pw1');
    expect(frame).toContain('$global:LASTEXITCODE = 0;');
    expect(frame).toContain('Write-Output \'__HYSCODE_BEGIN_pw1__\'');
    expect(frame).toContain('__HYSCODE_END_pw1__:{0}');
    expect(frame).toContain('try {');
    expect(frame).toContain("$ErrorActionPreference = 'Stop'");
    expect(frame).toContain('Invoke-Expression -Command $hysCommand');
    expect(frame).toContain('catch {');
    expect(frame).toContain('finally {');
    expect(frame).toContain('Write-Error $_');
  });

  it.skipIf(process.platform !== 'win32')('completes an interactive PowerShell frame with multiline command source', async () => {
    const nonce = 'powershell-multiline';
    const command = `python -c "print('line one')
print('line two')"`;
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile'], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    const closed = new Promise<number | null>((resolve) => child.once('close', resolve));

    child.stdin.end(buildTerminalFrame(command, 'powershell', nonce));

    await closed;
    expect(parseTerminalFrame(output, nonce)).toMatchObject({
      complete: true,
      output: 'line one\nline two',
      exitCode: 0,
    });
  });

  it.skipIf(process.platform !== 'win32')('emits a final marker when the command has a PowerShell parse error', async () => {
    const nonce = 'powershell-parse-error';
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile'], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    const closed = new Promise<number | null>((resolve) => child.once('close', resolve));

    child.stdin.end(buildTerminalFrame('Write-Output "unterminated', 'powershell', nonce));

    await closed;
    const parsed = parseTerminalFrame(output, nonce);
    expect(parsed).toMatchObject({
      complete: true,
      exitCode: 1,
    });
    expect(parsed.output).toContain('unterminated');
  });

  it.skipIf(process.platform === 'win32')('emits a final marker when a POSIX command has a shell parse error', async () => {
    const nonce = 'posix-parse-error';
    const child = spawn('/bin/sh', ['-s']);
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    const closed = new Promise<number | null>((resolve) => child.once('close', resolve));

    child.stdin.end(buildTerminalFrame('printf "unterminated', 'bash', nonce));

    await closed;
    expect(parseTerminalFrame(output, nonce)).toMatchObject({
      complete: true,
      exitCode: 2,
    });
  });
});

describe('parseTerminalFrame', () => {
  const nonce = 'abc';

  it('reports not-started before the begin marker appears', () => {
    expect(parseTerminalFrame('$ prompt', nonce)).toEqual({
      complete: false,
      output: '',
      exitCode: null,
      started: false,
    });
  });

  it('reports started without completion between markers', () => {
    const raw = `__HYSCODE_BEGIN_${nonce}__\npartial output`;
    expect(parseTerminalFrame(raw, nonce)).toMatchObject({
      started: true,
      complete: false,
      output: 'partial output',
    });
  });

  it('extracts output and exit code between markers', () => {
    const raw = `pre\n__HYSCODE_BEGIN_${nonce}__\nout1\nout2\n__HYSCODE_END_${nonce}__:3\n`;
    expect(parseTerminalFrame(raw, nonce)).toEqual({
      started: true,
      complete: true,
      output: 'out1\nout2',
      exitCode: 3,
    });
  });

  it('ignores markers with a different nonce', () => {
    const raw = `__HYSCODE_BEGIN_other__\nx\n__HYSCODE_END_other__:0\n`;
    expect(parseTerminalFrame(raw, nonce).started).toBe(false);
  });

  it('strips ANSI from captured output', () => {
    const raw = `__HYSCODE_BEGIN_${nonce}__\n\u001b[32mok\u001b[0m\n__HYSCODE_END_${nonce}__:0\n`;
    expect(parseTerminalFrame(raw, nonce).output).toBe('ok');
  });
});

describe('normalizeTerminalOutput', () => {
  it('drops marker lines and wrapper noise, keeps command output', () => {
    const raw = [
      '$global:LASTEXITCODE = 0;',
      '__HYSCODE_BEGIN_abc__',
      '$hysOk = $?;',
      '$hysCode = if ($hysOk) { [int]$LASTEXITCODE }',
      'installed 42 packages',
      '__HYSCODE_END_abc__:0',
    ].join('\r\n');
    expect(normalizeTerminalOutput(raw, 16_000)).toBe('installed 42 packages');
  });

  it('strips ANSI and trims outer whitespace', () => {
    expect(normalizeTerminalOutput('\n\u001b[32mready\u001b[0m\n\n', 16_000)).toBe('ready');
  });

  it('bounds the result to maxChars keeping the tail', () => {
    const raw = 'a'.repeat(100) + 'SIGNATURE';
    expect(normalizeTerminalOutput(raw, 9)).toBe('SIGNATURE');
  });

  it('keeps normal multiline output untouched', () => {
    expect(normalizeTerminalOutput('line one\nline two', 16_000)).toBe('line one\nline two');
  });
});

describe('looksLikeTerminalPrompt', () => {
  it('recognizes common interactive prompt shapes', () => {
    expect(looksLikeTerminalPrompt('Continue installation? [Y/n]')).toBe(true);
    expect(looksLikeTerminalPrompt('Choose an option:')).toBe(true);
    expect(looksLikeTerminalPrompt('Password:')).toBe(true);
    expect(looksLikeTerminalPrompt('Press Enter to continue')).toBe(true);
    expect(looksLikeTerminalPrompt('Enter your name:')).toBe(true);
  });

  it('rejects progress output and empty text', () => {
    expect(looksLikeTerminalPrompt('building package 42/100')).toBe(false);
    expect(looksLikeTerminalPrompt('')).toBe(false);
    expect(looksLikeTerminalPrompt('   \n\n')).toBe(false);
    expect(looksLikeTerminalPrompt('127.0.0.1:8080')).toBe(false);
  });

  it('only inspects the last non-empty line', () => {
    expect(looksLikeTerminalPrompt('downloaded 10 MB\nContinue? [Y/n]')).toBe(true);
    expect(looksLikeTerminalPrompt('Continue? [Y/n]\nfinished')).toBe(false);
  });
});

describe('isSensitiveTerminalPrompt', () => {
  it('flags secret-entry prompts', () => {
    expect(isSensitiveTerminalPrompt('Password:')).toBe(true);
    expect(isSensitiveTerminalPrompt('Enter your API key:')).toBe(true);
    expect(isSensitiveTerminalPrompt('MFA code:')).toBe(true);
    expect(isSensitiveTerminalPrompt('Captcha:')).toBe(true);
  });

  it('does not flag ordinary prompts', () => {
    expect(isSensitiveTerminalPrompt('Continue installation? [Y/n]')).toBe(false);
    expect(isSensitiveTerminalPrompt('Choose a version:')).toBe(false);
  });
});

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

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
  type ParsedTerminalFrame,
} from './terminal-protocol';

const execFileAsync = promisify(execFile);

const POWERSHELL_FRAME_TIMEOUT_MS = 25_000;

type PowerShellFrameResult = {
  parsed: ParsedTerminalFrame;
  raw: string;
  processCode: number | null;
};

async function runPowerShellFrame(
  command: string,
  nonce: string,
  shell = 'powershell.exe',
  cwd?: string,
  followUp?: string,
): Promise<PowerShellFrameResult> {
  const isWindows = process.platform === 'win32';
  const child = isWindows
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `${shell} -NoLogo -NoProfile 2>&1`], { cwd, windowsHide: true })
    : spawn(shell, ['-NoLogo', '-NoProfile'], { cwd, windowsHide: true });
  let raw = '';
  child.stdout.on('data', (data) => {
    raw += data.toString();
  });
  child.stderr.on('data', (data) => {
    raw += data.toString();
  });
  let closed = false;
  let rejectClose: ((reason?: unknown) => void) | null = null;
  const closePromise = new Promise<number | null>((resolve, reject) => {
    rejectClose = reject;
    child.once('error', reject);
    child.once('close', (code) => {
      closed = true;
      resolve(code);
    });
  });
  // Safety guard prevents a broken frame from leaking a persistent shell past the test timeout.
  const timeout = setTimeout(() => {
    if (closed) return;
    child.kill();
    rejectClose?.(new Error(`PowerShell frame timed out: ${nonce}`));
  }, POWERSHELL_FRAME_TIMEOUT_MS);
  try {
    const frame = buildTerminalFrame(command, 'powershell', nonce);
    if (followUp) child.stdin.write(frame);
    else child.stdin.end(frame);
    if (followUp) child.stdin.end(`${followUp}\r\n`);
    const processCode = await closePromise;
    return { parsed: parseTerminalFrame(raw, nonce), raw, processCode };
  } finally {
    clearTimeout(timeout);
    if (!closed) child.kill();
  }
}

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
    expect(frame).toContain("Write-Output ''; Write-Output '__HYSCODE_BEGIN_pw1__'");
    expect(frame).toContain("finally { Write-Output ''; Write-Output (\"__HYSCODE_END_pw1__:{0}\" -f $hysCode) }");
    expect(frame).toContain('try {');
    expect(frame).not.toContain("$ErrorActionPreference = 'Stop'");
    expect(frame).toContain("$ErrorActionPreference = 'Continue'");
    expect(frame).toContain('$PSNativeCommandUseErrorActionPreference = $false');
    expect(frame).toContain('$__hyscode_native_code_pw1 = 0');
    expect(frame).toContain('-ErrorVariable __hyscode_errors_pw1');
    expect(frame).toContain("Set-Variable -Name '__hyscode_invocation_errors_pw1' -Scope 1");
    expect(frame).toContain('Microsoft.PowerShell.Core\\Where-Object');
    expect(frame).toContain("FullyQualifiedErrorId -notlike 'NativeCommandError*'");
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

  it.skipIf(process.platform !== 'win32')('preserves the npm failure code when stderr is redirected and read back', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-npm-failure-'));
    const logPath = path.join(directory, 'test.log');
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ private: true, scripts: { test: 'node fail.js' } }),
      'utf8',
    );
    await writeFile(
      path.join(directory, 'fail.js'),
      "process.stderr.write('vitest-style failure\\n'); process.exit(1);\\n",
      'utf8',
    );

    try {
      const command = `npm test --silent 2>&1 | Out-File -FilePath "${logPath}" -Width 500 -Encoding utf8; Write-Output "RC=$LASTEXITCODE"; Get-Content "${logPath}" -Tail 30`;
      const result = await runPowerShellFrame(command, 'powershell-npm-failure', 'powershell.exe', directory);

      expect(result.parsed).toMatchObject({ complete: true, exitCode: 1 });
      expect(result.parsed.output).toContain('RC=1');
      expect(result.parsed.output).toContain('vitest-style failure');
      expect(await readFile(logPath, 'utf8')).toContain('vitest-style failure');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('preserves direct native stderr without changing exit status', async () => {
    const failure = await runPowerShellFrame(
      'cmd /c "echo native failure 1>&2 & exit /b 1"',
      'powershell-native-stderr-failure',
    );
    const success = await runPowerShellFrame(
      'cmd /c "echo native warning 1>&2 & exit /b 0"',
      'powershell-native-stderr-success',
    );

    expect(failure.parsed).toMatchObject({ complete: true, exitCode: 1 });
    expect(failure.parsed.output).toContain('native failure');
    expect(success.parsed).toMatchObject({ complete: true, exitCode: 0 });
    expect(success.parsed.output).toContain('native warning');
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('keeps redirected native stderr successful when the native process exits zero', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-native-success-'));
    const logPath = path.join(directory, 'native.log');

    try {
      const command = `cmd /c "echo native warning 1>&2 & exit /b 0" 2>&1 | Out-File -FilePath "${logPath}" -Width 500 -Encoding utf8; Write-Output "RC=$LASTEXITCODE"; Get-Content "${logPath}" -Tail 5`;
      const result = await runPowerShellFrame(command, 'powershell-redirected-success', 'powershell.exe', directory);

      expect(result.parsed).toMatchObject({ complete: true, exitCode: 0 });
      expect(result.parsed.output).toContain('RC=0');
      expect(result.parsed.output).toContain('native warning');
      expect(await readFile(logPath, 'utf8')).toContain('native warning');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('reports PowerShell errors even when a later native command exits zero', async () => {
    const result = await runPowerShellFrame(
      'Get-Item -LiteralPath hyscode-file-that-does-not-exist; cmd /c exit /b 0',
      'powershell-mixed-error',
    );

    expect(result.parsed).toMatchObject({ complete: true, exitCode: 1 });
    expect(result.parsed.output).toContain('does-not-exist');
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('retains a PowerShell error after native stderr fills the shell error history', async () => {
    const result = await runPowerShellFrame(
      'Get-Item -LiteralPath hyscode-first-error; 1..300 | ForEach-Object { cmd /c "echo native noise 1>&2 & exit /b 0" }',
      'powershell-error-history',
    );

    expect(result.parsed).toMatchObject({ complete: true, exitCode: 1 });
    expect(result.parsed.output).toContain('hyscode-first-error');
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('does not let command variables collide with frame state', async () => {
    const result = await runPowerShellFrame(
      '$__hyscode_native_code_powershell_state_collision = 42; $__hyscode_error_baseline_powershell_state_collision = @(); $hysState = $null; Write-Output frame-state-is-safe',
      'powershell-state-collision',
    );

    expect(result.parsed).toMatchObject({ complete: true, exitCode: 0 });
    expect(result.parsed.output).toContain('frame-state-is-safe');
    expect(result.parsed.output).not.toContain('Property');
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('protects frame completion from command function shadowing', async () => {
    const result = await runPowerShellFrame(
      'function Write-Output { param($value) }; function Where-Object { @() }; Get-Item -LiteralPath hyscode-file-that-does-not-exist',
      'powershell-function-shadowing',
    );

    expect(result.parsed).toMatchObject({ complete: true, exitCode: 1 });
    expect(result.parsed.output).toContain('does-not-exist');
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('does not leak frame state into the persistent PowerShell shell', async () => {
    const result = await runPowerShellFrame(
      'Write-Output frame-state-clean',
      'powershell-state-cleanup',
      'powershell.exe',
      undefined,
      'if ((Get-Variable -Name hysState -ErrorAction SilentlyContinue) -or (Get-Variable -Name __hyscode_native_code_powershell_state_cleanup -ErrorAction SilentlyContinue) -or (Get-Variable -Name __hyscode_error_baseline_powershell_state_cleanup -ErrorAction SilentlyContinue)) { Write-Output LEAKED } else { Write-Output CLEAN }',
    );
    const outputLines = result.raw.split(/\r?\n/u).map((line) => line.trim());

    expect(result.parsed).toMatchObject({ complete: true, exitCode: 0, output: 'frame-state-clean' });
    expect(outputLines).toContain('CLEAN');
    expect(outputLines).not.toContain('LEAKED');
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('preserves a genuine negative native exit status', async () => {
    const result = await runPowerShellFrame('cmd /c exit /b -1', 'powershell-negative-native');

    expect(result.parsed).toMatchObject({ complete: true, exitCode: -1 });
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('keeps exit capture consistent across supported PowerShell shells', async () => {
    const shells = ['powershell.exe'];
    let pwshAvailable = true;
    try {
      await execFileAsync('where.exe', ['pwsh.exe'], { windowsHide: true });
    } catch {
      pwshAvailable = false;
    }
    if (pwshAvailable) shells.push('pwsh.exe');

    for (const [index, shell] of shells.entries()) {
      const result = await runPowerShellFrame(
        'cmd /c "echo shell failure 1>&2 & exit /b 1"',
        `powershell-shell-${index}`,
        shell,
      );
      expect(result.parsed).toMatchObject({ complete: true, exitCode: 1 });
    }
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('completes a PowerShell frame whose command output lacks a trailing newline', async () => {
    const nonce = 'powershell-partial-line';
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile'], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    const closed = new Promise<number | null>((resolve) => child.once('close', resolve));

    child.stdin.end(buildTerminalFrame("[Console]::Write('partial line')", 'powershell', nonce));

    await closed;
    expect(parseTerminalFrame(output, nonce)).toMatchObject({
      complete: true,
      output: 'partial line',
      exitCode: 0,
    });
  });

  it.skipIf(process.platform === 'win32')('completes a POSIX frame whose command output lacks a trailing newline', async () => {
    const nonce = 'posix-partial-line';
    const child = spawn('/bin/sh', ['-s']);
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    const closed = new Promise<number | null>((resolve) => child.once('close', resolve));

    child.stdin.end(buildTerminalFrame("printf 'partial line'", 'bash', nonce));

    await closed;
    expect(parseTerminalFrame(output, nonce)).toMatchObject({
      complete: true,
      output: 'partial line',
      exitCode: 0,
    });
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
      protocolError: null,
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
      protocolError: null,
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

  it('completes when the end marker is glued to a partial output line', () => {
    const raw = `__HYSCODE_BEGIN_${nonce}__\ninstalling 42 packages__HYSCODE_END_${nonce}__:2\n`;
    expect(parseTerminalFrame(raw, nonce)).toEqual({
      started: true,
      complete: true,
      output: 'installing 42 packages',
      exitCode: 2,
      protocolError: null,
    });
  });

  it('does not treat the echoed wrapper text as a completion marker', () => {
    const echoed = buildTerminalFrame('echo hi', 'powershell', nonce);
    const raw = `${echoed}__HYSCODE_BEGIN_${nonce}__\noutput\n__HYSCODE_END_${nonce}__:0\n`;
    expect(parseTerminalFrame(raw, nonce)).toMatchObject({
      started: true,
      complete: true,
      output: 'output',
    });
  });
  it('reports malformed matching completion markers as protocol failures', () => {
    const raw = `__HYSCODE_BEGIN_${nonce}__\noutput\n__HYSCODE_END_${nonce}__:not-a-code\n`;
    expect(parseTerminalFrame(raw, nonce)).toMatchObject({
      started: true,
      complete: false,
      protocolError: 'The terminal completion marker contained an invalid exit code.',
    });
  });

  it('treats nonce punctuation literally', () => {
    const specialNonce = 'nonce.with+symbols';
    const raw = `__HYSCODE_BEGIN_${specialNonce}__\noutput\n__HYSCODE_END_${specialNonce}__:0\n`;
    expect(parseTerminalFrame(raw, specialNonce)).toMatchObject({
      complete: true,
      output: 'output',
      exitCode: 0,
    });
  });

  it('rejects unsafe completion exit codes', () => {
    const raw = `__HYSCODE_BEGIN_${nonce}__\noutput\n__HYSCODE_END_${nonce}__:999999999999999999999999\n`;
    expect(parseTerminalFrame(raw, nonce).protocolError).toBe(
      'The terminal completion marker contained an unsafe exit code.',
    );
  });
  it('accepts explicitly signed completion exit codes', () => {
    const raw = `__HYSCODE_BEGIN_${nonce}__\noutput\n__HYSCODE_END_${nonce}__:+7\n`;
    expect(parseTerminalFrame(raw, nonce)).toMatchObject({
      complete: true,
      output: 'output',
      exitCode: 7,
    });
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

  it('removes the expanded PowerShell wrapper internals from terminal previews', () => {
    const raw = [
      '$__hyscode_native_code_preview = 0;',
      '$__hyscode_error_baseline_preview = @($Error);',
      '$__hyscode_errors_preview = @();',
      'Microsoft.PowerShell.Core\\Where-Object { $__hyscode_error_baseline_preview }',
      "Microsoft.PowerShell.Core\\Where-Object { $_.FullyQualifiedErrorId -notlike 'NativeCommandError*' }",
      'visible command output',
    ].join('\r\n');

    expect(normalizeTerminalOutput(raw, 16_000)).toBe('visible command output');
  });

  it('preserves legitimate PowerShell variable and command text', () => {
    const raw = [
      '$hysState = user state',
      'Microsoft.PowerShell.Core\\Get-Item user.txt',
      '$__hyscode_user = visible',
      'visible command output',
    ].join('\r\n');

    expect(normalizeTerminalOutput(raw, 16_000)).toBe(raw.replaceAll('\r', ''));
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
  it('does not classify generic questions or labels as prompts', () => {
    expect(looksLikeTerminalPrompt('build finished?')).toBe(false);
    expect(looksLikeTerminalPrompt('downloaded:')).toBe(false);
    expect(looksLikeTerminalPrompt('http://localhost:8080')).toBe(false);
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

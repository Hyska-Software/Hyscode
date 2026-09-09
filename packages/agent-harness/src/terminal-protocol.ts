import type { TerminalFrameLanguage } from './types';

/** Hard bound on retained raw terminal output. Mirrors the Rust PTY buffer cap. */
export const MAX_CAPTURE_CHARS = 1024 * 1024;

/** Internal marker prefix used by framed capture. Must not collide with command output. */
export function frameMarker(kind: 'BEGIN' | 'END', nonce: string): string {
  return `__HYSCODE_${kind}_${nonce}__`;
}

export function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
}

export function appendBounded(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length <= MAX_CAPTURE_CHARS ? next : next.slice(-MAX_CAPTURE_CHARS);
}

/** Encode command source so PowerShell parses the wrapper, not the command itself. */
function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Quote arbitrary command source as a POSIX shell literal for deferred eval. */
function quotePosixLiteral(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Wrap a command so its output and exit code can be captured between markers.
 * The wrapper language must match the shell the runtime spawned
 * (`TerminalBinding.frameLanguage`).
 */
export function buildTerminalFrame(
  command: string,
  language: TerminalFrameLanguage,
  nonce: string,
): string {
  const begin = frameMarker('BEGIN', nonce);
  const end = frameMarker('END', nonce);
  if (language === 'powershell') {
    const encodedCommand = encodeUtf8Base64(command);
    const variableSuffix = nonce.replace(/[^a-zA-Z0-9_]/g, '_');
    const nativeCodeVariableName = `__hyscode_native_code_${variableSuffix}`;
    const nativeCodeVariable = `$${nativeCodeVariableName}`;
    const invocationSuccessVariableName = `__hyscode_invocation_success_${variableSuffix}`;
    const invocationSuccessVariable = `$${invocationSuccessVariableName}`;
    const invocationErrorsVariableName = `__hyscode_invocation_errors_${variableSuffix}`;
    const invocationErrorsVariable = `$${invocationErrorsVariableName}`;
    const errorBaselineVariableName = `__hyscode_error_baseline_${variableSuffix}`;
    const errorBaselineVariable = `$${errorBaselineVariableName}`;
    const errorVariableName = `__hyscode_errors_${variableSuffix}`;
    const errorVariable = `$${errorVariableName}`;
    return (
      `& { $global:LASTEXITCODE = 0; Write-Output ''; Write-Output '${begin}'; $hysCode = 0; ` +
      `$hysCommand = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedCommand}')); ` +
      `${nativeCodeVariable} = 0; ${invocationSuccessVariable} = $true; ${invocationErrorsVariable} = @(); ` +
      `${errorBaselineVariable} = @($Error); ` +
      `try { & { $ErrorActionPreference = 'Continue'; $PSNativeCommandUseErrorActionPreference = $false; ` +
      `${errorVariable} = @(); Invoke-Expression -Command $hysCommand -ErrorAction Continue -ErrorVariable ${errorVariableName}; ` +
      `$hysInvocationSucceeded = $?; $hysNativeCode = [int]$LASTEXITCODE; ` +
      `Microsoft.PowerShell.Utility\\Set-Variable -Name '${invocationSuccessVariableName}' -Scope 1 -Value $hysInvocationSucceeded; ` +
      `Microsoft.PowerShell.Utility\\Set-Variable -Name '${nativeCodeVariableName}' -Scope 1 -Value $hysNativeCode; ` +
      `Microsoft.PowerShell.Utility\\Set-Variable -Name '${invocationErrorsVariableName}' -Scope 1 -Value @(${errorVariable}) }; ` +
      `$hysNewErrors = @($Error | Microsoft.PowerShell.Core\\Where-Object { ${errorBaselineVariable} -notcontains $_ }); ` +
      `$hysRecords = @(${invocationErrorsVariable} + $hysNewErrors); ` +
      `$hysPowerShellErrors = @($hysRecords | Microsoft.PowerShell.Core\\Where-Object { $_.FullyQualifiedErrorId -notlike 'NativeCommandError*' }); ` +
      `$hysCode = if (${nativeCodeVariable} -ne 0) { [int]${nativeCodeVariable} } ` +
      `elseif ($hysPowerShellErrors.Count -gt 0) { 1 } else { 0 } } ` +
      `catch { $hysCode = if ($LASTEXITCODE -ne 0) { [int]$LASTEXITCODE } else { 1 }; Write-Error $_ -ErrorAction Continue } ` +
      `finally { Write-Output ''; Write-Output ("${end}:{0}" -f $hysCode) } }\r\n`
    );
  }
  const commandLiteral = quotePosixLiteral(command);
  return `printf '\\n${begin}\\n'; hys_command=${commandLiteral}; (set +e; trap 'hys_code=$?; printf "\\n${end}:%s\\n" "$hys_code"; exit "$hys_code"' 0; eval "$hys_command")\n`;
}

export type ParsedTerminalFrame = {
  complete: boolean;
  output: string;
  exitCode: number | null;
  started: boolean;
  protocolError: string | null;
};

export function parseTerminalFrame(raw: string, nonce: string): ParsedTerminalFrame {
  const begin = frameMarker('BEGIN', nonce);
  const end = frameMarker('END', nonce);
  const lines = stripAnsi(raw).split('\n');
  const beginIndex = lines.findIndex((line) => line.trim() === begin);
  if (beginIndex < 0) {
    return { complete: false, output: '', exitCode: null, started: false, protocolError: null };
  }

  // The END marker may arrive glued to the command's last partial line (a
  // trailing progress spinner without a newline). Accept it as a line suffix.
  const escapedEnd = escapeRegExp(end);
  const endPattern = new RegExp(`^(.*?)${escapedEnd}:([-+]?\\d+)$`);
  for (let index = beginIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    const match = line.match(endPattern);
    if (match) {
      const exitCode = Number(match[2]);
      if (!Number.isSafeInteger(exitCode)) {
        return {
          complete: false,
          output: frameOutput(lines, beginIndex + 1, index, match[1]),
          exitCode: null,
          started: true,
          protocolError: 'The terminal completion marker contained an unsafe exit code.',
        };
      }
      return {
        complete: true,
        output: frameOutput(lines, beginIndex + 1, index, match[1]),
        exitCode,
        started: true,
        protocolError: null,
      };
    }
    if (line.includes(end)) {
      const isPowerShellWrapperEcho = line.includes('$hysCode')
        || line.includes('$__hyscode_')
        || INTERNAL_POWERSHELL_PATTERNS.some((pattern) => pattern.test(line));
      if (isPowerShellWrapperEcho) continue;
      return {
        complete: false,
        output: frameOutput(lines, beginIndex + 1, index),
        exitCode: null,
        started: true,
        protocolError: 'The terminal completion marker contained an invalid exit code.',
      };
    }
  }
  return {
    complete: false,
    output: lines
      .slice(beginIndex + 1)
      .join('\n')
      .trim(),
    exitCode: null,
    started: true,
    protocolError: null,
  };
}

function frameOutput(lines: string[], start: number, end: number, inline = ''): string {
  const before = lines.slice(start, end).join('\n').trim();
  const suffix = inline.trim();
  return [before, suffix].filter((part) => part.length > 0).join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lines that only exist because the PowerShell wrapper was echoed into the shell. */
const INTERNAL_POWERSHELL_PATTERNS = [
  /\$global:LASTEXITCODE\s*=\s*0\b/i,
  /\$global:LAS\s*$/i,
  /\$hysOk\s*=\s*\$\?/i,
  /\$hysCode\s*=\s*(?:0|if)\b/i,
  /\$hysCommand\s*=\s*\[Text\.Encoding\]::UTF8.GetString\b/i,
  /\$hys(?:InvocationSucceeded|NativeCode|NewErrors|Records|PowerShellErrors)\s*=/i,
  /\$__hyscode_(?:native_code|invocation_success|invocation_errors|error_baseline|errors)_[a-z0-9_]+\s*=/i,
  /(?:if|elseif).*\$LASTEXITCODE/i,
  /=\s*\[Text\.Encoding\]::UTF8.GetString\b/i,
  /\$ErrorActionPreference\s*=\s*['"]Continue['"]\s*;\s*\$PSNativeCommandUseErrorActionPreference\s*=\s*\$false/i,
  /\$__hyscode_native_code_[a-z0-9_]+\s+-ne\s+0/i,
  /Microsoft\.PowerShell\.Utility\\Set-Variable\s+-Name\s+'__hyscode_/i,
  /Microsoft\.PowerShell\.Core\\Where-Object\s+\{\s+\$__hyscode_/i,
  /FullyQualifiedErrorId\s+-(?:not)?like\s+'NativeCommandError/i,
  /\}\s+else\s+\{\s*1\s*\};\s*Write-Error\s+\$_\s+-ErrorAction\s+Continue/i,
  /finally\s*\{\s*Write-Output\s+['"]['"]\s*;\s*Write-Output/i,
  /Write-Output\s*\(\s*['"]__HYSCODE_(?:BEGIN|END)_/i,
  /^\s*>+\s*$/,
];
/** Clean raw terminal output for display or context: strip ANSI, markers, wrapper noise. */
export function normalizeTerminalOutput(raw: string, maxChars: number): string {
  const lines = stripAnsi(raw).split('\n');
  const normalizedLines: string[] = [];
  const beginMarkerPattern = /^__HYSCODE_BEGIN_[A-Za-z0-9_-]+__$/;
  let inFrameEcho = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !inFrameEcho
      && /\$global:LASTEXITCODE\s*=\s*0\b/i.test(line)
      && (line.includes('__HYSCODE_BEGIN_') || /(?:^|>)\s*&\s*\{/i.test(line))
    ) {
      inFrameEcho = true;
    }
    if (inFrameEcho) {
      if (beginMarkerPattern.test(trimmed)) inFrameEcho = false;
      continue;
    }
    if (line.includes('__HYSCODE_BEGIN_') || line.includes('__HYSCODE_END_')) continue;
    if (INTERNAL_POWERSHELL_PATTERNS.some((pattern) => pattern.test(line))) continue;
    normalizedLines.push(line);
  }
  const normalized = normalizedLines.join('\n').trim();
  return normalized.length <= maxChars ? normalized : normalized.slice(-maxChars);
}

export function looksLikeTerminalPrompt(output: string): boolean {
  const line = stripAnsi(output)
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) return false;

  const explicitChoice = /(?:\[(?:y\/n|Y\/n|yes\/no)\]|\((?:y\/n|yes\/no)\))\s*$/i;
  const sensitiveLabel = /^(?:password|passphrase|secret|api(?:[_ -]?key)?|access(?:[_ -]?token)?|mfa(?:\s+code)?|one[- ]time(?:\s+code)?|verification(?:\s+code)?|captcha)\s*:\s*$/i;
  const actionRequest = /^(?:please\s+)?(?:continue|proceed|confirm|overwrite|retry|install|trust)\b(?:[^?]*\?|\s*:\s*)$/i;
  return explicitChoice.test(line)
    || sensitiveLabel.test(line)
    || /^\s*press\s+(?:enter|return)\b.*$/i.test(line)
    || /^(?:select|choose)\b.+:\s*$/i.test(line)
    || /^(?:enter|provide)\b.+:\s*$/i.test(line)
    || actionRequest.test(line);
}

export function isSensitiveTerminalPrompt(output: string): boolean {
  const tail = stripAnsi(output).slice(-1_000);
  return /(?:password|passphrase|secret|api[_ -]?key|access[_ -]?token|mfa|one[- ]time|verification code|captcha)/i.test(
    tail,
  );
}
